import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounced } from "@/hooks/use-debounced";
import { getXLSX } from "@/lib/xlsx-lazy";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRightLeft, UserMinus, AlertTriangle, UserCheck, HelpCircle, Search, Download, FileSpreadsheet, ShieldAlert, RotateCcw, Info, FileX2, Loader2, Users, History } from "lucide-react";
import { DuplicatesSection } from "@/components/reconcile/DuplicatesSection";
import { TransferSwapHistoryPanel } from "@/components/operations/TransferSwapHistoryPanel";
import { StatusChangeLogPanel } from "@/components/operations/StatusChangeLogPanel";

import { toast } from "sonner";
import { parseBatchIntake, formatBatchIntake, compareLockerNumbers } from "@/lib/locker-utils";
import { saveReconcileState, loadReconcileState, clearReconcileState, readReconcileMeta } from "@/lib/reconcile-store";
import { getLockersSnapshot, invalidateLockersCache } from "@/lib/lockers-cache";
import { terminateLocker } from "@/lib/termination-actions";
import { defaultPostTerminationStatus } from "@/lib/locker-status";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NationalIdCell } from "@/components/NationalIdCell";
import { maskNationalId, confirmNidExport } from "@/lib/national-id";

export const Route = createFileRoute("/reconcile")({
  head: () => ({
    meta: [
      { title: "Reconcile HR roster — LockerOps" },
      { name: "description", content: "Compare HR listing against active locker occupants to find users who must be terminated, rehired, or are missing from HR." },
      { property: "og:title", content: "Reconcile HR roster — LockerOps" },
      { property: "og:description", content: "Compare HR listing against active locker occupants." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<PageGuard permission="page_reconcile"><ReconcilePage /></PageGuard>),
});

type HrPerson = {
  badge: string | null;
  name: string | null;
  status: "current" | "terminated";
  joinDate: string | null;     // ISO yyyy-mm-dd
  terminateDate: string | null;// ISO yyyy-mm-dd
  workLocation: string | null;
  gradeset: string | null;
  department: string | null;
};

type DbRow = {
  id: string;
  locker_number: string;
  location: string;
  row_label: string | null;
  employee_name: string | null;
  badge_number: string | null;
  national_id: string | null;
  batch_intake: string | null; // ISO
  work_location: string | null;
  key_lock: string | null;
};

type Bucket =
  | "must_terminate"     // DB occupant matched a terminated HR row → release
  | "rehire_suspect"     // matched terminated HR row, but locker batch_intake > terminate_date OR also appears as Current
  | "missing_from_hr"    // DB occupant not found anywhere in HR file
  | "ok_current";        // matched a Current HR row

interface RowResult {
  bucket: Bucket;
  db: DbRow;
  hr: HrPerson | null;
  hrAlsoCurrent?: HrPerson | null;
  matchedBy: "badge" | "name" | null;
  reason: string;
}

const EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

type SavedState = {
  filename: string | null;
  results: RowResult[];
  hrCount: { current: number; terminated: number };
  dbCount: number;
  tab: Bucket;
  savedAt: number;
};

function ReconcilePage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [hrCount, setHrCount] = useState({ current: 0, terminated: 0 });
  const [dbCount, setDbCount] = useState(0);
  const [tab, setTab] = useState<Bucket>("must_terminate");
  const [search, setSearch] = useState("");
  const [restored, setRestored] = useState<{ filename: string | null; savedAt: number } | null>(null);

  const clearSaved = (silent = false) => {
    void clearReconcileState();
    setResults(null);
    setFilename(null);
    setHrCount({ current: 0, terminated: 0 });
    setDbCount(0);
    setRestored(null);
    setSearch("");
    try {
      const bc = new BroadcastChannel("reconcile:sync");
      bc.postMessage({ type: "clear" });
      bc.close();
    } catch { /* ignore */ }
    if (!silent) toast.success("Saved reconcile data cleared.");
  };

  // Restore previously reconciled results (IndexedDB) so navigating away —
  // e.g. opening a Terminate tab and coming back — doesn't force a re-upload.
  useEffect(() => {
    (async () => {
      const meta = readReconcileMeta();
      if (!meta) return;
      if (Date.now() - meta.savedAt > EXPIRY_MS) {
        await clearReconcileState();
        toast.info("Previous reconcile data expired — please re-upload.");
        return;
      }
      const saved = await loadReconcileState<SavedState>();
      if (!saved || !saved.results) return;
      setFilename(saved.filename);
      setResults(saved.results);
      setHrCount(saved.hrCount);
      setDbCount(saved.dbCount);
      if (saved.tab) setTab(saved.tab);
      setRestored({ filename: saved.filename, savedAt: saved.savedAt });
    })();
  }, []);

  // Auto-clear when the saved state passes its expiry while the page is open.
  useEffect(() => {
    if (!restored) return;
    const remaining = restored.savedAt + EXPIRY_MS - Date.now();
    if (remaining <= 0) { clearSaved(true); return; }
    const t = setTimeout(() => {
      clearSaved(true);
      toast.info("Reconcile data expired and was cleared.");
    }, remaining);
    return () => clearTimeout(t);
  }, [restored]);

  // Persist whenever results change (IndexedDB — no 5MB quota).
  // Only re-save when the dataset actually changes, not on tab/search clicks.
  // Tab is saved alongside but doesn't trigger a write by itself.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (results === null) return;
    const savedAt = restored?.savedAt ?? Date.now();
    const payload: SavedState = { filename, results, hrCount, dbCount, tab: tabRef.current, savedAt };
    void saveReconcileState(payload, { filename, savedAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  // Cross-tab + multi-admin realtime sync — subscribe ONCE per dataset
  // (results identity), not on every render. Use a ref to read the latest
  // ids set without re-subscribing.
  const idsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    idsRef.current = new Set(results?.map((r) => r.db.id) ?? []);
  }, [results]);

  useEffect(() => {
    if (!results) return;

    const bc = new BroadcastChannel("reconcile:sync");
    bc.onmessage = (ev) => {
      const msg = ev.data as { type: string; lockerId?: string };
      if (msg.type === "clear") {
        setResults(null); setFilename(null); setRestored(null);
      } else if (msg.type === "remove" && msg.lockerId) {
        setResults((prev) => prev ? prev.filter((r) => r.db.id !== msg.lockerId) : prev);
      }
    };

    const channel = supabase
      .channel("reconcile-lockers-sync")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lockers" }, (payload) => {
        const row = payload.new as { id: string; status?: string; deleted_at?: string | null };
        if (!idsRef.current.has(row.id)) return;
        if (row.status !== "occupied" || row.deleted_at) {
          setResults((prev) => prev ? prev.filter((r) => r.db.id !== row.id) : prev);
          bc.postMessage({ type: "remove", lockerId: row.id });
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "lockers" }, (payload) => {
        const row = payload.old as { id: string };
        if (!idsRef.current.has(row.id)) return;
        setResults((prev) => prev ? prev.filter((r) => r.db.id !== row.id) : prev);
        bc.postMessage({ type: "remove", lockerId: row.id });
      })
      .subscribe();

    return () => {
      bc.close();
      supabase.removeChannel(channel);
    };
    // Only (re)subscribe when we transition between "no results" and "has results".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results === null]);

  const handleFile = async (f: File) => {
    setBusy(true);
    setResults(null);
    setRestored(null);
    setFilename(f.name);
    try {
      // Yield once so the "Comparing…" indicator paints before the
      // synchronous xlsx parse + matching work begins.
      await new Promise((r) => setTimeout(r, 0));
      const [hr, dbRows] = await Promise.all([parseHr(f, f.name), fetchActiveDb()]);
      setHrCount({
        current: hr.filter((p) => p.status === "current").length,
        terminated: hr.filter((p) => p.status === "terminated").length,
      });
      setDbCount(dbRows.length);
      await new Promise((r) => setTimeout(r, 0));

      // Sort HR matches: badge match wins, then name, then termination date recency.
      // (Used implicitly via Map.get(); but when multiple terminated rows exist for
      // the same person, we pick the most recent termination date below.)

      // Build HR indexes
      const hrByBadge = new Map<string, HrPerson[]>();
      const hrByName = new Map<string, HrPerson[]>();
      for (const p of hr) {
        if (p.badge) {
          const k = normBadge(p.badge);
          if (!hrByBadge.has(k)) hrByBadge.set(k, []);
          hrByBadge.get(k)!.push(p);
        }
        if (p.name) {
          const k = normName(p.name);
          if (!hrByName.has(k)) hrByName.set(k, []);
          hrByName.get(k)!.push(p);
        }
      }

      const out: RowResult[] = [];
      for (const d of dbRows) {
        let matches: HrPerson[] = [];
        let matchedBy: "badge" | "name" | null = null;
        if (d.badge_number) {
          const m = hrByBadge.get(normBadge(d.badge_number));
          if (m && m.length) { matches = m; matchedBy = "badge"; }
        }
        if (matches.length === 0 && d.employee_name) {
          const m = hrByName.get(normName(d.employee_name));
          if (m && m.length) { matches = m; matchedBy = "name"; }
        }

        if (matches.length === 0) {
          out.push({
            bucket: "missing_from_hr",
            db: d,
            hr: null,
            matchedBy: null,
            reason: "No badge or name match in HR file",
          });
          continue;
        }

        const current = matches.find((m) => m.status === "current") ?? null;
        // Among multiple terminated rows for the same person, pick the most
        // recent termination date (string ISO compare works).
        const terminatedAll = matches.filter((m) => m.status === "terminated");
        const terminated = terminatedAll.length
          ? terminatedAll.reduce((a, b) =>
              (b.terminateDate ?? "") > (a.terminateDate ?? "") ? b : a,
            )
          : null;

        if (current && !terminated) {
          out.push({
            bucket: "ok_current",
            db: d,
            hr: current,
            matchedBy,
            reason: "Active in HR",
          });
          continue;
        }

        // matched a terminated row
        const term = terminated!;
        const intakeIso = d.batch_intake;
        const intakeAfterTerm =
          intakeIso && term.terminateDate && intakeIso > term.terminateDate;

        if (current && terminated) {
          out.push({
            bucket: "rehire_suspect",
            db: d,
            hr: terminated,
            hrAlsoCurrent: current,
            matchedBy,
            reason: "HR shows BOTH Terminated and Current rows — likely rehired",
          });
        } else if (intakeAfterTerm) {
          out.push({
            bucket: "rehire_suspect",
            db: d,
            hr: term,
            matchedBy,
            reason: `Locker batch intake (${formatBatchIntake(intakeIso)}) is AFTER HR termination date (${formatBatchIntake(term.terminateDate)}) — rehire suspected, verify before terminating`,
          });
        } else {
          out.push({
            bucket: "must_terminate",
            db: d,
            hr: term,
            matchedBy,
            reason: term.terminateDate
              ? `Terminated in HR on ${formatBatchIntake(term.terminateDate)}`
              : "Terminated in HR (no date)",
          });
        }
      }

      setResults(out);
      const counts = bucketCounts(out);
      toast.success(
        `Reconciled — ${counts.must_terminate} to terminate, ${counts.rehire_suspect} suspect, ${counts.missing_from_hr} missing from HR.`,
      );
      // jump to most-actionable tab
      if (counts.must_terminate > 0) setTab("must_terminate");
      else if (counts.rehire_suspect > 0) setTab("rehire_suspect");
      else if (counts.missing_from_hr > 0) setTab("missing_from_hr");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setBusy(false);
    }
  };

  const debouncedSearch = useDebounced(search, 200);
  const filtered = useMemo(() => {
    if (!results) return [];
    const q = debouncedSearch.trim().toLowerCase();
    const inBucket = results.filter((r) => r.bucket === tab);
    const matched = !q ? inBucket : inBucket.filter((r) => {
      const hay = [
        r.db.locker_number, r.db.employee_name, r.db.badge_number,
        r.db.location, r.db.row_label, r.hr?.name, r.hr?.badge,
        r.hr?.workLocation, r.hr?.department, r.reason,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    return [...matched].sort((a, b) => compareLockerNumbers(a.db.locker_number, b.db.locker_number));
  }, [results, tab, debouncedSearch]);

  const counts = results ? bucketCounts(results) : { must_terminate: 0, rehire_suspect: 0, missing_from_hr: 0, ok_current: 0 };

  const exportAll = async (fmt: "xlsx" | "csv") => {
    if (!results) return;
    if (!confirmNidExport()) return;
    const byBucket = (b: Bucket) =>
      results
        .filter((r) => r.bucket === b)
        .sort((a, c) => compareLockerNumbers(a.db.locker_number, c.db.locker_number))
        .map(toExportRow);
    const sheets: Record<string, Record<string, unknown>[]> = {
      "Must Terminate": byBucket("must_terminate"),
      "Rehire Suspect": byBucket("rehire_suspect"),
      "Missing from HR": byBucket("missing_from_hr"),
      "OK Current": byBucket("ok_current"),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === "csv") {
      const flat = (Object.entries(sheets) as [string, Record<string, unknown>[]][])
        .flatMap(([k, rows]) => rows.map((r) => ({ bucket: k, ...r })));
      const csv = Papa.unparse(flat);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `reconcile-${stamp}.csv`);
    } else {
      const XLSX = await getXLSX();
      const wb = XLSX.utils.book_new();
      for (const [name, rows] of Object.entries(sheets)) {
        const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ note: "(empty)" }]);
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      }
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `reconcile-${stamp}.xlsx`);
    }
  };

  if (loading || !user) return <div className="min-h-screen"><AppHeader /></div>;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-7 w-7 text-warning" />
              Reconcile with HR Listing
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Upload the HR employee listing (Excel/CSV), or a Mednefits weekly file to detect deletions. The system compares every active locker occupant against the file so you can act safely before terminating.
            </p>
          </div>
        </div>

        <Tabs defaultValue="hr" className="mt-6">
          <TabsList className="flex flex-wrap h-auto w-full max-w-3xl">
            <TabsTrigger value="hr" className="gap-2"><ShieldAlert className="h-4 w-4" /> HR Listing</TabsTrigger>
            <TabsTrigger value="mednefits" className="gap-2"><FileX2 className="h-4 w-4" /> Mednefits</TabsTrigger>
            <TabsTrigger value="duplicates" className="gap-2"><Users className="h-4 w-4" /> Duplicates</TabsTrigger>
            <TabsTrigger value="terminations" className="gap-2"><ArrowRightLeft className="h-4 w-4" /> Transfer and Swap History</TabsTrigger>
            <TabsTrigger value="status_log" className="gap-2"><History className="h-4 w-4" /> Status Change Log</TabsTrigger>

            
          </TabsList>




          <TabsContent value="hr" className="mt-4">
            {restored && results && (
              <Alert className="mb-4 border-primary/40 bg-primary/5">
                <Info className="h-4 w-4 text-primary" />
                <AlertTitle>Restored from previous upload</AlertTitle>
                <AlertDescription className="text-xs flex items-center gap-2 flex-wrap">
                  File: <span className="font-mono font-semibold">{restored.filename ?? "(unknown)"}</span>
                  <span className="text-muted-foreground">
                    · saved {new Date(restored.savedAt).toLocaleString()} · auto-clears in {formatRemaining(restored.savedAt + EXPIRY_MS - Date.now())}
                  </span>
                </AlertDescription>
              </Alert>
            )}

            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.csv"
                  disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  className="max-w-md"
                />
                {filename && <Badge variant="outline" className="font-mono">{filename}</Badge>}
                {busy && <span className="text-sm text-muted-foreground">Comparing…</span>}
                {results && (
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => clearSaved()}>
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Clear saved data
                  </Button>
                )}
              </div>
              {results && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Stat label="HR Current" value={hrCount.current} />
                  <Stat label="HR Terminated" value={hrCount.terminated} />
                  <Stat label="Active in DB" value={dbCount} />
                  <Stat label="Matched OK" value={counts.ok_current} accent="text-success" />
                </div>
              )}
            </Card>

            {results && (
              <>
                <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
                  <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search locker / badge / name…"
                      value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  {role === "admin" && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => exportAll("xlsx")}>
                        <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export Excel
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => exportAll("csv")}>
                        <Download className="h-4 w-4 mr-1.5" /> Export CSV
                      </Button>
                    </div>
                  )}
                </div>

                <Alert className="mt-4 border-warning/50 bg-warning/5">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <AlertTitle>Verify before terminating</AlertTitle>
                  <AlertDescription className="text-xs">
                    Always check the <strong>Rehire Suspect</strong> tab first — these users appear as terminated in HR but their locker batch intake is more recent or they also have a Current record (likely rehired).
                  </AlertDescription>
                </Alert>

                <Tabs value={tab} onValueChange={(v) => setTab(v as Bucket)} className="mt-4">
                  <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
                    <TabsTrigger value="must_terminate" className="gap-2">
                      <UserMinus className="h-4 w-4" /> Must Terminate
                      <Badge variant="destructive" className="ml-1">{counts.must_terminate}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="rehire_suspect" className="gap-2">
                      <AlertTriangle className="h-4 w-4" /> Rehire Suspect
                      <Badge className="ml-1 bg-warning text-warning-foreground hover:bg-warning/90">{counts.rehire_suspect}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="missing_from_hr" className="gap-2">
                      <HelpCircle className="h-4 w-4" /> Missing from HR
                      <Badge variant="secondary" className="ml-1">{counts.missing_from_hr}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="ok_current" className="gap-2">
                      <UserCheck className="h-4 w-4" /> OK Current
                      <Badge variant="outline" className="ml-1">{counts.ok_current}</Badge>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value={tab} className="mt-4">
                    <ResultsTable
                      rows={filtered}
                      bucket={tab}
                      navigate={navigate}
                      onRowsTerminated={(ids) => {
                        setResults((prev) => (prev ? prev.filter((r) => !ids.includes(r.db.id)) : prev));
                      }}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </TabsContent>

          <TabsContent value="mednefits" className="mt-4">
            <MednefitsSection navigate={navigate} />
          </TabsContent>

          <TabsContent value="duplicates" className="mt-4">
            <DuplicatesSection />
          </TabsContent>

          <TabsContent value="terminations" className="mt-4">
            <TransferSwapHistoryPanel />
          </TabsContent>

          <TabsContent value="status_log" className="mt-4">
            <StatusChangeLogPanel />
          </TabsContent>

        </Tabs>
      </main>
    </div>
  );
}

function bucketCounts(rs: RowResult[]) {
  const c = { must_terminate: 0, rehire_suspect: 0, missing_from_hr: 0, ok_current: 0 } as Record<Bucket, number>;
  for (const r of rs) c[r.bucket]++;
  return c;
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "moments";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ResultsTable({
  rows, bucket, navigate, onRowsTerminated,
}: {
  rows: RowResult[];
  bucket: Bucket;
  navigate: ReturnType<typeof useNavigate>;
  onRowsTerminated: (ids: string[]) => void;
}) {
  const canBulkTerminate = bucket === "must_terminate" || bucket === "rehire_suspect";
  const MAX = 500;
  const visible = useMemo(() => rows.slice(0, MAX), [rows]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | { ids: string[]; label: string }>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Clear selection when the bucket or visible rows change
  useEffect(() => { setSelected(new Set()); }, [bucket, rows]);

  const visibleIds = useMemo(() => visible.map((r) => r.db.id), [visible]);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
  };

  const runBulkTerminate = async (ids: string[]) => {
    const targets = visible.filter((r) => ids.includes(r.db.id));
    if (targets.length === 0) return;
    setBulkBusy(true);
    setProgress({ done: 0, total: targets.length });
    const okIds: string[] = [];
    let failed = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      try {
        const date = r.hr?.terminateDate || today;
        const postStatus = defaultPostTerminationStatus(r.db.key_lock);
        await terminateLocker(r.db, date, r.reason || null, postStatus);
        okIds.push(r.db.id);
      } catch (e) {
        failed++;
        console.error("Terminate failed for", r.db.locker_number, e);
        toast.error(e instanceof Error ? e.message : `Locker ${r.db.locker_number}: termination failed`);
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setBulkBusy(false);
    setProgress(null);
    setConfirm(null);
    setSelected(new Set());
    if (okIds.length > 0) {
      invalidateLockersCache();
      onRowsTerminated(okIds);
    }
    if (failed === 0) toast.success(`Terminated ${okIds.length} locker${okIds.length === 1 ? "" : "s"}.`);
    else toast.warning(`Terminated ${okIds.length}, failed ${failed}. Failed lockers were not changed.`);
  };

  if (rows.length === 0) {
    return <Card className="p-10 text-center text-sm text-muted-foreground">No rows in this bucket.</Card>;
  }

  return (
    <>
      {canBulkTerminate && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-xs text-muted-foreground mr-auto">
            {selected.size > 0 ? `${selected.size} selected` : `Select rows to terminate in bulk`}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={selected.size === 0 || bulkBusy}
            onClick={() => setConfirm({ ids: [...selected], label: `${selected.size} selected locker${selected.size === 1 ? "" : "s"}` })}
          >
            <UserMinus className="h-3.5 w-3.5 mr-1" /> Terminate Selected ({selected.size})
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={visible.length === 0 || bulkBusy}
            onClick={() => setConfirm({ ids: visibleIds, label: `ALL ${visible.length} visible locker${visible.length === 1 ? "" : "s"} in this tab` })}
          >
            <UserMinus className="h-3.5 w-3.5 mr-1" /> Terminate All ({visible.length})
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {rows.length > MAX && (
          <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-b">
            Showing first {MAX.toLocaleString()} of {rows.length.toLocaleString()} rows — refine search to narrow down.
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto">
          <table className="hidden sm:table w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-left">
                {canBulkTerminate && (
                  <Th>
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label="Select all visible"
                    />
                  </Th>
                )}
                <Th>Locker</Th>
                <Th>Location / Row</Th>
                <Th>Badge</Th>
                <Th>DB Name</Th>
                <Th>HR Name</Th>
                <Th>Batch Intake</Th>
                <Th>HR Termination</Th>
                <Th>Reason</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.db.id} className={i % 2 ? "bg-muted/20" : ""}>
                  {canBulkTerminate && (
                    <Td>
                      <Checkbox
                        checked={selected.has(r.db.id)}
                        onCheckedChange={(v) => toggleOne(r.db.id, v === true)}
                        aria-label={`Select ${r.db.locker_number}`}
                      />
                    </Td>
                  )}
                  <Td mono>{r.db.locker_number}</Td>
                  <Td>
                    <div>{r.db.location}</div>
                    <div className="text-xs text-muted-foreground">{r.db.row_label ?? "—"}</div>
                  </Td>
                  <Td mono>{r.db.badge_number ?? "—"}</Td>
                  <Td>{r.db.employee_name ?? "—"}</Td>
                  <Td>
                    {r.hr?.name ?? <span className="text-muted-foreground">—</span>}
                    {r.hr?.workLocation && <div className="text-xs text-muted-foreground">{r.hr.workLocation}</div>}
                  </Td>
                  <Td mono>{formatBatchIntake(r.db.batch_intake) || "—"}</Td>
                  <Td mono>{r.hr?.terminateDate ? formatBatchIntake(r.hr.terminateDate) : "—"}</Td>
                  <Td>
                    <span className="text-xs">{r.reason}</span>
                    {r.matchedBy === "name" && (
                      <Badge variant="outline" className="ml-1 text-[10px]">name match</Badge>
                    )}
                  </Td>
                  <Td>
                    {canBulkTerminate ? (
                      <Button
                        size="sm"
                        variant={bucket === "rehire_suspect" ? "outline" : "destructive"}
                        onClick={() => {
                          const td = r.hr?.terminateDate;
                          const url = td ? `/terminate/${r.db.id}?date=${td}` : `/terminate/${r.db.id}`;
                          window.open(url, "_blank");
                        }}
                      >
                        <UserMinus className="h-3.5 w-3.5 mr-1" /> Terminate
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/lockers", search: { q: r.db.locker_number } as never })}>
                        View
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile card list */}
          <div className="sm:hidden divide-y">
            {visible.map((r) => {
              const isActive = canBulkTerminate;
              return (
                <div key={r.db.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-2">
                      {canBulkTerminate && (
                        <Checkbox
                          className="mt-1"
                          checked={selected.has(r.db.id)}
                          onCheckedChange={(v) => toggleOne(r.db.id, v === true)}
                          aria-label={`Select ${r.db.locker_number}`}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-base">{r.db.locker_number}</div>
                        <div className="text-xs text-muted-foreground truncate">{r.db.location}{r.db.row_label ? ` · ${r.db.row_label}` : ""}</div>
                      </div>
                    </div>
                    {isActive ? (
                      <Button
                        size="sm"
                        variant={bucket === "rehire_suspect" ? "outline" : "destructive"}
                        className="shrink-0"
                        onClick={() => {
                          const td = r.hr?.terminateDate;
                          const url = td ? `/terminate/${r.db.id}?date=${td}` : `/terminate/${r.db.id}`;
                          window.open(url, "_blank");
                        }}
                      >
                        <UserMinus className="h-3.5 w-3.5 mr-1" /> Terminate
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="shrink-0" onClick={() => navigate({ to: "/lockers", search: { q: r.db.locker_number } as never })}>
                        View
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs rounded-md border bg-muted/20 px-2.5 py-2">
                    <div><span className="text-muted-foreground">Badge: </span><span className="font-mono font-medium">{r.db.badge_number ?? "—"}</span></div>
                    <div><span className="text-muted-foreground">Intake: </span><span className="font-mono font-medium">{formatBatchIntake(r.db.batch_intake) || "—"}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">DB Name: </span><span className="font-medium break-words">{r.db.employee_name ?? "—"}</span></div>
                    <div className="col-span-2"><span className="text-muted-foreground">HR Name: </span><span className="font-medium break-words">{r.hr?.name ?? "—"}</span></div>
                    {r.hr?.workLocation && (
                      <div className="col-span-2"><span className="text-muted-foreground">HR Work: </span><span className="font-medium break-words">{r.hr.workLocation}</span></div>
                    )}
                    <div><span className="text-muted-foreground">HR Term: </span><span className="font-mono font-medium">{r.hr?.terminateDate ? formatBatchIntake(r.hr.terminateDate) : "—"}</span></div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Reason: </span>
                      <span className="font-medium">{r.reason}</span>
                      {r.matchedBy === "name" && <Badge variant="outline" className="ml-1 text-[10px]">name match</Badge>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </Card>

      <AlertDialog open={!!confirm} onOpenChange={(v) => { if (!v && !bulkBusy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk termination</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to terminate <strong>{confirm?.label}</strong>. Each locker will be released using its HR termination date (or today if missing) and the reason shown in the table. This cannot be undone in bulk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {progress && (
            <div className="text-xs text-muted-foreground">Processing {progress.done} / {progress.total}…</div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={(e) => { e.preventDefault(); if (confirm) void runBulkTerminate(confirm.ids); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkBusy ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Terminating…</>) : (<><UserMinus className="h-4 w-4 mr-1" /> Confirm Terminate</>)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-md border p-3 bg-muted/30">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-bold ${accent ?? ""}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground border-b">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-2 align-top border-b ${mono ? "font-mono" : ""}`}>{children}</td>;
}

// ---------- helpers ----------

function normBadge(s: string): string {
  return s.toString().trim().replace(/^0+/, "").toLowerCase();
}
function normName(s: string): string {
  return s.toString().toLowerCase().replace(/\s+/g, " ").trim();
}

function toExportRow(r: RowResult): Record<string, unknown> {
  return {
    locker_number: r.db.locker_number,
    location: r.db.location,
    db_badge: r.db.badge_number ?? "",
    db_name: r.db.employee_name ?? "",
    db_batch_intake: formatBatchIntake(r.db.batch_intake),
    hr_badge: r.hr?.badge ?? "",
    hr_name: r.hr?.name ?? "",
    hr_status: r.hr?.status ?? "",
    hr_termination_date: r.hr?.terminateDate ? formatBatchIntake(r.hr.terminateDate) : "",
    hr_join_date: r.hr?.joinDate ? formatBatchIntake(r.hr.joinDate) : "",
    hr_work_location: r.hr?.workLocation ?? "",
    hr_department: r.hr?.department ?? "",
    matched_by: r.matchedBy ?? "",
    reason: r.reason,
  };
}

async function fetchActiveDb(): Promise<DbRow[]> {
  // Fast path: reuse the in-memory lockers cache (already loaded if the user
  // has visited /lockers). Skips a paginated 1k-row roundtrip and any
  // network latency.
  const snap = getLockersSnapshot();
  if (snap && snap.length > 0) {
    const out: DbRow[] = [];
    for (const l of snap) {
      if (l.deleted_at) continue;
      if (!l.employee_name && !l.badge_number) continue;
      // Cached rows carry the already-masked national_id; propagate as-is.
      out.push({
        id: l.id,
        locker_number: l.locker_number,
        location: l.location,
        row_label: l.row_label,
        employee_name: l.employee_name,
        badge_number: l.badge_number,
        national_id: l.national_id,
        batch_intake: l.batch_intake,
        work_location: l.work_location,
        key_lock: l.key_lock,
      });
    }
    return out;
  }

  const out: DbRow[] = [];
  let from = 0;
  while (true) {
    // Query masked view — national_id will be masked unless caller has view_national_id.
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          is: (col: string, v: null) => {
            or: (expr: string) => {
              range: (a: number, b: number) => Promise<{ data: DbRow[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    })
      .from("lockers_masked")
      .select("id, locker_number, location, row_label, employee_name, badge_number, national_id, batch_intake, work_location, key_lock")
      .is("deleted_at", null)
      .or("employee_name.not.is.null,badge_number.not.is.null")
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as DbRow[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}


async function parseHr(f: File, filename?: string): Promise<HrPerson[]> {
  const ext = f.name.split(".").pop()?.toLowerCase();
  let rows: Record<string, unknown>[];
  if (ext === "csv") {
    rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data as Record<string, unknown>[]),
        error: (err) => reject(err),
      });
    });
  } else {
    const buf = await f.arrayBuffer();
    const XLSX = await getXLSX();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    // pick the sheet with the most rows (handles "grddyn" + hidden helper sheets)
    let bestSheet = wb.SheetNames[0];
    let bestRows = -1;
    for (const name of wb.SheetNames) {
      const s = wb.Sheets[name];
      const ref = s["!ref"]; if (!ref) continue;
      const range = XLSX.utils.decode_range(ref);
      const nrows = range.e.r - range.s.r;
      if (nrows > bestRows) { bestRows = nrows; bestSheet = name; }
    }
    // Auto-detect header row: some HR exports have title/blank rows above
    // the real header (e.g. "Employee Code" / "Employee Name" on row 3).
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[bestSheet], { header: 1, defval: "", raw: true });
    let headerIdx = 0;
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const row = aoa[i] ?? [];
      const norm = row.map((c) => n(String(c ?? "")));
      const hasName = norm.some((h) => ["employeename", "name", "fullname", "legalname"].includes(h));
      const hasCode = norm.some((h) => ["employeecode", "empcode", "employeeid", "empid", "badgenumber", "badge", "personnumber"].includes(h));
      if (hasName || hasCode) { headerIdx = i; break; }
    }
    const headerRow = (aoa[headerIdx] ?? []).map((c, i) => {
      const s = String(c ?? "").trim();
      return s === "" ? `__col${i}` : s;
    });
    rows = [];
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const r = aoa[i] ?? [];
      if (r.every((c) => c === "" || c === null || c === undefined)) continue;
      const obj: Record<string, unknown> = {};
      for (let j = 0; j < headerRow.length; j++) obj[headerRow[j]] = r[j] ?? "";
      rows.push(obj);
    }
  }
  if (rows.length === 0) throw new Error("Empty HR file");

  const headers = Object.keys(rows[0]);
  const cols = detectHrCols(headers);
  if (!cols.badge && !cols.name) throw new Error("Couldn't find Employee Code or Employee Name in the file.");

  // Filename hint: "termination list", "terminated list", etc → assume every
  // row in the file is a terminated employee, even if no Status column exists
  // and no Terminate Date column was detected.
  const fnameLower = (filename ?? f.name).toLowerCase();
  const filenameSaysTerminated = /terminat|resign|leaver|exit\s*list/.test(fnameLower);

  const out: HrPerson[] = [];
  for (const r of rows) {
    const badge = cols.badge ? cellStr(r[cols.badge]) : null;
    const name = cols.name ? cellStr(r[cols.name]) : null;
    if (!badge && !name) continue;
    const statusRaw = cols.status ? cellStr(r[cols.status])?.toLowerCase() ?? "" : "";
    const terminateDate = cols.terminate ? parseBatchIntake(r[cols.terminate]) : null;
    const status: HrPerson["status"] =
      statusRaw.includes("terminat") || statusRaw === "resigned"
        || (!!terminateDate && !statusRaw.includes("current"))
        || (filenameSaysTerminated && !statusRaw.includes("current"))
        ? "terminated"
        : "current";
    out.push({
      badge,
      name,
      status,
      joinDate: cols.join ? parseBatchIntake(r[cols.join]) : null,
      terminateDate,
      workLocation: cols.workLocation ? cellStr(r[cols.workLocation]) : null,
      gradeset: cols.gradeset ? cellStr(r[cols.gradeset]) : null,
      department: cols.department ? cellStr(r[cols.department]) : null,
    });
  }
  return out;
}

function cellStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function n(s: string): string { return s.toLowerCase().replace(/[\s_\-/+().]/g, ""); }

function detectHrCols(headers: string[]): {
  badge?: string; name?: string; status?: string;
  terminate?: string; join?: string; workLocation?: string;
  gradeset?: string; department?: string;
} {
  const out: Record<string, string> = {};
  const map: Record<string, string[]> = {
    badge: ["employeecode", "empcode", "employeeid", "empid", "badgenumber", "badge", "personnumber"],
    name: ["employeename", "name", "fullname", "legalname"],
    status: ["status", "employeestatus", "employmentstatus", "75", "57"],
    terminate: ["t1terminatedate", "terminatedate", "terminationdate", "terminated", "termdate", "resigndate", "resignationdate", "lastworkingday", "lastworkingdate", "lwd", "exitdate", "leavingdate", "dateofleaving", "dateoftermination"],
    join: ["joincompanydate", "joindate", "hiredate", "joiningdate", "dateofjoining"],
    workLocation: ["worklocation", "location", "site"],
    gradeset: ["gradeset", "grade"],
    department: ["departmentname", "department", "deptname"],
  };
  for (const [k, opts] of Object.entries(map)) {
    for (const h of headers) {
      if (opts.includes(n(h))) { out[k] = h; break; }
    }
  }
  // fallback for status column that just contains "Current"/"Terminated" values
  if (!out.status) {
    for (const h of headers) {
      const sample = n(h);
      if (sample === "75" || sample === "57") { out.status = h; break; }
    }
  }
  return out;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Mednefits Termination ----------

type MedRow = {
  personNumber: string | null;
  name: string | null;
  nationalId: string | null;
  remarks: string | null;
};

type MedResult =
  | { kind: "match"; med: MedRow; db: DbRow; matchedBy: "national_id" | "name" }
  | { kind: "unmatched"; med: MedRow };

function MednefitsSection({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const { role } = useAuth();
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [results, setResults] = useState<MedResult[] | null>(null);
  const [deletionsCount, setDeletionsCount] = useState(0);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"matched" | "unmatched">("matched");

  const handleFile = async (f: File) => {
    setBusy(true);
    setResults(null);
    setFilename(f.name);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const deletions = await parseMednefits(f);

      setDeletionsCount(deletions.length);
      if (deletions.length === 0) {
        toast.info("No 'Deletion' rows found in the Mednefits file.");
        setResults([]);
        return;
      }
      const dbRows = await fetchActiveDb();
      const byNid = new Map<string, DbRow>();
      const byName = new Map<string, DbRow>();
      for (const d of dbRows) {
        if (d.national_id) byNid.set(normBadge(d.national_id), d);
        if (d.employee_name) byName.set(normName(d.employee_name), d);
      }
      const out: MedResult[] = [];
      for (const m of deletions) {
        let hit: DbRow | undefined;
        let by: "national_id" | "name" | null = null;
        if (m.nationalId) { hit = byNid.get(normBadge(m.nationalId)); if (hit) by = "national_id"; }
        if (!hit && m.name) { hit = byName.get(normName(m.name)); if (hit) by = "name"; }
        if (hit && by) out.push({ kind: "match", med: m, db: hit, matchedBy: by });
        else out.push({ kind: "unmatched", med: m });
      }
      out.sort((a, b) => {
        if (a.kind === "match" && b.kind === "match")
          return compareLockerNumbers(a.db.locker_number, b.db.locker_number);
        return a.kind === "match" ? -1 : b.kind === "match" ? 1 : 0;
      });
      setResults(out);
      const matchedCount = out.filter((r) => r.kind === "match").length;
      toast.success(`Mednefits parsed — ${matchedCount} deletion(s) matched to active lockers, ${out.length - matchedCount} unmatched.`);
      setTab(matchedCount > 0 ? "matched" : "unmatched");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mednefits parse failed");
    } finally {
      setBusy(false);
    }
  };

  const matched = useMemo(() => results?.filter((r): r is Extract<MedResult, { kind: "match" }> => r.kind === "match") ?? [], [results]);
  const unmatched = useMemo(() => results?.filter((r): r is Extract<MedResult, { kind: "unmatched" }> => r.kind === "unmatched") ?? [], [results]);

  const q = search.trim().toLowerCase();
  const matchedFiltered = !q ? matched : matched.filter((r) => {
    const hay = [r.db.locker_number, r.db.employee_name, r.db.badge_number, r.db.national_id, r.med.name, r.med.nationalId, r.med.personNumber].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
  const unmatchedFiltered = !q ? unmatched : unmatched.filter((r) => {
    const hay = [r.med.name, r.med.nationalId, r.med.personNumber].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  const exportXlsx = async () => {
    if (!results) return;
    if (!confirmNidExport()) return;
    const XLSX = await getXLSX();
    const wb = XLSX.utils.book_new();
    const matchedRows = matched.map((r) => ({
      locker_number: r.db.locker_number,
      location: r.db.location,
      row: r.db.row_label ?? "",
      db_name: r.db.employee_name ?? "",
      db_badge: r.db.badge_number ?? "",
      db_national_id: r.db.national_id ?? "",
      med_name: r.med.name ?? "",
      med_national_id: r.med.nationalId ?? "",
      med_person_number: r.med.personNumber ?? "",
      matched_by: r.matchedBy,
    }));
    const unmatchedRows = unmatched.map((r) => ({
      med_name: r.med.name ?? "",
      med_national_id: r.med.nationalId ?? "",
      med_person_number: r.med.personNumber ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchedRows.length ? matchedRows : [{ note: "(empty)" }]), "Must Terminate");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unmatchedRows.length ? unmatchedRows : [{ note: "(empty)" }]), "Unmatched");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `mednefits-termination-${stamp}.xlsx`);
  };

  return (
    <>
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="max-w-md"
          />
          {filename && <Badge variant="outline" className="font-mono">{filename}</Badge>}
          {busy && <span className="text-sm text-muted-foreground">Parsing…</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Upload the Mednefits weekly file (e.g. <span className="font-mono">WW44_26.xlsx</span>). The system scans the <strong>Remarks</strong> column and treats every <span className="font-mono">Deletion</span> row as a termination, matching by <strong>National ID</strong> first, then by <strong>name</strong>.
        </p>
        {results && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Deletions in file" value={deletionsCount} />
            <Stat label="Matched to lockers" value={matched.length} accent="text-destructive" />
            <Stat label="Unmatched" value={unmatched.length} accent="text-warning" />
          </div>
        )}
      </Card>

      {results && results.length > 0 && (
        <>
          <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search name / national ID / locker…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {role === "admin" && (
              <Button variant="outline" size="sm" onClick={exportXlsx}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export Excel
              </Button>
            )}
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "matched" | "unmatched")} className="mt-4">
            <TabsList className="grid grid-cols-2 w-full max-w-md">
              <TabsTrigger value="matched" className="gap-2">
                <UserMinus className="h-4 w-4" /> Must Terminate
                <Badge variant="destructive" className="ml-1">{matched.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="unmatched" className="gap-2">
                <HelpCircle className="h-4 w-4" /> Unmatched
                <Badge variant="secondary" className="ml-1">{unmatched.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="matched" className="mt-4">
              {matchedFiltered.length === 0 ? (
                <Card className="p-10 text-center text-sm text-muted-foreground">No matched deletions.</Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr className="text-left">
                          <Th>Locker</Th>
                          <Th>Location / Row</Th>
                          <Th>DB Name</Th>
                          <Th>DB National ID</Th>
                          <Th>Mednefits Name</Th>
                          <Th>Mednefits National ID</Th>
                          <Th>Matched By</Th>
                          <Th>Action</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchedFiltered.map((r, i) => (
                          <tr key={r.db.id} className={i % 2 ? "bg-muted/20" : ""}>
                            <Td mono>{r.db.locker_number}</Td>
                            <Td>
                              <div>{r.db.location}</div>
                              <div className="text-xs text-muted-foreground">{r.db.row_label ?? "—"}</div>
                            </Td>
                            <Td>{r.db.employee_name ?? "—"}</Td>
                            <Td mono><NationalIdCell value={r.db.national_id} recordId={r.db.id} table="lockers" /></Td>
                            <Td>{r.med.name ?? "—"}</Td>
                            <Td mono>{r.med.nationalId ?? "—"}</Td>
                            <Td>
                              <Badge variant="outline" className="text-[10px]">
                                {r.matchedBy === "national_id" ? "national id" : "name"}
                              </Badge>
                            </Td>
                            <Td>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => window.open(`/terminate/${r.db.id}`, "_blank")}
                              >
                                <UserMinus className="h-3.5 w-3.5 mr-1" /> Terminate
                              </Button>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="unmatched" className="mt-4">
              {unmatchedFiltered.length === 0 ? (
                <Card className="p-10 text-center text-sm text-muted-foreground">All deletions matched.</Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr className="text-left">
                          <Th>Mednefits Name</Th>
                          <Th>National ID</Th>
                          <Th>Person Number</Th>
                          <Th>Action</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatchedFiltered.map((r, i) => (
                          <tr key={`${r.med.personNumber ?? r.med.nationalId ?? r.med.name}-${i}`} className={i % 2 ? "bg-muted/20" : ""}>
                            <Td>{r.med.name ?? "—"}</Td>
                            <Td mono>{r.med.nationalId ?? "—"}</Td>
                            <Td mono>{r.med.personNumber ?? "—"}</Td>
                            <Td>
                              <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/lockers", search: { q: r.med.name ?? r.med.nationalId ?? "" } as never })}>
                                Search lockers
                              </Button>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}

async function parseMednefits(f: File): Promise<MedRow[]> {
  const ext = f.name.split(".").pop()?.toLowerCase();
  let raw: unknown[][];
  if (ext === "csv") {
    const text = await f.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    raw = parsed.data as unknown[][];
  } else {
    const buf = await f.arrayBuffer();
    const XLSX = await getXLSX();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    // Prefer the "List" sheet if present; else the sheet with the most rows.
    let bestSheet = wb.SheetNames[0];
    let bestRows = -1;
    for (const name of wb.SheetNames) {
      if (/list/i.test(name)) { bestSheet = name; break; }
      const s = wb.Sheets[name];
      const ref = s["!ref"]; if (!ref) continue;
      const range = XLSX.utils.decode_range(ref);
      const nrows = range.e.r - range.s.r;
      if (nrows > bestRows) { bestRows = nrows; bestSheet = name; }
    }
    raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[bestSheet], { header: 1, defval: "", raw: true });
  }

  // Find the header row — the first row containing any of our target headers.
  let headerIdx = -1;
  let headerMap: { person?: number; name?: number; nid?: number; remarks?: number } = {};
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const row = raw[i] ?? [];
    const map: typeof headerMap = {};
    row.forEach((cell, idx) => {
      const k = n(String(cell ?? ""));
      if (!k) return;
      if (k === "personnumber" || k === "empid" || k === "employeeid") map.person = idx;
      else if (k === "legalfullname" || k === "fullname" || k === "name" || k === "employeename") map.name = idx;
      else if (k === "nationalid" || k === "icno" || k === "ic" || k === "passport" || k === "passportno" || k === "nationalidno") map.nid = idx;
      else if (k === "remarks" || k === "remark") map.remarks = idx;
    });
    if (map.remarks !== undefined && (map.name !== undefined || map.nid !== undefined)) {
      headerIdx = i;
      headerMap = map;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Couldn't find header row with 'Remarks' + 'Legal Full Name'/'National ID' in the Mednefits file.");

  const out: MedRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] ?? [];
    const remarks = headerMap.remarks !== undefined ? String(row[headerMap.remarks] ?? "").trim() : "";
    if (!/deletion/i.test(remarks)) continue;
    const name = headerMap.name !== undefined ? cellStr(row[headerMap.name]) : null;
    const nid = headerMap.nid !== undefined ? cellStr(row[headerMap.nid]) : null;
    const person = headerMap.person !== undefined ? cellStr(row[headerMap.person]) : null;
    if (!name && !nid && !person) continue;
    out.push({ personNumber: person, name, nationalId: nid, remarks });
  }
  return out;
}
