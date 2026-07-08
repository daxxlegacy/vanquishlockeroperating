// One-time reconciliation tool: fixes drift between locker_occupancy and lockers.
// Preview → Apply pattern. Reuses syncTerminationToOccupancy / syncActivationToOccupancy
// so future behavior stays consistent with the rest of the app.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  syncTerminationToOccupancy,
  syncActivationToOccupancy,
} from "@/lib/occupancy-sync";
import { invalidateOccupancyCache } from "@/lib/occupancy-cache";
import { invalidateLockersCache } from "@/lib/lockers-cache";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
type Termination = Database["public"]["Tables"]["terminations"]["Row"];

type OccActive = {
  id: string;
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  status: string | null;
};

type Plan =
  | {
      kind: "terminate";
      locker_number: string;
      occ_employee: string | null;
      locker_employee: string | null;
      termination_date: string;
      reason: string;
      source: "terminations" | "fallback";
      locker: Locker; // hydrated lockers row (may have cleared fields already)
    }
  | {
      kind: "activate";
      locker_number: string;
      occ_employee: string | null; // always null here
      locker_employee: string | null;
      termination_date: null;
      reason: null;
      source: null;
      locker: Locker;
    };

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function SyncOccupancyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ terminated: number; activated: number; errors: number } | null>(null);

  const reset = () => { setPlans([]); setExcluded(new Set()); setProgress(null); setResult(null); };

  useEffect(() => { if (!open) reset(); }, [open]);
  useEffect(() => { if (open && plans.length === 0 && !scanning && !result) void scan(); /* eslint-disable-next-line */ }, [open]);

  async function scan() {
    setScanning(true);
    try {
      // 1. Occupancy active rows (main category)
      const occ: OccActive[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("locker_occupancy")
          .select("id, locker_number, employee_name, badge_number, status")
          .eq("category", "main")
          .ilike("status", "active")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        occ.push(...(data as OccActive[]));
        if (data.length < 1000) break;
        from += 1000;
      }

      // 2. All lockers
      const lockers: Locker[] = [];
      from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("*")
          .is("deleted_at", null)
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        lockers.push(...(data as Locker[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      const lockerByNum = new Map<string, Locker>();
      for (const l of lockers) lockerByNum.set(l.locker_number, l);

      // 3. Terminations for lookups (active ones)
      const numbers = [...new Set(occ.map((o) => o.locker_number))];
      const terms: Termination[] = [];
      const CHUNK = 300;
      for (let i = 0; i < numbers.length; i += CHUNK) {
        const slice = numbers.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const { data, error } = await supabase
          .from("terminations")
          .select("*")
          .in("locker_number", slice)
          .is("undone_at", null)
          .order("termination_date", { ascending: false });
        if (error) throw error;
        terms.push(...((data ?? []) as Termination[]));
      }
      // Group terminations by locker_number (most-recent-first already).
      const termsByNum = new Map<string, Termination[]>();
      for (const t of terms) {
        const arr = termsByNum.get(t.locker_number) ?? [];
        arr.push(t);
        termsByNum.set(t.locker_number, arr);
      }

      const nextPlans: Plan[] = [];
      const occByNum = new Map<string, OccActive>();
      for (const o of occ) occByNum.set(o.locker_number, o);

      // Case A: occupancy active rows that don't match lockers → terminate
      for (const o of occ) {
        const l = lockerByNum.get(o.locker_number);
        if (!l) continue; // locker missing entirely — leave alone (deletion flow handles it)
        const lockerIsActive = norm(l.status) === "active";
        const nameMatches = norm(l.employee_name) === norm(o.employee_name);
        const badgeMatches = norm(l.badge_number) === norm(o.badge_number);
        const lockerHasEmployee = !!(l.employee_name && l.employee_name.trim());
        // Mismatch if: locker cleared, or different employee/badge, or status not active
        if (lockerHasEmployee && nameMatches && badgeMatches && lockerIsActive) continue;

        // Find matching termination
        const candidates = termsByNum.get(o.locker_number) ?? [];
        const match = candidates.find((t) =>
          (o.employee_name && norm(t.prior_employee_name) === norm(o.employee_name)) ||
          (o.badge_number && norm(t.prior_badge_number) === norm(o.badge_number)),
        ) ?? candidates[0];

        let termDate: string;
        let reason: string;
        let source: "terminations" | "fallback";
        if (match) {
          termDate = match.termination_date;
          reason = match.reason ?? "Terminated (reason not recorded)";
          source = "terminations";
        } else {
          termDate = (l.updated_at ?? new Date().toISOString()).slice(0, 10);
          reason = "Synced from Lockers page — original termination reason not recorded";
          source = "fallback";
        }
        nextPlans.push({
          kind: "terminate",
          locker_number: o.locker_number,
          occ_employee: o.employee_name,
          locker_employee: l.employee_name,
          termination_date: termDate,
          reason,
          source,
          locker: l,
        });
      }

      // Case B (reverse): lockers active + employee set, no active occupancy row
      for (const l of lockers) {
        if (norm(l.status) !== "active") continue;
        if (!l.employee_name && !l.badge_number) continue;
        const o = occByNum.get(l.locker_number);
        if (o) {
          const nameMatches = norm(l.employee_name) === norm(o.employee_name);
          const badgeMatches = norm(l.badge_number) === norm(o.badge_number);
          if (nameMatches && badgeMatches) continue;
          // Occupancy has a different active person — already covered by Case A above,
          // and after termination the activation gap will remain. Also add activate plan.
        }
        // Skip if we've already got a terminate plan for this locker AND occ matches locker
        // (i.e., only pure "missing active" cases). If occ exists with different person,
        // we still need the activate step after terminating them — include it.
        nextPlans.push({
          kind: "activate",
          locker_number: l.locker_number,
          occ_employee: o?.employee_name ?? null,
          locker_employee: l.employee_name,
          termination_date: null,
          reason: null,
          source: null,
          locker: l,
        });
      }

      nextPlans.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
      setPlans(nextPlans);
      setExcluded(new Set());
      toast.success(`Scan complete: ${nextPlans.length} discrepanc${nextPlans.length === 1 ? "y" : "ies"} found.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const counts = useMemo(() => {
    let t = 0, a = 0;
    for (const p of plans) { if (p.kind === "terminate") t++; else a++; }
    return { t, a };
  }, [plans]);

  const key = (p: Plan) => `${p.kind}:${p.locker_number}`;
  const toggle = (p: Plan) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      const k = key(p);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  async function handleApply() {
    const toApply = plans.filter((p) => !excluded.has(key(p)));
    if (toApply.length === 0) { toast.warning("Nothing to apply."); return; }
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const userEmail = userData.user?.email ?? null;
    if (!userId) { toast.error("Not signed in."); return; }

    setApplying(true);
    setProgress({ done: 0, total: toApply.length });
    let terminated = 0, activated = 0, errors = 0;
    const auditRows: {
      locker_id: string | null; locker_number: string;
      previous_status: string | null; new_status: string;
      source: string; changed_by: string; changed_by_email: string | null;
    }[] = [];

    for (let i = 0; i < toApply.length; i++) {
      const p = toApply[i];
      try {
        if (p.kind === "terminate") {
          await syncTerminationToOccupancy(p.locker, p.termination_date, p.reason);
          terminated++;
          auditRows.push({
            locker_id: p.locker.id,
            locker_number: p.locker_number,
            previous_status: "active (occupancy)",
            new_status: "terminate (occupancy)",
            source: "sync_occupancy_with_lockers",
            changed_by: userId,
            changed_by_email: userEmail,
          });
        } else {
          await syncActivationToOccupancy(p.locker);
          activated++;
          auditRows.push({
            locker_id: p.locker.id,
            locker_number: p.locker_number,
            previous_status: "(missing occupancy)",
            new_status: "active (occupancy)",
            source: "sync_occupancy_with_lockers",
            changed_by: userId,
            changed_by_email: userEmail,
          });
        }
      } catch (e) {
        errors++;
        console.warn(`Sync failed for ${p.locker_number}:`, e);
      }
      setProgress({ done: i + 1, total: toApply.length });
    }

    for (let i = 0; i < auditRows.length; i += 200) {
      const chunk = auditRows.slice(i, i + 200);
      const { error } = await supabase.from("status_change_log").insert(chunk);
      if (error) console.warn("status_change_log insert failed:", error.message);
    }

    invalidateOccupancyCache();
    invalidateLockersCache();
    setResult({ terminated, activated, errors });
    setApplying(false);
    toast.success(`Sync applied: ${terminated} terminated, ${activated} activated, ${errors} error${errors === 1 ? "" : "s"}.`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !applying && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Sync Occupancy with Lockers page
          </DialogTitle>
          <DialogDescription>
            One-time repair: finds active occupancy records that no longer match the Lockers page and
            missing active records for occupied lockers.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <h3 className="font-display text-lg font-bold">Sync complete</h3>
            </div>
            <div className="text-sm">
              <span className="text-success font-semibold">{result.terminated}</span> terminated ·{" "}
              <span className="text-success font-semibold">{result.activated}</span> added ·{" "}
              <span className={result.errors > 0 ? "text-destructive" : "text-muted-foreground"}>
                {result.errors}
              </span>{" "}
              errors
            </div>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : scanning ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Scanning occupancy vs lockers…</p>
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : plans.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No discrepancies found — occupancy is already in sync with the Lockers page. 🎉
          </div>
        ) : (
          <>
            <div className="text-sm">
              <span className="text-destructive font-semibold">{counts.t}</span> occupancy record
              {counts.t === 1 ? "" : "s"} will be marked <b>Terminated</b> ·{" "}
              <span className="text-success font-semibold">{counts.a}</span> missing <b>Active</b>{" "}
              record{counts.a === 1 ? "" : "s"} will be added.
            </div>

            <div className="border rounded-md overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="px-2 py-1.5">Locker #</th>
                    <th className="px-2 py-1.5">Current Occupancy</th>
                    <th className="px-2 py-1.5">Employee (Occupancy)</th>
                    <th className="px-2 py-1.5">Employee (Lockers)</th>
                    <th className="px-2 py-1.5">Action</th>
                    <th className="px-2 py-1.5">Reason / Date</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => {
                    const k = key(p);
                    const checked = !excluded.has(k);
                    return (
                      <tr key={k} className="border-t">
                        <td className="px-2 py-1">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggle(p)}
                            aria-label={`Include ${p.locker_number}`}
                          />
                        </td>
                        <td className="px-2 py-1 font-mono font-medium">{p.locker_number}</td>
                        <td className="px-2 py-1">
                          <StatusBadge status={p.kind === "activate" ? "(missing)" : "active"} />
                        </td>
                        <td className="px-2 py-1 truncate max-w-[160px]">
                          {p.occ_employee ?? <span className="text-muted-foreground italic">—</span>}
                        </td>
                        <td className="px-2 py-1 truncate max-w-[160px]">
                          {p.locker_employee ?? <span className="text-muted-foreground italic">—</span>}
                        </td>
                        <td className="px-2 py-1">
                          {p.kind === "terminate" ? (
                            <Badge variant="outline" className="border-destructive text-destructive">
                              Mark Terminated
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-success text-success">
                              Add Active
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1 text-xs text-muted-foreground max-w-[240px]">
                          {p.kind === "terminate" ? (
                            <span title={p.reason}>
                              {p.termination_date}
                              {p.source === "fallback" ? " (fallback)" : ""} · {p.reason}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {applying && progress && (
              <div className="space-y-1">
                <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
                <p className="text-xs text-muted-foreground">{progress.done} / {progress.total}</p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleApply}
                disabled={applying || plans.filter((p) => !excluded.has(key(p))).length === 0}
              >
                {applying ? "Applying…" : "Apply Changes"}
              </Button>
              <Button variant="outline" onClick={() => void scan()} disabled={applying || scanning}>
                Re-scan
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={applying}>Cancel</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
