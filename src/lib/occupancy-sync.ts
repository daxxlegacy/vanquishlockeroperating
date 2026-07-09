// Sync locker mutations from the /lockers page into the locker_occupancy
// history. Operates across ALL categories (main, staff, shoe) because a
// single locker_number can live in any category. Maintains the invariant
// that each (locker_number, category) has AT MOST one Active row and one
// Terminate row at any time.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

/**
 * Mark a locker as terminated in occupancy history across every category
 * where it appears.
 * - Flips existing Active row(s) to Terminate, preserving each row's category.
 * - Removes any prior Terminate rows for the same (locker_number, category)
 *   so only the most recent termination remains.
 * - If no occupancy rows exist at all for this locker_number, inserts a
 *   fresh Terminate row under category='main' as a fallback.
 */
export async function syncTerminationToOccupancy(
  locker: Locker,
  terminationDateIso: string,
  reason: string | null,
): Promise<void> {
  // 1. Find active rows across ALL categories for this locker
  const { data: activeRows } = await supabase
    .from("locker_occupancy")
    .select("id, category")
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active");

  if (activeRows && activeRows.length > 0) {
    // For each category that has an active row, clear prior terminate rows
    // (in that same category) and flip the active row to terminate.
    const categories = [...new Set(activeRows.map((r) => r.category))];
    for (const cat of categories) {
      await supabase
        .from("locker_occupancy")
        .delete()
        .eq("category", cat)
        .eq("locker_number", locker.locker_number)
        .or("status.ilike.terminate,status.ilike.terminated");
    }

    const ids = activeRows.map((r) => r.id);
    await supabase
      .from("locker_occupancy")
      .update({
        status: "Terminate",
        termination_date: terminationDateIso,
        remarks: reason ?? undefined,
      })
      .in("id", ids);
    return;
  }

  // 2. No active row anywhere — insert a fresh historical record.
  // Default to category='main' (most common); if any other-category row
  // exists for this locker_number, prefer that category to stay consistent.
  const { data: anyRow } = await supabase
    .from("locker_occupancy")
    .select("category")
    .eq("locker_number", locker.locker_number)
    .limit(1);
  const category = anyRow && anyRow.length > 0 ? anyRow[0].category : "main";

  await supabase.from("locker_occupancy").insert({
    category,
    locker_number: locker.locker_number,
    locker_row: locker.row_label,
    locker_location_by_row: locker.location,
    key_lock_type: locker.key_lock,
    badge_number: locker.badge_number,
    employee_name: locker.employee_name,
    national_id: locker.national_id,
    work_location: locker.work_location,
    status: "Terminate",
    batch_intake_date: locker.batch_intake ?? null,
    termination_date: terminationDateIso,
    remarks: reason,
    source_filename: "manual-termination",
  });
}

/**
 * Propagate locker metadata edits (row, location, key lock, batch intake)
 * to ALL occupancy rows for this locker across every category.
 */
export async function syncMetadataToOccupancy(locker: Locker): Promise<void> {
  await supabase
    .from("locker_occupancy")
    .update({
      locker_row: locker.row_label,
      locker_location_by_row: locker.location,
      key_lock_type: locker.key_lock,
      batch_intake_date: locker.batch_intake ?? null,
    })
    .eq("locker_number", locker.locker_number);
}

/**
 * When a locker becomes empty/repair/unknown (i.e. no longer "active" but
 * also not a formal termination), remove any lingering Active row from the
 * occupancy history across every category. Existing Terminate rows are
 * preserved as historical reference, and metadata is refreshed.
 */
export async function syncStatusChangeToOccupancy(locker: Locker): Promise<void> {
  await supabase
    .from("locker_occupancy")
    .delete()
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active");

  await syncMetadataToOccupancy(locker);
}

/**
 * Mark a locker as Active in occupancy history.
 * - If Active row(s) exist in any category, updates the first and deletes
 *   extras to preserve the single-active invariant (per category).
 * - Otherwise inserts a new Active row. Category is inferred from any
 *   existing occupancy row for this locker_number, or defaults to 'main'.
 */
export async function syncActivationToOccupancy(locker: Locker): Promise<void> {
  if (!locker.employee_name && !locker.badge_number) return;

  const { data: activeRows } = await supabase
    .from("locker_occupancy")
    .select("id, category")
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active");

  if (activeRows && activeRows.length > 0) {
    const [keep, ...extras] = activeRows;
    const payload = {
      category: keep.category,
      locker_number: locker.locker_number,
      locker_row: locker.row_label,
      locker_location_by_row: locker.location,
      key_lock_type: locker.key_lock,
      badge_number: locker.badge_number,
      employee_name: locker.employee_name,
      national_id: locker.national_id,
      work_location: locker.work_location,
      status: "Active",
      batch_intake_date: locker.batch_intake ?? null,
      termination_date: null,
      source_filename: "manual-activation",
    };
    await supabase.from("locker_occupancy").update(payload).eq("id", keep.id);
    if (extras.length > 0) {
      await supabase
        .from("locker_occupancy")
        .delete()
        .in("id", extras.map((r) => r.id));
    }
    return;
  }

  // No active row — infer category from any existing occupancy row for
  // this locker_number, default to 'main'.
  const { data: anyRow } = await supabase
    .from("locker_occupancy")
    .select("category")
    .eq("locker_number", locker.locker_number)
    .limit(1);
  const category = anyRow && anyRow.length > 0 ? anyRow[0].category : "main";

  await supabase.from("locker_occupancy").insert({
    category,
    locker_number: locker.locker_number,
    locker_row: locker.row_label,
    locker_location_by_row: locker.location,
    key_lock_type: locker.key_lock,
    badge_number: locker.badge_number,
    employee_name: locker.employee_name,
    national_id: locker.national_id,
    work_location: locker.work_location,
    status: "Active",
    batch_intake_date: locker.batch_intake ?? null,
    termination_date: null,
    source_filename: "manual-activation",
  });
}
