// Automation — dry-run preview + bulk auto-terminate.
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import { downloadCsv } from "@/lib/csv-export";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Zap, Upload as UploadIcon, AlertCircle, CheckCircle2, UserMinus, Play, Download, Eye } from "lucide-react";
import { toast } from "sonner";

type LockerLite = { id: string; locker_number: string; location: string | null; row_label: string | null; employee_name: string | null; badge_number: string | null; status: string };
type Candidate = LockerLite & { reason: "no_badge_match" | "no_name_match" };
type RosterMissing = { badge: string | null; name: string | null; rowIndex: number };

function detectCols(keys: string[]): { badge?: string; name?: string } {
  const lc = keys.map((k) => ({ k, n: k.toLowerCase().replace(/[^a-z0-9]/g, "") }));
  const find = (cands: string[]) => lc.find(({ n }) => cands.some((c) => n.includes(c)))?.k;
  return {
    badge: find(["badge", "empid", "employeeid", "staffid", "personnumber", "empnum", "employeenumber", "empcode", "employeecode", "legacy", "legacyid", "vlookupocempnum"]),
    name: find(["name", "employee", "fullname", "legalfullname", "vlookupocname"]),
  };
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

export function AutomationPanel() {
  const { user } = useAuth();
  const { has, isAdmin } = usePermissions();
  const canRunAutomation = has("run_automation");

  const [busy, setBusy] = useState(false);
  const [rosterName, setRosterName] = useState<string | null>(null);
  const [rosterCount, setRosterCount] = useState(0);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [missingFromDb, setMissingFromDb] = useState<RosterMissing[] | null>(null);
  const [reason, setReason] = useState("Auto-terminated — not present in latest roster");
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const [date, setDate] = useState(todayStr);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [confirmText, setConfirmText] = useState("");

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
    setBusy(true); setCandidates(null); setMissingFromDb(null); setRosterName(f.name);
    try {
      const rows = await parseRoster(f);
      if (rows.length === 0) throw new Error("Roster file is empty");
      const cols = detectCols(Object.keys(rows[0]));
      if (!cols.badge && !cols.name) throw new Error("Couldn't find a badge or name column");
      const badges = new Set<string>(); const names = new Set<string>();
      const rosterEntries: RosterMissing[] = [];
      rows.forEach((r, i) => {
        const b = cols.badge ? getStr(r, cols.badge) : undefined;
        const n = cols.name ? getStr(r, cols.name) : undefined;
        if (b) badges.add(b.toLowerCase().trim());
        if (n) names.add(n.toLowerCase().trim());
        if (b || n) rosterEntries.push({ badge: b ?? null, name: n ?? null, rowIndex: i + 2 });
      });
      setRosterCount(rows.length);

      const all: LockerLite[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("id,locker_number,location,row_label,employee_name,badge_number,status")
          .is("deleted_at", null).eq("status", "active")
          .or("employee_name.not.is.null,badge_number.not.is.null")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as LockerLite[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      setActiveCount(all.length);

      // Build DB-side sets for reverse lookup.
      const dbBadges = new Set<string>();
      const dbNames = new Set<string>();
      for (const l of all) {
        const b = l.badge_number?.toLowerCase().trim();
        const n = l.employee_name?.toLowerCase().trim();
        if (b) dbBadges.add(b);
        if (n) dbNames.add(n);
      }

      // Direction 1: active lockers whose user is NOT in roster.
      const cands: Candidate[] = [];
      for (const l of all) {
        const b = l.badge_number?.toLowerCase().trim();
        const n = l.employee_name?.toLowerCase().trim();
        const badgeMatch = b ? badges.has(b) : false;
        const nameMatch = n ? names.has(n) : false;
        if (!badgeMatch && !nameMatch) cands.push({ ...l, reason: b ? "no_badge_match" : "no_name_match" });
      }
      setCandidates(cands);

      // Direction 2: roster employees who do NOT exist in our DB.
      const missing: RosterMissing[] = [];
      for (const r of rosterEntries) {
        const b = r.badge?.toLowerCase().trim();
        const n = r.name?.toLowerCase().trim();
        const badgeMatch = b ? dbBadges.has(b) : false;
        const nameMatch = n ? dbNames.has(n) : false;
        if (!badgeMatch && !nameMatch) missing.push(r);
      }
      setMissingFromDb(missing);

      toast.success(`${cands.length} not in roster · ${missing.length} not in DB.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
      setRosterName(null);
    }
    setBusy(false);
  };

  const exportPreviewCsv = () => {
    if (!candidates) return;
    downloadCsv(`automation-preview-${Date.now()}.csv`, candidates.map((c) => ({
      locker: c.locker_number, location: c.location ?? "", row: c.row_label ?? "",
      employee: c.employee_name ?? "", badge: c.badge_number ?? "", reason: c.reason,
    })));
  };

  const exportMissingFromDbCsv = () => {
    if (!missingFromDb) return;
    downloadCsv(`roster-not-in-db-${Date.now()}.csv`, missingFromDb.map((r) => ({
      roster_row: r.rowIndex, badge: r.badge ?? "", employee: r.name ?? "",
    })));
  };

  const canCommit = canRunAutomation && candidates && candidates.length > 0 && !dateError && (dryRun || confirmText.trim() === "TERMINATE");

  const runBatch = async () => {
    if (!canCommit || !candidates || !iso || !user) return;
    setRunning(true);
    setProgress({ done: 0, total: candidates.length, failed: 0 });

    const { data: runRow, error: runErr } = await supabase.from("automation_runs").insert({
      task_type: "auto_terminate", filename: rosterName,
      candidates_count: candidates.length, terminated_count: 0, failed_count: 0,
      dry_run: dryRun, reason: reason.trim() || null, termination_date: iso,
      executed_by: user.id, executed_by_email: user.email ?? null,
    }).select().single();
    if (runErr || !runRow) {
      toast.error(runErr?.message ?? "Failed to create run record");
      setRunning(false); return;
    }

    let done = 0, failed = 0;
    for (const l of candidates) {
      try {
        let terminationId: string | null = null;
        if (!dryRun) {
          const { data: t, error: e1 } = await supabase.from("terminations").insert([{
            locker_id: l.id, locker_number: l.locker_number, location: l.location, row_label: l.row_label,
            employee_name: l.employee_name, badge_number: l.badge_number,
            termination_date: iso, reason: reason.trim() || null,
            terminated_by: user.id, terminated_by_email: user.email ?? null,
            prior_status: l.status as "active",
            prior_employee_name: l.employee_name, prior_badge_number: l.badge_number,
          }]).select().single();
          if (e1) throw e1;
          terminationId = t?.id ?? null;
          const { error: e2 } = await supabase.from("lockers")
            .update({ employee_name: null, badge_number: null, status: "empty" }).eq("id", l.id);
          if (e2) throw e2;
        }
        await supabase.from("automation_run_items").insert({
          run_id: runRow.id, termination_id: terminationId,
          locker_id: l.id, locker_number: l.locker_number, location: l.location, row_label: l.row_label,
          employee_name: l.employee_name, badge_number: l.badge_number,
          prior_status: l.status, succeeded: true,
        });
        done++;
      } catch {
        failed++;
        await supabase.from("automation_run_items").insert({
          run_id: runRow.id, locker_id: l.id, locker_number: l.locker_number,
          employee_name: l.employee_name, badge_number: l.badge_number,
          prior_status: l.status, succeeded: false,
        });
      }
      setProgress({ done: done + failed, total: candidates.length, failed });
    }

    await supabase.from("automation_runs").update({
      terminated_count: dryRun ? 0 : done, failed_count: failed,
    }).eq("id", runRow.id);

    setRunning(false);
    setCandidates(null); setConfirmText("");
    toast.success(dryRun ? `Dry run logged — ${done} would be terminated.` : `Auto-termination complete — ${done} terminated, ${failed} failed.`);
  };

  useEffect(() => { /* noop */ }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Zap className="h-5 w-5 text-warning" />
        <h2 className="font-display text-xl font-bold">Auto-terminate from roster</h2>
      </div>
      <p className="text-muted-foreground text-sm">
        Bulk auto-terminate active lockers whose employees are missing from an uploaded roster. Dry-run mode previews without changes.
      </p>

      {!canRunAutomation && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Permission required</AlertTitle>
          <AlertDescription>You need the "Run automation tasks" permission. Ask an admin to grant it.</AlertDescription>
        </Alert>
      )}

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <UploadIcon className="h-5 w-5 text-primary mt-1" />
          <div className="flex-1 space-y-3">
            <div>
              <Label className="font-display text-base">Step 1 — Upload current employee roster</Label>
              <p className="text-xs text-muted-foreground mt-1">Excel or CSV with badge number and/or employee name column.</p>
            </div>
            <Input type="file" accept=".csv,.xlsx,.xls"
              disabled={busy || running || !canRunAutomation}
              onChange={(e) => e.target.files?.[0] && runPreview(e.target.files[0])}
              className="cursor-pointer max-w-md" />
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
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserMinus className="h-5 w-5 text-destructive" />
              <h3 className="font-display text-lg font-bold">Step 2 — Review candidates ({candidates.length})</h3>
            </div>
            {candidates.length > 0 && isAdmin && (
              <Button size="sm" variant="outline" onClick={exportPreviewCsv}>
                <Download className="h-4 w-4 mr-1" />Export CSV
              </Button>
            )}
          </div>
          {candidates.length === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Nothing to do</AlertTitle>
              <AlertDescription>Every active locker user is in the roster.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="overflow-x-auto border rounded-md max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Locker</th>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Location</th>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Employee</th>
                      <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Badge</th>
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

              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30 border">
                <Switch id="dry-run" checked={dryRun} onCheckedChange={setDryRun} disabled={running} />
                <Label htmlFor="dry-run" className="cursor-pointer flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Dry run mode {dryRun
                    ? <Badge variant="outline" className="ml-1">ON — nothing will change</Badge>
                    : <Badge variant="destructive" className="ml-1">OFF — will commit terminations</Badge>}
                </Label>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="auto-date">Termination date (dd/mm/yyyy) *</Label>
                  <Input id="auto-date" value={date} onChange={(e) => setDate(e.target.value)}
                    className={`font-mono ${dateError ? "border-destructive" : ""}`} maxLength={10} />
                  {dateError ? <p className="text-xs text-destructive mt-1">{dateError}</p>
                    : <p className="text-xs text-muted-foreground mt-1">Will save as {iso}.</p>}
                </div>
                <div>
                  <Label htmlFor="auto-reason">Reason</Label>
                  <Textarea id="auto-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} />
                </div>
              </div>

              {!dryRun && (
                <div>
                  <Label htmlFor="auto-confirm">Type <span className="font-mono font-semibold">TERMINATE</span> to confirm</Label>
                  <Input id="auto-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="font-mono max-w-xs" />
                </div>
              )}

              {running && (
                <Alert>
                  <AlertTitle>Running… {progress.done}/{progress.total}</AlertTitle>
                  <AlertDescription>{progress.failed > 0 ? `${progress.failed} failed so far.` : "All good so far."}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setCandidates(null); setMissingFromDb(null); setRosterName(null); setConfirmText(""); }} disabled={running}>
                  Cancel
                </Button>
                <Button onClick={runBatch} disabled={!canCommit || running}
                  className={dryRun ? "" : "bg-warning text-warning-foreground hover:bg-warning/90"}>
                  <Play className="h-4 w-4 mr-1" />
                  {running ? "Running…" : dryRun ? `Log dry run for ${candidates.length}` : `Terminate ${candidates.length} users`}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {missingFromDb && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              <h3 className="font-display text-lg font-bold">Roster employees not in our data ({missingFromDb.length})</h3>
            </div>
            {missingFromDb.length > 0 && isAdmin && (
              <Button size="sm" variant="outline" onClick={exportMissingFromDbCsv}>
                <Download className="h-4 w-4 mr-1" />Export CSV
              </Button>
            )}
          </div>
          {missingFromDb.length === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>All matched</AlertTitle>
              <AlertDescription>Every roster employee was found in our locker data.</AlertDescription>
            </Alert>
          ) : (
            <div className="overflow-x-auto border rounded-md max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Roster Row</th>
                    <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Badge</th>
                    <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground">Employee</th>
                  </tr>
                </thead>
                <tbody>
                  {missingFromDb.map((r, i) => (
                    <tr key={`${r.rowIndex}-${i}`} className="border-t">
                      <td className="px-3 py-2 font-mono text-muted-foreground">{r.rowIndex}</td>
                      <td className="px-3 py-2 font-mono">{r.badge ?? "—"}</td>
                      <td className="px-3 py-2">{r.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
