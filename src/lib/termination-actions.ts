// Undo a recent termination (15 minute window) — restores employee, badge, and prior status.
// Also exposes terminateLocker() for one-shot terminations (used by bulk + dialog flows).
import { supabase } from "@/integrations/supabase/client";
import { syncActivationToOccupancy } from "@/lib/occupancy-sync";
import { patchLockersInCache } from "@/lib/lockers-cache";
import { patchOccupancyInCache, removeOccupancyFromCache } from "@/lib/occupancy-cache";
import { emitTableChanged } from "@/lib/row-events";
import { applyTerminationResult, type AtomicTerminationResult } from "@/lib/termination-result";
import type { Database } from "@/integrations/supabase/types";
import { validTerminationMetadata, type TerminationMetadata } from "./termination-reasons";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
type LockerStatus = Database["public"]["Enums"]["locker_status"];


export const TERMINATION_UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Build the locker UPDATE payload for a termination. Clears all occupant +
 * personal details while keeping location, row, key_lock, unit_type, and
 * compartment metadata intact. Does NOT touch spare_key_status — the spare
 * key is a physical inventory item and must be managed explicitly on the
 * Spare Keys page, otherwise a termination can silently overwrite a known
 * "available" spare with "missing".
 */
export function buildTerminationClearPayload(
  newStatus: LockerStatus,
): {
  employee_name: null;
  badge_number: null;
  national_id: null;
  batch_intake: null;
  remark: null;
  work_location: null;
  status: LockerStatus;
  custom_status: null;
} {
  return {
    employee_name: null,
    badge_number: null,
    national_id: null,
    batch_intake: null,
    remark: null,
    work_location: null,
    status: newStatus,
    custom_status: null,
  };
}

/**
 * The database locks the current occupant and commits every termination write
 * together. Never trust the caller's possibly stale occupant snapshot.
 */
export async function terminateLocker(
  locker: Pick<Locker, "id" | "locker_number" | "location" | "row_label" | "employee_name" | "badge_number"> & Partial<Locker>,
  terminationDateIso: string,
  reason: string | null,
  newStatus: LockerStatus = "empty",
  metadata: TerminationMetadata = {},
): Promise<AtomicTerminationResult> {
  if (!validTerminationMetadata(metadata)) throw new Error("Termination type is required for OTHER");
  const { data, error } = await supabase.rpc("terminate_locker_atomic", {
    _locker_id: locker.id,
    _termination_date: terminationDateIso,
    _reason: reason?.trim() || "",
    _new_status: newStatus,
    _termination_type: metadata.termination_type ?? undefined,
    _reason_code: metadata.reason_code ?? undefined,
    _reason_category: metadata.reason_category ?? undefined,
    _reason_detail: metadata.reason_detail ?? undefined,
  });
  if (error) throw new Error(`Locker ${locker.locker_number}: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data) || !("locker" in data)) {
    throw new Error(`Locker ${locker.locker_number}: termination returned no saved state`);
  }
  const result = data as unknown as AtomicTerminationResult;
  applyTerminationResult(result, {
    removeOccupancy: removeOccupancyFromCache,
    patchOccupancy: patchOccupancyInCache,
    patchLockers: patchLockersInCache,
    refreshOccupancy: () => emitTableChanged("locker_occupancy"),
  });
  return result;
}


/**
 * Admin-only restore of a termination logged today or yesterday — no 15-minute
 * window. Restores occupant details + prior status on the locker and
 * re-activates the occupancy record.
 */
export async function restoreTerminationAdmin(terminationId: string): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) throw new Error("Not signed in");

  const { data: t, error: eFetch } = await supabase
    .from("terminations")
    .select("*")
    .eq("id", terminationId)
    .single();
  if (eFetch || !t) throw eFetch ?? new Error("Termination not found");
  if (t.undone_at) throw new Error("Already restored");
  if (!t.locker_id) throw new Error("Original locker reference missing");

  const { data: locker, error: eRestore } = await supabase
    .from("lockers")
    .update({
      employee_name: t.prior_employee_name ?? t.employee_name,
      badge_number: t.prior_badge_number ?? t.badge_number,
      status: t.prior_status ?? "active",
    })
    .eq("id", t.locker_id)
    .select("*")
    .single();
  if (eRestore) throw eRestore;

  const { error: eMark } = await supabase
    .from("terminations")
    .update({ undone_at: new Date().toISOString(), undone_by: me.user.id })
    .eq("id", terminationId);
  if (eMark) throw eMark;

  if (locker) {
    try { await syncActivationToOccupancy(locker as Locker); } catch { /* non-fatal */ }
  }
}

export async function undoTermination(terminationId: string): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) throw new Error("Not signed in");

  const { data: t, error: eFetch } = await supabase
    .from("terminations")
    .select("*")
    .eq("id", terminationId)
    .single();
  if (eFetch || !t) throw eFetch ?? new Error("Termination not found");
  if (t.undone_at) throw new Error("Already restored");

  const ageMs = Date.now() - new Date(t.created_at).getTime();
  if (ageMs > TERMINATION_UNDO_WINDOW_MS) throw new Error("Undo window has expired");
  if (!t.locker_id) throw new Error("Original locker reference missing");

  const { error: eRestore } = await supabase
    .from("lockers")
    .update({
      employee_name: t.prior_employee_name ?? t.employee_name,
      badge_number: t.prior_badge_number ?? t.badge_number,
      status: t.prior_status ?? "active",
    })
    .eq("id", t.locker_id);
  if (eRestore) throw eRestore;

  const { error: eMark } = await supabase
    .from("terminations")
    .update({ undone_at: new Date().toISOString(), undone_by: me.user.id })
    .eq("id", terminationId);
  if (eMark) throw eMark;
}
