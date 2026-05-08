import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounced } from "@/hooks/use-debounced";
import * as XLSX from "xlsx";
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
import { UserMinus, AlertTriangle, UserCheck, HelpCircle, Search, Download, FileSpreadsheet, ShieldAlert, RotateCcw, Info } from "lucide-react";
import { toast } from "sonner";
import { parseBatchIntake, formatBatchIntake } from "@/lib/locker-utils";
import { saveReconcileState, loadReconcileState, clearReconcileState, readReconcileMeta } from "@/lib/reconcile-store";

export const Route = createFileRoute("/reconcile")({
  head: () => ({
    meta: [
      { title: "Reconcile HR roster — LockerOps" },
      { name: "description", content: "Compare HR listing against active locker occupants to find users who must be terminated, rehired, or are missing from HR." },
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
  batch_intake: string | null; // ISO
  work_location: string | null;
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
  const { user, loading } = useAuth();
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
      const hr = await parseHr(f);
      const dbRows = await fetchActiveDb();
      setHrCount({
        current: hr.filter((p) => p.status === "current").length,
        terminated: hr.filter((p) => p.status === "terminated").length,
      });
      setDbCount(dbRows.length);

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
        const terminated = matches.find((m) => m.status === "terminated") ?? null;

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
    if (!q) return inBucket;
    return inBucket.filter((r) => {
      const hay = [
        r.db.locker_number, r.db.employee_name, r.db.badge_number,
        r.db.location, r.db.row_label, r.hr?.name, r.hr?.badge,
        r.hr?.workLocation, r.hr?.department, r.reason,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [results, tab, debouncedSearch]);

  const counts = results ? bucketCounts(results) : { must_terminate: 0, rehire_suspect: 0, missing_from_hr: 0, ok_current: 0 };

  const exportAll = (fmt: "xlsx" | "csv") => {
    if (!results) return;
    const sheets: Record<string, Record<string, unknown>[]> = {
      "Must Terminate": results.filter((r) => r.bucket === "must_terminate").map(toExportRow),
      "Rehire Suspect": results.filter((r) => r.bucket === "rehire_suspect").map(toExportRow),
      "Missing from HR": results.filter((r) => r.bucket === "missing_from_hr").map(toExportRow),
      "OK Current": results.filter((r) => r.bucket === "ok_current").map(toExportRow),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === "csv") {
      const flat = (Object.entries(sheets) as [string, Record<string, unknown>[]][])
        .flatMap(([k, rows]) => rows.map((r) => ({ bucket: k, ...r })));
      const csv = Papa.unparse(flat);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `reconcile-${stamp}.csv`);
    } else {
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
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-7 w-7 text-warning" />
              Reconcile with HR Listing
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Upload the HR employee listing (Excel/CSV). The system compares every active locker occupant against the file and groups them so you can act safely — especially before terminating.
            </p>
          </div>
        </div>

        {restored && results && (
          <Alert className="mt-6 border-primary/40 bg-primary/5">
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

        <Card className="mt-6 p-6">
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
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => exportAll("xlsx")}>
                  <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportAll("csv")}>
                  <Download className="h-4 w-4 mr-1.5" /> Export CSV
                </Button>
              </div>
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
                <ResultsTable rows={filtered} bucket={tab} navigate={navigate} />
              </TabsContent>
            </Tabs>
          </>
        )}
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
  rows, bucket, navigate,
}: {
  rows: RowResult[];
  bucket: Bucket;
  navigate: ReturnType<typeof useNavigate>;
}) {
  if (rows.length === 0) {
    return <Card className="p-10 text-center text-sm text-muted-foreground">No rows in this bucket.</Card>;
  }
  return (
    <Card className="overflow-hidden">
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr className="text-left">
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
            {rows.map((r, i) => (
              <tr key={r.db.id} className={i % 2 ? "bg-muted/20" : ""}>
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
                  {bucket === "must_terminate" || bucket === "rehire_suspect" ? (
                    <Button
                      size="sm"
                      variant={bucket === "rehire_suspect" ? "outline" : "destructive"}
                      onClick={() => window.open(`/terminate/${r.db.id}`, "_blank")}
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
      </div>
    </Card>
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
    row: r.db.row_label ?? "",
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
  const out: DbRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("lockers")
      .select("id, locker_number, location, row_label, employee_name, badge_number, batch_intake, work_location")
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

async function parseHr(f: File): Promise<HrPerson[]> {
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
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    // pick the sheet with the most rows (handles "grddyn" + hidden helper sheets)
    let bestSheet = wb.SheetNames[0];
    let bestRows = -1;
    for (const name of wb.SheetNames) {
      const s = wb.Sheets[name];
      const ref = s["!ref"]; if (!ref) continue;
      const range = XLSX.utils.decode_range(ref);
      const n = range.e.r - range.s.r;
      if (n > bestRows) { bestRows = n; bestSheet = name; }
    }
    rows = XLSX.utils.sheet_to_json(wb.Sheets[bestSheet], { defval: "", raw: true });
  }
  if (rows.length === 0) throw new Error("Empty HR file");

  const headers = Object.keys(rows[0]);
  const cols = detectHrCols(headers);
  if (!cols.badge && !cols.name) throw new Error("Couldn't find Employee Code or Employee Name in the file.");

  const out: HrPerson[] = [];
  for (const r of rows) {
    const badge = cols.badge ? cellStr(r[cols.badge]) : null;
    const name = cols.name ? cellStr(r[cols.name]) : null;
    if (!badge && !name) continue;
    const statusRaw = cols.status ? cellStr(r[cols.status])?.toLowerCase() ?? "" : "";
    const terminateDate = cols.terminate ? parseBatchIntake(r[cols.terminate]) : null;
    const status: HrPerson["status"] =
      statusRaw.includes("terminat") || statusRaw === "resigned" || (!!terminateDate && !statusRaw.includes("current"))
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

function n(s: string): string { return s.toLowerCase().replace(/[\s_\-/+()]/g, ""); }

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
    terminate: ["t1terminatedate", "terminatedate", "terminationdate", "resigndate", "resignationdate", "lastworkingday"],
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
