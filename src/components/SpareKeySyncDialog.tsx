import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { readSpareKeyFile } from "@/lib/roster-reader";
import { planSpareKeySync, requiresSpareKeyConfirmation, canConfirmSpareKeySync, type SpareKeyChange, type SpareKeySheetSummary, type SpareKeyStatus } from "@/lib/spare-key-sync";
import { pauseLockersRealtime, patchLockersInCache, invalidateLockersCache } from "@/lib/lockers-cache";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface SpareSyncResult {
  filename: string;
  fileCount: number;
  matched: number;
  unmatched: { locker_number: string; status: string }[];
  updates: SpareKeyChange[];
  summaries: SpareKeySheetSummary[];
  appliedIds: string[];
  duplicateOverrides: number;
}

export function SpareKeySyncDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, role } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  // Spare Key sync
  const [spareFile, setSpareFile] = useState<File | null>(null);
  const [spareBusy, setSpareBusy] = useState(false);
  const [spareResult, setSpareResult] = useState<SpareSyncResult | null>(null);
  const [spareProgress, setSpareProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const runSpareKeySync = async (f: File) => {
    setSpareBusy(true);
    setConfirmation("");
    setSpareResult(null);
    try {
      const parsed = await readSpareKeyFile(f);
      if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 3).join(" "));
      if (!parsed.rows.length) throw new Error("No spare key rows found. Expected Locker # / Spare Key Status, or Combine Locker / Status / Physical Key headers in the first 30 rows.");
      const dbLockers: { id: string; locker_number: string; spare_key_status: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("lockers")
          .select("id, locker_number, spare_key_status")
          .is("deleted_at", null)
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        dbLockers.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      const plan = planSpareKeySync(parsed.rows, dbLockers);
      setSpareResult({ filename: f.name, fileCount: parsed.rows.length, matched: plan.matched,
        unmatched: plan.unmatched.map(r => ({ locker_number: r.locker_number, status: "not in DB" })),
        updates: plan.changes, summaries: parsed.summaries, appliedIds: [], duplicateOverrides: parsed.duplicateOverrides });
      toast.success(`Preview — ${plan.changes.length} lockers will change. Nothing applied yet.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Spare key sync failed");
    }
    setSpareBusy(false);
  };

  const applySpareKeySync = async () => {
    if (!spareResult || !user || role !== "admin" || spareBusy || !canConfirmSpareKeySync(spareResult.updates, confirmation)) return;
    setSpareBusy(true);
    const resume = pauseLockersRealtime();
    const appliedIds = new Set(spareResult.appliedIds);
    const pending = spareResult.updates.filter(u => !appliedIds.has(u.id));
    let changed = 0;
    try {
      const groups = new Map<string, SpareKeyChange[]>();
      for (const change of pending) {
        const key = JSON.stringify([change.prevSpare, change.spare_key_status]);
        groups.set(key, [...(groups.get(key) ?? []), change]);
      }
      setSpareProgress({ done: 0, total: pending.length, phase: "Updating spare key statuses" });
      for (const group of groups.values()) {
        for (let i = 0; i < group.length; i += 200) {
          const batch = group.slice(i, i + 200);
          const first = batch[0];
          if (!first) continue;
          let query = supabase.from("lockers").update({ spare_key_status: first.spare_key_status })
            .in("id", batch.map(u => u.id)).is("deleted_at", null);
          query = first.prevSpare === null ? query.is("spare_key_status", null) : query.eq("spare_key_status", first.prevSpare as SpareKeyStatus);
          const { data, error } = await query.select("*");
          if (error) throw error;
          const rows = data ?? [];
          patchLockersInCache(rows);
          for (const row of rows) appliedIds.add(row.id);
          setSpareResult(prev => prev ? { ...prev, appliedIds: [...appliedIds] } : prev);
          changed += rows.length;
          const { error: auditError } = rows.length ? await supabase.from("status_change_log").insert(rows.map(row => ({
            locker_id: row.id, locker_number: row.locker_number,
            previous_status: first.prevSpare, new_status: row.spare_key_status ?? first.spare_key_status,
            source: "spare_key_sync", changed_by: user.id, changed_by_email: user.email ?? null,
          }))) : { error: null };
          if (auditError) throw new Error(`Spare key changes saved, but the status log could not be written: ${auditError.message}`);
          if (rows.length !== batch.length) throw new Error("Some lockers changed since this preview. Upload the file again to review the remaining changes.");
          setSpareProgress({ done: changed, total: pending.length, phase: "Updating spare key statuses" });
        }
      }
      toast.success(`Spare keys synced — ${changed} lockers changed and logged.`);
      setSpareResult(null); setSpareFile(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Spare key sync failed");
    } finally {
      resume(); setSpareProgress(null); setSpareBusy(false);
      invalidateLockersCache();
    }
  };


  if (role !== "admin") return null;
  return (
    <Dialog open={open} onOpenChange={value => { if (!spareBusy) onOpenChange(value); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto" onInteractOutside={e => { if (spareBusy) e.preventDefault(); }} onEscapeKeyDown={e => { if (spareBusy) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Upload & Sync Spare Keys</DialogTitle>
          <DialogDescription>Upload the file exported from this page (multiple sheets supported). Matches each locker by locker number and updates its Spare Key Status. Lockers not listed are marked spare-key missing. Check the preview before confirming.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4 [&_p]:break-words">
            <div className="flex gap-3 items-center flex-wrap">
              <Input type="file" accept=".csv,.xlsx,.xls" aria-label="Spare key file" disabled={spareBusy} className="cursor-pointer max-w-sm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setSpareFile(f); runSpareKeySync(f); } }} />
              {spareBusy && <Badge variant="secondary">Working…</Badge>}
              {spareFile && !spareBusy && <span className="text-xs text-muted-foreground">{spareFile.name}</span>}
            </div>

            {spareResult && (
              <div className="mt-5 space-y-4">
                <div className="grid md:grid-cols-3 gap-3">
                  <Stat label="Lockers in file" value={spareResult.fileCount} />
                  <Stat label="Matched in DB" value={spareResult.matched} accent="text-success" />
                  <Stat label="Not in DB" value={spareResult.unmatched.length} accent="text-warning" />
                </div>

                <div className="text-sm space-y-1" aria-label="Spare key detected columns">
                  <h3 className="font-semibold">Detected columns</h3>
                  {spareResult.summaries.map(s => <p key={s.sheet} className="text-muted-foreground">{s.sheet}: {s.headerRow ? `header row ${s.headerRow} · ${s.rows.toLocaleString()} rows · Locker: ${s.lockerColumn} · Status: ${s.statusColumn ?? "—"}${s.physicalColumn ? ` · Physical: ${s.physicalColumn}` : ""}` : "No spare key headers found; sheet skipped"}</p>)}
                  {spareResult.duplicateOverrides > 0 && <p className="text-warning">{spareResult.duplicateOverrides} conflicting duplicate rows: last listed status used.</p>}
                </div>
                <Alert variant="default">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{spareResult.updates.length.toLocaleString()} lockers will change</AlertTitle>
                  <AlertDescription>{spareResult.updates.filter(u => u.unlisted).length.toLocaleString()} unlisted lockers will be marked missing. No changes are saved until you confirm.</AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-3 text-sm">
                  {[...new Set(spareResult.updates.map(u => `${u.prevSpare ?? "unknown"} → ${u.spare_key_status}`))].map(label => <span key={label}>{label.replace(/_/g, " ")}: <strong>{spareResult.updates.filter(u => `${u.prevSpare ?? "unknown"} → ${u.spare_key_status}` === label).length.toLocaleString()}</strong></span>)}
                </div>
                <div className="border rounded-md max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0"><tr><Th>Locker</Th><Th>Spare key</Th><Th>Was</Th><Th>In file</Th></tr></thead>
                    <tbody>
                      {spareResult.updates.map((u) => (
                        <tr key={u.locker_number} className="border-t">
                          <td className="px-3 py-1.5 font-medium">{u.locker_number}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline">{u.spare_key_status}</Badge></td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{u.prevSpare ?? "—"}</td>
                          <td className="px-3 py-1.5 text-xs">{u.unlisted ? "Not listed" : "Listed"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                </div>

                {spareResult.unmatched.length > 0 && (
                  <details className="rounded-md border">
                    <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30">Not found in DB ({spareResult.unmatched.length})</summary>
                    <div className="max-h-48 overflow-auto p-3 text-xs font-mono">
                      {spareResult.unmatched.map((u) => u.locker_number).join(", ")}
                    </div>
                  </details>
                )}

                {spareProgress && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{spareProgress.phase}…</span>
                      <span>
                        {spareProgress.done.toLocaleString()} / {spareProgress.total.toLocaleString()}
                        {spareProgress.total > 0 && ` (${Math.round((spareProgress.done / spareProgress.total) * 100)}%)`}
                      </span>
                    </div>
                    <Progress value={spareProgress.total ? (spareProgress.done / spareProgress.total) * 100 : 0} />
                  </div>
                )}

                {requiresSpareKeyConfirmation(spareResult.updates) && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Large spare-key update</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>More than 300 lockers would change or more than 100 would become missing. Type CONFIRM to proceed.</p>
                      <Label htmlFor="spare-sync-confirmation">Type CONFIRM</Label>
                      <Input id="spare-sync-confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={spareBusy} autoComplete="off" />
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={spareBusy}>Cancel</Button>
                  <Button onClick={applySpareKeySync} disabled={spareBusy || spareResult.updates.length === spareResult.appliedIds.length || !canConfirmSpareKeySync(spareResult.updates, confirmation)}>
                    {spareBusy ? "Applying…" : "Confirm"}
                  </Button>
                </div>
              </div>
            )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground text-left">{children}</th>;
}
function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return <div><div className={`text-2xl font-bold font-display ${accent ?? ""}`}>{value.toLocaleString()}</div><div className="text-xs text-muted-foreground">{label}</div></div>;
}
