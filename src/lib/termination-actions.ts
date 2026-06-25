// Undo a recent termination (15 minute window) — restores employee, badge, and prior status.
// Also exposes terminateLocker() for one-shot terminations (used by bulk + dialog flows).
import { supabase } from "@/integrations/supabase/client";
import { syncTerminationToOccupancy } from "@/lib/occupancy-sync";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
type LockerStatus = Database["public"]["Enums"]["locker_status"];
type KeyStatus = Database["public"]["Enums"]["key_status"];

export const TERMINATION_UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Build the locker UPDATE payload for a termination. Clears all occupant +
 * personal details while keeping location, row, key_lock, unit_type, and
 * compartment metadata intact. Applies the spare-key auto-rule:
 *   - status="find_spare_key"   → spare_key_status="missing"
 *   - status="reset"            → physical_key_status reset (cleared)
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
  spare_key_status?: KeyStatus;
} {
  const base = {
    employee_name: null,
    badge_number: null,
    national_id: null,
    batch_intake: null,
    remark: null,
    work_location: null,
    status: newStatus,
    custom_status: null,
  } as const;
  if (newStatus === "find_spare_key") return { ...base, spare_key_status: "missing" };
  return base;
}

/**
 * Terminate a single locker occupant. Inserts a terminations row (with
 * prior_* snapshot so undo works), clears occupant fields, sets the
 * post-termination status with spare-key auto-rule, and syncs occupancy.
 */
export async function terminateLocker(
  locker: Pick<Locker, "id" | "locker_number" | "location" | "row_label" | "employee_name" | "badge_number"> & Partial<Locker>,
  terminationDateIso: string,
  reason: string | null,
  newStatus: LockerStatus = "empty",
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  if (!locker.employee_name) throw new Error(`Locker ${locker.locker_number} has no occupant`);

  const cleanReason = reason && reason.trim() ? reason.trim() : null;

  const { error: e1 } = await supabase.from("terminations").insert({
    locker_id: locker.id,
    locker_number: locker.locker_number,
    location: locker.location,
    row_label: locker.row_label ?? null,
    employee_name: locker.employee_name,
    badge_number: locker.badge_number ?? null,
    termination_date: terminationDateIso,
    reason: cleanReason,
    terminated_by: u.user.id,
    terminated_by_email: u.user.email ?? null,
    prior_status: locker.status ?? null,
    prior_employee_name: locker.employee_name,
    prior_badge_number: locker.badge_number ?? null,
  });
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("lockers")
    .update(buildTerminationClearPayload(newStatus))
    .eq("id", locker.id);
  if (e2) throw e2;

  await syncTerminationToOccupancy(locker as Locker, terminationDateIso, cleanReason);
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
