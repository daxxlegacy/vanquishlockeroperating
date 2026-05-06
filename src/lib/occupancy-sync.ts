// Sync locker mutations from the /lockers page into the locker_occupancy
// history (category = "main"). Maintains the invariant that each locker has
// AT MOST one Active row and one Terminate row at any time.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

/**
 * Mark a locker as terminated in occupancy history.
 * - Flips the existing Active row (if any) to Terminate.
 * - Removes any prior Terminate rows for this locker so only the most recent
 *   termination remains.
 */
export async function syncTerminationToOccupancy(
  locker: Locker,
  terminationDateIso: string,
  reason: string | null,
): Promise<void> {
  // 1. Find the active row for this locker
  const { data: activeRows } = await supabase
    .from("locker_occupancy")
    .select("id")
    .eq("category", "main")
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active")
    .limit(1);

  // 2. Remove any prior terminate rows so only ONE terminate remains
  await supabase
    .from("locker_occupancy")
    .delete()
    .eq("category", "main")
    .eq("locker_number", locker.locker_number)
    .or("status.ilike.terminate,status.ilike.terminated");

  if (activeRows && activeRows.length > 0) {
    await supabase
      .from("locker_occupancy")
      .update({
        status: "Terminate",
        termination_date: terminationDateIso,
        remarks: reason ?? undefined,
      })
      .eq("id", activeRows[0].id);
    return;
  }

  // 3. No active row — insert a fresh historical record
  await supabase.from("locker_occupancy").insert({
    category: "main",
    locker_number: locker.locker_number,
    locker_row: locker.row_label,
    locker_location_by_row: locker.location,
    key_lock_type: locker.key_lock,
    badge_number: locker.badge_number,
    employee_name: locker.employee_name,
    status: "Terminate",
    batch_intake_date: locker.batch_intake ?? null,
    termination_date: terminationDateIso,
    remarks: reason,
    source_filename: "manual-termination",
  });
}

/**
 * Mark a locker as Active in occupancy history.
 * - If an Active row exists, updates it with the latest locker details.
 * - Otherwise inserts a new Active row.
 * - Ensures only ONE Active row exists per locker.
 */
export async function syncActivationToOccupancy(locker: Locker): Promise<void> {
  if (!locker.employee_name && !locker.badge_number) return;

  const { data: activeRows } = await supabase
    .from("locker_occupancy")
    .select("id")
    .eq("category", "main")
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active");

  const payload = {
    category: "main",
    locker_number: locker.locker_number,
    locker_row: locker.row_label,
    locker_location_by_row: locker.location,
    key_lock_type: locker.key_lock,
    badge_number: locker.badge_number,
    employee_name: locker.employee_name,
    status: "Active",
    batch_intake_date: locker.batch_intake ?? null,
    termination_date: null,
    source_filename: "manual-activation",
  };

  if (activeRows && activeRows.length > 0) {
    // Keep the first, update it; delete extras to enforce single-active invariant
    const [keep, ...extras] = activeRows;
    await supabase.from("locker_occupancy").update(payload).eq("id", keep.id);
    if (extras.length > 0) {
      await supabase
        .from("locker_occupancy")
        .delete()
        .in("id", extras.map((r) => r.id));
    }
  } else {
    await supabase.from("locker_occupancy").insert(payload);
  }
}
