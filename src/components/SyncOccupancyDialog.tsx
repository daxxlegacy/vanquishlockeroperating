// One-time reconciliation tool: fixes drift between locker_occupancy and lockers.
// Preview → Apply pattern. Operates across ALL categories (main, staff, shoe).
import { deriveOccCategoryOr } from "@/lib/locker-category";
import type { OccCategory } from "@/lib/occupancy-cache";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invalidateOccupancyCache } from "@/lib/occupancy-cache";
import { invalidateLockersCache } from "@/lib/lockers-cache";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { CheckCircle2, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, StopCircle } from "lucide-react";
import { toast } from "sonner";
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";
import type { OccupancyRow } from "@/lib/occupancy-cache";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
type Termination = Database["public"]["Tables"]["terminations"]["Row"];

type OccActive = {
  id: string;
  category: string;
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  national_id: string | null;
  status: string | null;
  updated_at: string | null;
  termination_date: string | null;
  remarks: string | null;
};

type Plan =
  | {
      kind: "terminate";
      occupancy_id: string;
      category: string;
      locker_number: string;
      occ_employee: string | null;
      locker_employee: string | null;
      termination_date: string;
      reason: string;
      source: "terminations" | "fallback";
      locker: Locker;
    }
  | {
      kind: "update_details";
      occupancy_id: string;
      category: string;
      locker_number: string;
      occ_employee: string | null;
      locker_employee: string | null;
      termination_date: null;
      reason: string; // human-readable field diff
      source: null;
      locker: Locker;
    }
  | {
      kind: "activate";
      occupancy_id: null;
      category: string;
      locker_number: string;
      occ_employee: null;
      locker_employee: string | null;
      termination_date: null;
      reason: null;
      source: null;
      locker: Locker;
    }
  | {
      kind: "duplicate_cleanup";
      occupancy_id: string; // the row to DELETE
      keep_id: string;
      category: string; // category of the row to delete (for display)
      locker_number: string;
      occ_employee: string | null;
      locker_employee: string | null;
      termination_date: null;
      reason: string; // explanation shown in preview
      source: null;
      locker: Locker | null;
    };

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

type FailedItem = {
  locker_number: string;
  category: string;
  kind: "terminate" | "activate" | "duplicate_cleanup" | "update_details";
  reason: string;
  code?: string;
  conflictRow?: OccupancyRow | null;
};

type ApplyResult = {
  terminated: number;
  activated: number;
  updated: number;
  duplicates_removed: number;
  failedItems: FailedItem[];
};

export function SyncOccupancyDialog({
  open,
  onClose,
  onRequestForceTerminate,
}: {
  open: boolean;
  onClose: () => void;
  onRequestForceTerminate?: (row: OccupancyRow) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [failedExpanded, setFailedExpanded] = useState(true);

  const reset = () => { setPlans([]); setExcluded(new Set()); setProgress(null); setResult(null); setFailedExpanded(true); };

  useEffect(() => { if (!open) reset(); }, [open]);
  useEffect(() => { if (open && plans.length === 0 && !scanning && !result) void scan(); /* eslint-disable-next-line */ }, [open]);

  async function scan() {
    setScanning(true);
    try {
      // 1. Occupancy active rows across ALL categories (main, staff, shoe)
      const occ: OccActive[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("locker_occupancy")
          .select("id, category, locker_number, employee_name, badge_number, national_id, status, updated_at, termination_date, remarks")
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
      const termsByNum = new Map<string, Termination[]>();
      for (const t of terms) {
        const arr = termsByNum.get(t.locker_number) ?? [];
        arr.push(t);
        termsByNum.set(t.locker_number, arr);
      }

      const nextPlans: Plan[] = [];

      // Pre-pass: detect DUPLICATE active rows for the same locker_number
      // (violates the invariant enforced by locker_occupancy_active_locker_unique).
      // For each group, decide which row to KEEP and mark the rest for cleanup.
      const byNum = new Map<string, OccActive[]>();
      for (const o of occ) {
        const arr = byNum.get(o.locker_number) ?? [];
        arr.push(o);
        byNum.set(o.locker_number, arr);
      }
      const removedIds = new Set<string>();
      for (const [locker_number, group] of byNum) {
        if (group.length < 2) continue;
        const l = lockerByNum.get(locker_number);
        // Rank: (1) matches lockers row exactly, (2) more complete data
        // (has termination_date or remarks), (3) most recently updated.
        const score = (r: OccActive): number => {
          let s = 0;
          if (l && norm(l.employee_name) === norm(r.employee_name) && norm(l.badge_number) === norm(r.badge_number)) s += 1000;
          if (r.termination_date) s += 10;
          if (r.remarks && r.remarks.trim()) s += 5;
          s += r.updated_at ? new Date(r.updated_at).getTime() / 1e12 : 0;
          return s;
        };
        const sorted = [...group].sort((a, b) => score(b) - score(a));
        const keep = sorted[0];
        for (const dup of sorted.slice(1)) {
          removedIds.add(dup.id);
          nextPlans.push({
            kind: "duplicate_cleanup",
            occupancy_id: dup.id,
            keep_id: keep.id,
            category: dup.category,
            locker_number,
            occ_employee: dup.employee_name,
            locker_employee: l?.employee_name ?? null,
            termination_date: null,
            reason: `Duplicate Active row — keeping ${keep.category}/${keep.employee_name ?? "—"} (${keep.badge_number ?? "—"})`,
            source: null,
            locker: l ?? null,
          });
        }
      }

      // Filter out rows that are queued for duplicate cleanup so Case A doesn't
      // also emit a terminate for them.
      const occDedup = occ.filter((o) => !removedIds.has(o.id));

      // Active occupancy rows keyed by (locker_number, category)
      const occByKey = new Map<string, OccActive>();
      for (const o of occDedup) occByKey.set(`${o.locker_number}::${o.category}`, o);

      // Case A: occupancy active rows that don't match lockers.
      // If it's still the SAME PERSON (identity matches on name, badge or
      // national ID) and the locker is still active, the record was merely
      // edited upstream (e.g. an intake upload corrected the badge number) —
      // update the occupancy row in place instead of terminating + reactivating.
      for (const o of occDedup) {
        const l = lockerByNum.get(o.locker_number);
        if (!l) continue; // locker missing entirely — handled by deletion flow
        const lockerIsActive = norm(l.status) === "active";
        const nameMatches = norm(l.employee_name) === norm(o.employee_name);
        const badgeMatches = norm(l.badge_number) === norm(o.badge_number);
        const nidMatches = norm(l.national_id) === norm(o.national_id);
        const lockerHasEmployee = !!(l.employee_name && l.employee_name.trim());
        if (lockerHasEmployee && nameMatches && badgeMatches && lockerIsActive) continue;

        if (lockerHasEmployee && lockerIsActive) {
          const samePerson =
            (nameMatches && !!norm(o.employee_name)) ||
            (badgeMatches && !!norm(o.badge_number)) ||
            (nidMatches && !!norm(o.national_id));
          if (samePerson) {
            const diffs: string[] = [];
            if (!nameMatches) diffs.push(`name ${o.employee_name ?? "—"} → ${l.employee_name ?? "—"}`);
            if (!badgeMatches) diffs.push(`badge ${o.badge_number ?? "—"} → ${l.badge_number ?? "—"}`);
            if (!nidMatches) diffs.push("national ID updated");
            nextPlans.push({
              kind: "update_details",
              occupancy_id: o.id,
              category: o.category,
              locker_number: o.locker_number,
              occ_employee: o.employee_name,
              locker_employee: l.employee_name,
              termination_date: null,
              reason: `Same occupant — ${diffs.length > 0 ? diffs.join(", ") : "details refreshed"} (from Lockers page)`,
              source: null,
              locker: l,
            });
            continue;
          }
        }


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
          reason = "Synced from Lockers page — original reason not recorded";
          source = "fallback";
        }
        nextPlans.push({
          kind: "terminate",
          occupancy_id: o.id,
          category: o.category,
          locker_number: o.locker_number,
          occ_employee: o.employee_name,
          locker_employee: l.employee_name,
          termination_date: termDate,
          reason,
          source,
          locker: l,
        });
      }

      // Case B: lockers active + employee set, and NO active occupancy row
      // for that locker_number in ANY category → insert new Active.
      // Infer category from any existing occupancy row (any status) for
      // this locker_number, else default to 'main'.
      const occCategoriesByNum = new Map<string, string>();
      {
        // fetch any-status category hint in bulk for lockers that need it
        const needed: string[] = [];
        for (const l of lockers) {
          if (norm(l.status) !== "active") continue;
          if (!l.employee_name && !l.badge_number) continue;
          // any active occupancy for this locker (any category)?
          const hasActiveAny = occ.some((o) => o.locker_number === l.locker_number);
          if (!hasActiveAny) needed.push(l.locker_number);
        }
        for (let i = 0; i < needed.length; i += CHUNK) {
          const slice = needed.slice(i, i + CHUNK);
          if (slice.length === 0) continue;
          const { data } = await supabase
            .from("locker_occupancy")
            .select("locker_number, category")
            .in("locker_number", slice);
          for (const r of (data ?? []) as { locker_number: string; category: string }[]) {
            if (!occCategoriesByNum.has(r.locker_number)) {
              occCategoriesByNum.set(r.locker_number, r.category);
            }
          }
        }
      }

      for (const l of lockers) {
        if (norm(l.status) !== "active") continue;
        if (!l.employee_name && !l.badge_number) continue;
        // Skip if any active occupancy exists (Case A already handled mismatch)
        const hasActiveAny = occ.some((o) => o.locker_number === l.locker_number);
        if (hasActiveAny) continue;
        const category = deriveOccCategoryOr(l.locker_number, (occCategoriesByNum.get(l.locker_number) as OccCategory) ?? "main");
        nextPlans.push({
          kind: "activate",
          occupancy_id: null,
          category,
          locker_number: l.locker_number,
          occ_employee: null,
          locker_employee: l.employee_name,
          termination_date: null,
          reason: null,
          source: null,
          locker: l,
        });
      }

      nextPlans.sort((a, b) => {
        const c = compareLockerNumbers(a.locker_number, b.locker_number);
        return c !== 0 ? c : a.category.localeCompare(b.category);
      });
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
    let t = 0, a = 0, d = 0, u = 0;
    for (const p of plans) {
      if (p.kind === "terminate") t++;
      else if (p.kind === "activate") a++;
      else if (p.kind === "update_details") u++;
      else d++;
    }
    return { t, a, d, u };
  }, [plans]);

  const key = (p: Plan) => `${p.kind}:${p.locker_number}:${p.category}:${p.occupancy_id ?? ""}`;
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
    let terminated = 0, activated = 0, duplicates_removed = 0, updated = 0;
    const failedItems: FailedItem[] = [];
    const auditRows: {
      locker_id: string | null; locker_number: string;
      previous_status: string | null; new_status: string;
      source: string; changed_by: string; changed_by_email: string | null;
    }[] = [];

    const fetchConflictRow = async (locker_number: string): Promise<OccupancyRow | null> => {
      const { data } = await supabase
        .from("locker_occupancy")
        .select("*")
        .eq("locker_number", locker_number)
        .ilike("status", "active")
        .limit(1);
      return (data?.[0] as OccupancyRow | undefined) ?? null;
    };

    const describeError = (err: unknown): { code?: string; message: string } => {
      const e = err as { code?: string; message?: string; details?: string; hint?: string } | null;
      if (!e) return { message: "Unknown error" };
      return {
        code: e.code,
        message: e.message || e.details || e.hint || "Unknown database error",
      };
    };

    for (let i = 0; i < toApply.length; i++) {
      const p = toApply[i];
      try {
        if (p.kind === "duplicate_cleanup") {
          const { error } = await supabase.from("locker_occupancy").delete().eq("id", p.occupancy_id);
          if (error) throw error;
          duplicates_removed++;
          auditRows.push({
            locker_id: p.locker?.id ?? null,
            locker_number: p.locker_number,
            previous_status: `active (occupancy/${p.category}) [duplicate]`,
            new_status: `deleted (kept id=${p.keep_id})`,
            source: "sync_occupancy_duplicate_cleanup",
            changed_by: userId,
            changed_by_email: userEmail,
          });
        } else if (p.kind === "update_details") {
          // Same occupant, refreshed details (e.g. corrected badge number from a
          // new intake upload) — patch the active row in place. No termination.
          const { error } = await supabase
            .from("locker_occupancy")
            .update({
              employee_name: p.locker.employee_name,
              badge_number: p.locker.badge_number,
              national_id: p.locker.national_id,
              work_location: p.locker.work_location,
              locker_row: p.locker.row_label,
              locker_location_by_row: p.locker.location,
              key_lock_type: p.locker.key_lock,
              batch_intake_date: p.locker.batch_intake ?? null,
              status: "Active",
              termination_date: null,
            })
            .eq("id", p.occupancy_id);
          if (error) throw error;
          updated++;
          auditRows.push({
            locker_id: p.locker.id,
            locker_number: p.locker_number,
            previous_status: `active (occupancy/${p.category})`,
            new_status: `active (occupancy/${p.category}) [details updated]`,
            source: "sync_occupancy_update_details",
            changed_by: userId,
            changed_by_email: userEmail,
          });
        } else if (p.kind === "terminate") {
          await supabase
            .from("locker_occupancy")
            .delete()
            .eq("category", p.category)
            .eq("locker_number", p.locker_number)
            .or("status.ilike.terminate,status.ilike.terminated");

          const { error } = await supabase
            .from("locker_occupancy")
            .update({
              status: "Terminate",
              termination_date: p.termination_date,
              remarks: p.reason,
            })
            .eq("id", p.occupancy_id);
          if (error) throw error;

          terminated++;
          auditRows.push({
            locker_id: p.locker.id,
            locker_number: p.locker_number,
            previous_status: `active (occupancy/${p.category})`,
            new_status: `terminate (occupancy/${p.category})`,
            source: "sync_occupancy_with_lockers",
            changed_by: userId,
            changed_by_email: userEmail,
          });
        } else {
          // activate — conflict-safe insert
          const insertPayload = {
            category: p.category,
            locker_number: p.locker.locker_number,
            locker_row: p.locker.row_label,
            locker_location_by_row: p.locker.location,
            key_lock_type: p.locker.key_lock,
            badge_number: p.locker.badge_number,
            employee_name: p.locker.employee_name,
            national_id: p.locker.national_id,
            work_location: p.locker.work_location,
            status: "Active",
            batch_intake_date: p.locker.batch_intake ?? null,
            termination_date: null,
            source_filename: "sync-with-lockers",
          };
          const { error } = await supabase.from("locker_occupancy").insert(insertPayload);
          if (error) {
            if ((error as { code?: string }).code === "23505") {
              const conflictRow = await fetchConflictRow(p.locker_number);
              if (
                conflictRow &&
                norm(conflictRow.employee_name) === norm(p.locker.employee_name) &&
                norm(conflictRow.badge_number) === norm(p.locker.badge_number)
              ) {
                // Same person — update in place.
                await supabase.from("locker_occupancy").update(insertPayload).eq("id", conflictRow.id);
                activated++;
                auditRows.push({
                  locker_id: p.locker.id,
                  locker_number: p.locker_number,
                  previous_status: `active (occupancy/${conflictRow.category})`,
                  new_status: `active (occupancy/${conflictRow.category}) [merged]`,
                  source: "sync_occupancy_with_lockers",
                  changed_by: userId,
                  changed_by_email: userEmail,
                });
              } else {
                failedItems.push({
                  locker_number: p.locker_number,
                  category: p.category,
                  kind: "activate",
                  code: "23505",
                  reason: conflictRow
                    ? `Conflict — ${p.locker_number} already has an active occupant in '${conflictRow.category}' (${conflictRow.employee_name ?? "—"}${conflictRow.badge_number ? ` / ${conflictRow.badge_number}` : ""}).`
                    : `Conflict — ${p.locker_number} already has an active occupant (row not found on lookup).`,
                  conflictRow,
                });
              }
            } else {
              throw error;
            }
          } else {
            activated++;
            auditRows.push({
              locker_id: p.locker.id,
              locker_number: p.locker_number,
              previous_status: `(missing occupancy/${p.category})`,
              new_status: `active (occupancy/${p.category})`,
              source: "sync_occupancy_with_lockers",
              changed_by: userId,
              changed_by_email: userEmail,
            });
          }
        }
      } catch (e) {
        const { code, message } = describeError(e);
        console.warn(`Sync failed for ${p.locker_number} (${p.category}):`, e);
        failedItems.push({
          locker_number: p.locker_number,
          category: p.category,
          kind: p.kind,
          code,
          reason: message,
        });
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
    setResult({ terminated, activated, updated, duplicates_removed, failedItems });
    setApplying(false);
    toast.success(
      `Sync applied: ${updated} updated · ${terminated} terminated · ${activated} activated · ${duplicates_removed} duplicates removed${failedItems.length > 0 ? ` · ${failedItems.length} need${failedItems.length === 1 ? "s" : ""} attention` : ""}.`,
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !applying && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Sync Occupancy with Lockers page
          </DialogTitle>
          <DialogDescription>
            Scans every locker_occupancy category (Main, Staff, Shoe) against the Lockers page and
            fixes drifted or missing records.
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
              <span className="text-success font-semibold">{result.activated}</span> activated ·{" "}
              <span className="text-warning font-semibold">{result.duplicates_removed}</span> duplicates removed
              {result.failedItems.length > 0 && (
                <>
                  {" · "}
                  <span className="text-destructive font-semibold">{result.failedItems.length}</span>{" "}
                  item{result.failedItems.length === 1 ? "" : "s"} need attention
                </>
              )}
            </div>
            {result.failedItems.length > 0 && (
              <div className="border rounded-md bg-destructive/5">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-destructive"
                  onClick={() => setFailedExpanded((v) => !v)}
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {result.failedItems.length} item{result.failedItems.length === 1 ? "" : "s"} need attention
                  </span>
                  {failedExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {failedExpanded && (
                  <div className="max-h-72 overflow-y-auto divide-y divide-destructive/20 border-t border-destructive/20">
                    {result.failedItems.map((f, idx) => {
                      const actionLabel =
                        f.kind === "terminate" ? "Mark Terminated"
                        : f.kind === "activate" ? "Add Active"
                        : "Remove Duplicate";
                      return (
                        <div key={`${f.locker_number}-${f.category}-${idx}`} className="px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-mono font-semibold">{f.locker_number}</span>
                              <span className="text-muted-foreground"> · {f.category}</span>
                              <span className="text-muted-foreground"> · {actionLabel}</span>
                              {f.code && (
                                <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
                                  {f.code}
                                </span>
                              )}
                            </div>
                            {f.conflictRow && onRequestForceTerminate && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 shrink-0 gap-1"
                                onClick={() => {
                                  onRequestForceTerminate(f.conflictRow!);
                                  onClose();
                                }}
                              >
                                <StopCircle className="h-3.5 w-3.5" /> Resolve conflict
                              </Button>
                            )}
                          </div>
                          <div className="text-muted-foreground">{f.reason}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : scanning ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Scanning occupancy vs lockers across all categories…</p>
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : plans.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No discrepancies found — occupancy is already in sync with the Lockers page. 🎉
          </div>
        ) : (
          <>
            <div className="text-sm">
              <span className="text-destructive font-semibold">{counts.t}</span> to <b>Terminate</b> ·{" "}
              <span className="text-success font-semibold">{counts.a}</span> to <b>Activate</b> ·{" "}
              <span className="text-warning font-semibold">{counts.d}</span> duplicate row{counts.d === 1 ? "" : "s"} to <b>Remove</b>.
            </div>

            <div className="border rounded-md overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="px-2 py-1.5">Locker #</th>
                    <th className="px-2 py-1.5">Category</th>
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
                            aria-label={`Include ${p.locker_number} (${p.category})`}
                          />
                        </td>
                        <td className="px-2 py-1 font-mono font-medium">{p.locker_number}</td>
                        <td className="px-2 py-1 text-xs uppercase text-muted-foreground">{p.category}</td>
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
                          ) : p.kind === "activate" ? (
                            <Badge variant="outline" className="border-success text-success">
                              Add Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-warning text-warning">
                              Remove Duplicate
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1 text-xs text-muted-foreground max-w-[240px]">
                          {p.kind === "terminate" ? (
                            <span title={p.reason}>
                              {p.termination_date}
                              {p.source === "fallback" ? " (fallback)" : ""} · {p.reason}
                            </span>
                          ) : p.kind === "duplicate_cleanup" ? (
                            <span title={p.reason}>{p.reason}</span>
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
