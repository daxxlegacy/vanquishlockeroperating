import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMinus, Search, Upload as UploadIcon, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { formatBatchIntake } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Term = Database["public"]["Tables"]["terminations"]["Row"];

export const Route = createFileRoute("/terminations")({
  head: () => ({
    meta: [
      { title: "Terminations — LockerOps" },
      { name: "description", content: "Log of users freed from lockers, with termination dates and reasons." },
    ],
  }),
  component: TerminationsPage,
});

type RosterPerson = { badge: string | null; name: string | null; rowNum: number };
type MatchedTermination = RosterPerson & {
  matchedBy: "badge" | "name";
  termination_date: string;
  locker_number: string;
  location: string | null;
  db_employee_name: string | null;
  db_badge_number: string | null;
  reason: string | null;
};
type MatchedActive = RosterPerson & {
  matchedBy: "badge" | "name";
  locker_number: string;
  location: string | null;
  db_employee_name: string | null;
  db_badge_number: string | null;
  status: string;
};
interface CheckResult {
  filename: string;
  fileCount: number;
  terminatedCount: number;
  activeCount: number;
  notFoundCount: number;
  notTerminated: RosterPerson[];
  terminated: MatchedTermination[];
  active: MatchedActive[];
  notFound: RosterPerson[];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getStr(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

function detectRosterColumns(keys: string[]): { badge?: string; name?: string } {
  const lc = keys.map((k) => ({ k, n: k.toLowerCase().replace(/[^a-z0-9]/g, "") }));
  const find = (candidates: string[]) => lc.find(({ n }) => candidates.some((c) => n.includes(c)))?.k;
  return {
    badge: find(["badge", "empid", "employeeid", "staffid", "id"]),
    name: find(["name", "employee", "fullname"]),
  };
}

async function parseRoster(f: File): Promise<Record<string, unknown>[]> {
  const ext = f.name.toLowerCase().split(".").pop();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse(f, {
        header: true, skipEmptyLines: true,
        complete: (res) => resolve(res.data as Record<string, unknown>[]),
        error: reject,
      });
    });
  }
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function TerminationsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("terminations").select("*").is("undone_at", null).order("termination_date", { ascending: false }).limit(2000)
      .then(({ data }) => setItems(data ?? []));
  }, [user]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((t) =>
      t.employee_name?.toLowerCase().includes(s) ||
      t.badge_number?.toLowerCase().includes(s) ||
      t.locker_number.toLowerCase().includes(s) ||
      t.location?.toLowerCase().includes(s),
    );
  }, [items, q]);

  const runCheck = async (f: File) => {
    setCheckBusy(true);
    setCheckResult(null);
    try {
      const rows = await parseRoster(f);
      if (rows.length === 0) { toast.error("File is empty."); setCheckBusy(false); return; }
      const detected = detectRosterColumns(Object.keys(rows[0]));
      if (!detected.badge && !detected.name) {
        toast.error("Couldn't find a badge or name column in the file.");
        setCheckBusy(false); return;
      }

      const people: RosterPerson[] = [];
      rows.forEach((r, i) => {
        const badge = detected.badge ? getStr(r, detected.badge) ?? null : null;
        const name = detected.name ? getStr(r, detected.name) ?? null : null;
        if (!badge && !name) return;
        people.push({ badge, name, rowNum: i + 2 });
      });

      // Pull all active terminations
      const allTerms: Term[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("terminations").select("*").is("undone_at", null).range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTerms.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }

      const byBadge = new Map<string, Term>();
      const byName = new Map<string, Term>();
      for (const t of allTerms) {
        if (t.badge_number) byBadge.set(t.badge_number.toLowerCase().trim(), t);
        if (t.employee_name) byName.set(t.employee_name.toLowerCase().trim(), t);
      }

      const terminated: MatchedTermination[] = [];
      const notTerminated: RosterPerson[] = [];
      for (const p of people) {
        const bm = p.badge ? byBadge.get(p.badge.toLowerCase().trim()) : undefined;
        const nm = !bm && p.name ? byName.get(p.name.toLowerCase().trim()) : undefined;
        const m = bm ?? nm;
        if (m) {
          terminated.push({
            ...p,
            matchedBy: bm ? "badge" : "name",
            termination_date: m.termination_date,
            locker_number: m.locker_number,
            location: m.location,
            db_employee_name: m.employee_name,
            db_badge_number: m.badge_number,
            reason: m.reason,
          });
        } else {
          notTerminated.push(p);
        }
      }

      setCheckResult({
        filename: f.name,
        fileCount: people.length,
        terminatedCount: terminated.length,
        terminated,
        notTerminated,
      });
      toast.success(`Checked ${people.length} people — ${terminated.length} terminated, ${notTerminated.length} active.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    }
    setCheckBusy(false);
  };

  const exportCheck = (fmt: "xlsx" | "csv") => {
    if (!checkResult) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const terminatedRows = checkResult.terminated.map((p) => ({
      file_badge: p.badge ?? "", file_name: p.name ?? "",
      matched_by: p.matchedBy,
      termination_date: formatBatchIntake(p.termination_date),
      locker_number: p.locker_number, location: p.location ?? "",
      db_badge: p.db_badge_number ?? "", db_name: p.db_employee_name ?? "",
      reason: p.reason ?? "",
    }));
    const notRows = checkResult.notTerminated.map((p) => ({
      file_badge: p.badge ?? "", file_name: p.name ?? "",
    }));
    if (fmt === "csv") {
      const csv = Papa.unparse([
        ...terminatedRows.map((r) => ({ section: "terminated", ...r })),
        ...notRows.map((r) => ({ section: "not_terminated", ...r })),
      ]);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `terminations-check-${stamp}.csv`);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(terminatedRows.length ? terminatedRows : [{ note: "(empty)" }]), "Terminated");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notRows.length ? notRows : [{ note: "(empty)" }]), "Not Terminated");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `terminations-check-${stamp}.xlsx`);
    }
    toast.success("Exported.");
  };

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <UserMinus className="h-6 w-6" />
          <div>
            <h1 className="font-display text-3xl font-bold">Terminations</h1>
            <p className="text-muted-foreground text-sm">{items?.length.toLocaleString() ?? "…"} records</p>
          </div>
        </div>

        {/* Roster check upload */}
        <Card className="p-5 mb-4">
          <div className="flex items-start gap-3">
            <UploadIcon className="h-5 w-5 text-primary mt-1" />
            <div className="flex-1">
              <Label className="font-display text-base">Check roster against terminations</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Upload an Excel or CSV file with a badge number and/or employee name column. The system matches each person against the termination list and shows who is terminated and who is still active.
              </p>
              <div className="flex gap-3 items-center flex-wrap">
                <Input
                  type="file" accept=".csv,.xlsx,.xls"
                  onChange={(e) => e.target.files?.[0] && runCheck(e.target.files[0])}
                  className="cursor-pointer max-w-md"
                />
                {checkBusy && <Badge variant="secondary">Checking…</Badge>}
                {checkResult && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => exportCheck("xlsx")}>
                      <Download className="h-4 w-4 mr-1" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => exportCheck("csv")}>
                      <Download className="h-4 w-4 mr-1" /> CSV
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>

        {checkResult && (
          <Card className="p-5 mb-6 space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <Stat label="People in file" value={checkResult.fileCount} />
              <Stat label="Terminated" value={checkResult.terminatedCount} tone="warn" />
              <Stat label="Not terminated" value={checkResult.notTerminated.length} tone="ok" />
            </div>

            <div>
              <h3 className="font-display font-semibold flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-destructive" /> Terminated ({checkResult.terminated.length})
              </h3>
              <div className="overflow-x-auto border rounded-md max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left sticky top-0">
                    <tr><Th>File badge</Th><Th>File name</Th><Th>Termination date</Th><Th>Locker</Th><Th>Match</Th></tr>
                  </thead>
                  <tbody>
                    {checkResult.terminated.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">None</td></tr>
                    ) : checkResult.terminated.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2 font-mono">{p.badge ?? "—"}</td>
                        <td className="px-3 py-2">{p.name ?? "—"}</td>
                        <td className="px-3 py-2">{formatBatchIntake(p.termination_date)}</td>
                        <td className="px-3 py-2 font-mono">{p.locker_number}</td>
                        <td className="px-3 py-2 text-xs"><Badge variant="secondary">{p.matchedBy}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-display font-semibold flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-primary" /> Not terminated ({checkResult.notTerminated.length})
              </h3>
              <div className="overflow-x-auto border rounded-md max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left sticky top-0">
                    <tr><Th>Badge</Th><Th>Name</Th></tr>
                  </thead>
                  <tbody>
                    {checkResult.notTerminated.length === 0 ? (
                      <tr><td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">None</td></tr>
                    ) : checkResult.notTerminated.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2 font-mono">{p.badge ?? "—"}</td>
                        <td className="px-3 py-2">{p.name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-3 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, badge, locker, location…" className="pl-9" />
          </div>
        </Card>

        <Card className="overflow-hidden">
          {!items ? (
            <div className="p-6 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No terminations match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <Th>Termination Date</Th><Th>Employee</Th><Th>Badge</Th>
                    <Th>Locker #</Th><Th>Location</Th><Th>Row</Th><Th>Reason</Th><Th>By</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-2 font-medium">{formatBatchIntake(t.termination_date)}</td>
                      <td className="px-3 py-2">{t.employee_name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.badge_number ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{t.locker_number}</td>
                      <td className="px-3 py-2">{t.location ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.row_label ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate" title={t.reason ?? ""}>{t.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.terminated_by_email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const cls = tone === "warn" ? "text-destructive" : tone === "ok" ? "text-primary" : "";
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-display text-2xl font-bold ${cls}`}>{value.toLocaleString()}</div>
    </div>
  );
}
