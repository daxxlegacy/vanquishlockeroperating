// Automation tab — bulk auto-terminate active lockers whose employees aren't in an uploaded roster.
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Zap, Upload as UploadIcon, AlertCircle, CheckCircle2, UserMinus, Play } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation — LockerOps" },
      { name: "description", content: "Run automated locker tasks like bulk auto-termination from a roster file." },
    ],
  }),
  component: AutomationPage,
});

type LockerLite = { id: string; locker_number: string; location: string | null; row_label: string | null; employee_name: string | null; badge_number: string | null; status: string };
type RosterPerson = { badge: string | null; name: string | null };
type Candidate = LockerLite & { reason: "no_badge_match" | "no_name_match" };

function detectCols(keys: string[]): { badge?: string; name?: string } {
  const lc = keys.map((k) => ({ k, n: k.toLowerCase().replace(/[^a-z0-9]/g, "") }));
  const find = (cands: string[]) => lc.find(({ n }) => cands.some((c) => n.includes(c)))?.k;
  return { badge: find(["badge", "empid", "employeeid", "staffid", "id"]), name: find(["name", "employee", "fullname"]) };
}
function getStr(r: Record<string, unknown>, k: string): string | undefined {
  const v = r[k]; if (v == null) return undefined;
  const s = String(v).trim(); return s.length === 0 ? undefined : s;
}
async function parseRoster(f: File): Promise<Record<string, unknown>[]> {
  const ext = f.name.toLowerCase().split(".").pop();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse(f, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data as Record<string, unknown>[]), error: reject });
    });
  }
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

function AutomationPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";

  const [busy, setBusy] = useState(false);
  const [rosterName, setRosterName] = useState<string | null>(null);
  const [rosterCount, setRosterCount] = useState(0);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [reason, setReason] = useState("Auto-terminated — not present in latest roster");
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const [date, setDate] = useState(todayStr);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const dateError = useMemo(() => {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date.trim())) return "Format must be dd/mm/yyyy";
    const [dd, mm, yyyy] = date.trim().split("/").map((n) => parseInt(n, 10));
    if (mm < 1 || mm > 12) return "Invalid month";
    const days = new Date(yyyy, mm, 0).getDate();
    if (dd < 1 || dd > days) return `Day must be 01–${days} for ${mm}/${yyyy}`;
    if (yyyy < 2000 || yyyy > 2100) return "Year 2000–2100";
    return null;
  }, [date]);
  const iso = !dateError ? (() => { const [dd, mm, yyyy] = date.trim().split("/"); return `${yyyy}-${mm}-${dd}`; })() : null;

  const runPreview = async (f: File) => {
    setBusy(true);
    setCandidates(null);
    setRosterName(f.name);
    try {
      const rows = await parseRoster(f);
      if (rows.length === 0) throw new Error("Roster file is empty");
      const cols = detectCols(Object.keys(rows[0]));
      if (!cols.badge && !cols.name) throw new Error("Couldn't find a badge or name column");

      const badges = new Set<string>();
      const names = new Set<string>();
      for (const r of rows) {
        const b = cols.badge ? getStr(r, cols.badge) : undefined;
        const n = cols.name ? getStr(r, cols.name) : undefined;
        if (b) badges.add(b.toLowerCase().trim());
        if (n) names.add(n.toLowerCase().trim());
      }
      setRosterCount(badges.size + names.size > 0 ? rows.length : 0);

      // Pull all currently-assigned active lockers
      const all: LockerLite[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("id,locker_number,location,row_label,employee_name,badge_number,status")
          .is("deleted_at", null)
          .eq("status", "active")
          .or("employee_name.not.is.null,badge_number.not.is.null")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as LockerLite[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      setActiveCount(all.length);

      const cands: Candidate[] = [];
      for (const l of all) {
        const b = l.badge_number?.toLowerCase().trim();
        const n = l.employee_name?.toLowerCase().trim();
        const badgeMatch = b ? badges.has(b) : false;
        const nameMatch = n ? names.has(n) : false;
        if (!badgeMatch && !nameMatch) {
          cands.push({ ...l, reason: b ? "no_badge_match" : "no_name_match" });
        }
      }
      setCandidates(cands);
      toast.success(`Found ${cands.length} active lockers not in the roster.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
      setRosterName(null);
    }
    setBusy(false);
  };

  const canRun = isAdmin && candidates && candidates.length > 0 && !dateError && confirmText.trim() === "TERMINATE";

  const runBulkTerminate = async () => {
    if (!canRun || !candidates || !iso || !user) return;
    setRunning(true);
    setProgress({ done: 0, total: candidates.length, failed: 0 });
    let done = 0, failed = 0;
    for (const l of candidates) {
      try {
        const { error: e1 } = await supabase.from("terminations").insert({
          locker_id: l.id,
          locker_number: l.locker_number,
          location: l.location,
          row_label: l.row_label,
          employee_name: l.employee_name,
          badge_number: l.badge_number,
          termination_date: iso,
          reason: reason.trim() || null,
          terminated_by: user.id,
          terminated_by_email: user.email ?? null,
          prior_status: l.status,
          prior_employee_name: l.employee_name,
          prior_badge_number: l.badge_number,
        });
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from("lockers")
          .update({ employee_name: null, badge_number: null, status: "empty" })
          .eq("id", l.id);
        if (e2) throw e2;
        done++;
      } catch {
        failed++;
      }
      setProgress({ done: done + failed, total: candidates.length, failed });
    }
    setRunning(false);
    setCandidates(null);
    setConfirmText("");
    toast.success(`Auto-termination complete — ${done} terminated, ${failed} failed.`);
  };

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="h-6 w-6 text-warning" />
          <h1 className="font-display text-3xl font-bold">Automation</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Run on-demand automated tasks. Currently: bulk auto-terminate active lockers whose employees are missing from an uploaded roster file.
        </p>

        {!isAdmin && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Admin only</AlertTitle>
            <AlertDescription>Only admins can run automation tasks.</AlertDescription>
          </Alert>
        )}

        <Card className="p-5 mb-4">
          <div className="flex items-start gap-3">
            <UploadIcon className="h-5 w-5 text-primary mt-1" />
            <div className="flex-1 space-y-3">
              <div>
                <Label className="font-display text-base">Step 1 — Upload current employee roster</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Excel or CSV with a badge number and/or employee name column. Anyone in the database who is NOT in this file will be flagged for termination.
                </p>
              </div>
              <Input
                type="file" accept=".csv,.xlsx,.xls"
                disabled={busy || running}
                onChange={(e) => e.target.files?.[0] && runPreview(e.target.files[0])}
                className="cursor-pointer max-w-md"
              />
              {rosterName && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{rosterName}</Badge>
                  <Badge variant="outline">{rosterCount} rows in file</Badge>
                  {activeCount !== null && <Badge variant="outline">{activeCount} active lockers in DB</Badge>}
                </div>
              )}
            </div>
          </div>
        </Card>

        {candidates && (
          <Card className="p-5 mb-4 space-y-4">
            <div className="flex items-center gap-2">
              <UserMinus className="h-5 w-5 text-destructive" />
              <h2 className="font-display text-lg font-bold">Step 2 — Review candidates ({candidates.length})</h2>
            </div>
            {candidates.length === 0 ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Nothing to do</AlertTitle>
                <AlertDescription>Every active locker user is in the roster. No terminations needed.</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="overflow-x-auto border rounded-md max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left sticky top-0">
                      <tr>
                        <Th>Locker</Th><Th>Location</Th><Th>Employee</Th><Th>Badge</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="px-3 py-2 font-mono">{c.locker_number}</td>
                          <td className="px-3 py-2">{c.location ?? "—"}</td>
                          <td className="px-3 py-2">{c.employee_name ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{c.badge_number ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <Label htmlFor="auto-date">Termination date (dd/mm/yyyy) *</Label>
                    <Input
                      id="auto-date" value={date} onChange={(e) => setDate(e.target.value)}
                      className={`font-mono ${dateError ? "border-destructive" : ""}`} maxLength={10}
                    />
                    {dateError ? (
                      <p className="text-xs text-destructive mt-1">{dateError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">Will save as {iso} for all {candidates.length} records.</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="auto-reason">Reason (logged on every termination)</Label>
                    <Textarea id="auto-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} />
                  </div>
                </div>

                <div>
                  <Label htmlFor="auto-confirm">
                    Type <span className="font-mono font-semibold">TERMINATE</span> to confirm bulk action
                  </Label>
                  <Input id="auto-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="font-mono max-w-xs" />
                </div>

                {running && (
                  <Alert>
                    <AlertTitle>Running… {progress.done}/{progress.total}</AlertTitle>
                    <AlertDescription>
                      {progress.failed > 0 ? `${progress.failed} failed so far.` : "All good so far."}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setCandidates(null); setRosterName(null); setConfirmText(""); }} disabled={running}>
                    Cancel
                  </Button>
                  <Button
                    onClick={runBulkTerminate}
                    disabled={!canRun || running}
                    className="bg-warning text-warning-foreground hover:bg-warning/90"
                  >
                    <Play className="h-4 w-4 mr-1" />
                    {running ? "Running…" : `Terminate ${candidates.length} users`}
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</th>;
}
