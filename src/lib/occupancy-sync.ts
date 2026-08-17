// Sync locker mutations from the /lockers page into the locker_occupancy
// history. Operates across ALL categories (main, staff, shoe) because a
// single locker_number can live in any category. Maintains the invariant
// that each (locker_number, category) has AT MOST one Active row and one
// Terminate row at any time.
import { deriveOccCategoryOr } from "@/lib/locker-category";
import type { OccCategory } from "@/lib/occupancy-cache";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

/**
 * Record a swap event for one side of a locker swap.
 *
 * For a swap, BOTH lockers are guaranteed to already be occupied — that's
 * the whole premise — so the current Active occupancy row for this
 * locker_number IS the outgoing occupant by definition. We do NOT run a
 * "does an active row already exist" pre-check (which would always fire),
 * and we do NOT match on employee_name/badge_number (uploaded occupancy
 * rows can drift in casing/spelling from lockers.employee_name and would
 * fail a strict match, leaving a stale Active row that then collides with
 * the new insert).
 *
 * Sequence:
 *   1. Terminate ALL current Active occupancy row(s) for this locker_number,
 *      preserving each row's category, tagged "Swapped to <otherLocker>".
 *   2. Insert one fresh Active row for the incoming occupant tagged
 *      "Swapped from <otherLocker>".
 *
 * A `SwapStepError` is thrown with the specific step + locker if any DB
 * operation fails, so the caller can surface which side/step broke.
 */
export class SwapStepError extends Error {
  step: "terminate" | "insert" | "lookup";
  lockerNumber: string;
  constructor(step: "terminate" | "insert" | "lookup", lockerNumber: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : JSON.stringify(cause);
    super(`Swap ${step} failed for ${lockerNumber}: ${causeMsg}`);
    this.name = "SwapStepError";
    this.step = step;
    this.lockerNumber = lockerNumber;
  }
}

export async function recordSwapHistory(
  _outgoing: { locker_number: string; employee_name: string | null; badge_number: string | null },
  postSwapLocker: Locker,
  otherLockerNumber: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const lockerNumber = postSwapLocker.locker_number;

  // 1. Look up current active occupancy rows for this locker_number.
  //    These are the outgoing occupants by definition (swap requires
  //    both lockers to already be occupied). Do NOT filter by employee
  //    match — occupancy data can drift from the lockers table.
  const { data: activeRows, error: lookupErr } = await supabase
    .from("locker_occupancy")
    .select("id, category")
    .eq("locker_number", lockerNumber)
    .ilike("status", "active");
  if (lookupErr) throw new SwapStepError("lookup", lockerNumber, lookupErr);

  const outgoingCategory: string | null = activeRows && activeRows.length > 0 ? activeRows[0].category : null;

  // 2. Terminate ALL of them (usually just one), preserving each row's
  //    own category. Clear any prior Terminate rows first so only the
  //    swap-terminate remains as the latest event per category.
  if (activeRows && activeRows.length > 0) {
    const categories = [...new Set(activeRows.map((r) => r.category))];
    for (const cat of categories) {
      const { error: delErr } = await supabase
        .from("locker_occupancy")
        .delete()
        .eq("category", cat)
        .eq("locker_number", lockerNumber)
        .or("status.ilike.terminate,status.ilike.terminated");
      if (delErr) throw new SwapStepError("terminate", lockerNumber, delErr);
    }

    const ids = activeRows.map((r) => r.id);
    const { error: updErr } = await supabase
      .from("locker_occupancy")
      .update({
        status: "Terminate",
        termination_date: today,
        remarks: `Swapped to ${otherLockerNumber}`,
      })
      .in("id", ids);
    if (updErr) throw new SwapStepError("terminate", lockerNumber, updErr);
  }

  // 3. Insert a fresh Active row for the incoming occupant (if any).
  if (!postSwapLocker.employee_name && !postSwapLocker.badge_number) return;

  // Prefer the outgoing row's category to keep the swap consistent; else
  // any existing category for this locker_number; else default 'main'.
  let category = outgoingCategory;
  if (!category) {
    const { data: anyRow } = await supabase
      .from("locker_occupancy")
      .select("category")
      .eq("locker_number", lockerNumber)
      .limit(1);
    category = anyRow && anyRow.length > 0 ? anyRow[0].category : null;
  }
  category = deriveOccCategoryOr(lockerNumber, (category as OccCategory) ?? "main");

  const { error: insErr } = await supabase.from("locker_occupancy").insert({
    category,
    locker_number: lockerNumber,
    locker_row: postSwapLocker.row_label,
    locker_location_by_row: postSwapLocker.location,
    key_lock_type: postSwapLocker.key_lock,
    badge_number: postSwapLocker.badge_number,
    employee_name: postSwapLocker.employee_name,
    national_id: postSwapLocker.national_id,
    work_location: postSwapLocker.work_location,
    status: "Active",
    batch_intake_date: today,
    termination_date: null,
    remarks: `Swapped from ${otherLockerNumber}`,
    source_filename: "locker-swap",
  });
  if (insErr) throw new SwapStepError("insert", lockerNumber, insErr);
}


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
    const { data: updated } = await supabase
      .from("locker_occupancy")
      .update({
        status: "Terminate",
        termination_date: terminationDateIso,
        remarks: reason ?? undefined,
      })
      .in("id", ids)
      .select("*");
    if (updated && updated.length > 0) {
      patchOccupancyInCache(updated as unknown as OccupancyRow[]);
    }
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
  const category = deriveOccCategoryOr(
    locker.locker_number,
    (anyRow && anyRow.length > 0 ? (anyRow[0].category as OccCategory) : null) ?? "main",
  );

  // Guard: don't create a blank ghost row when there is no occupant data.
  if (!(locker.employee_name ?? "").trim() && !(locker.badge_number ?? "").trim()) {
    console.warn(
      `[occupancy-sync] skipped termination row for ${locker.locker_number}: no employee name or badge number`,
    );
    return;
  }

  const { data: inserted } = await supabase.from("locker_occupancy").insert({

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
  }).select("*");
  if (inserted && inserted.length > 0) {
    patchOccupancyInCache(inserted as unknown as OccupancyRow[]);
  }
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
export class OccupancyConflictError extends Error {
  locker_number: string;
  existing_category: string;
  existing_employee: string | null;
  existing_badge: string | null;
  constructor(locker_number: string, existing: { category: string; employee_name: string | null; badge_number: string | null }) {
    super(`Locker ${locker_number} has an active occupant in category '${existing.category}' (${existing.employee_name ?? "—"} / ${existing.badge_number ?? "—"})`);
    this.name = "OccupancyConflictError";
    this.locker_number = locker_number;
    this.existing_category = existing.category;
    this.existing_employee = existing.employee_name;
    this.existing_badge = existing.badge_number;
  }
}

function norm(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase();
}

export async function syncActivationToOccupancy(locker: Locker): Promise<void> {
  if (!locker.employee_name && !locker.badge_number) return;

  const { data: activeRows } = await supabase
    .from("locker_occupancy")
    .select("id, category, employee_name, badge_number")
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active");

  const payloadCore = {
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

  if (activeRows && activeRows.length > 0) {
    // If any existing active row is a different person, that's a conflict —
    // don't silently overwrite.
    const different = activeRows.find(
      (r) =>
        (norm(r.employee_name) !== norm(locker.employee_name)) ||
        (norm(r.badge_number) !== norm(locker.badge_number)),
    );
    // Prefer a matching row to update; if none matches and there's a different
    // person, surface as conflict.
    const sameRow = activeRows.find(
      (r) =>
        norm(r.employee_name) === norm(locker.employee_name) &&
        norm(r.badge_number) === norm(locker.badge_number),
    );
    if (!sameRow && different) {
      throw new OccupancyConflictError(locker.locker_number, {
        category: different.category,
        employee_name: different.employee_name,
        badge_number: different.badge_number,
      });
    }
    const keep = sameRow ?? activeRows[0];
    const extras = activeRows.filter((r) => r.id !== keep.id);
    await supabase
      .from("locker_occupancy")
      .update({ ...payloadCore, category: keep.category })
      .eq("id", keep.id);
    if (extras.length > 0) {
      await supabase.from("locker_occupancy").delete().in("id", extras.map((r) => r.id));
    }
    return;
  }

  const { data: anyRow } = await supabase
    .from("locker_occupancy")
    .select("category")
    .eq("locker_number", locker.locker_number)
    .limit(1);
  const category = anyRow && anyRow.length > 0 ? anyRow[0].category : "main";

  const { error } = await supabase.from("locker_occupancy").insert({ ...payloadCore, category });
  if (error) {
    // Race: another Active row appeared between the SELECT and INSERT (unique
    // index `locker_occupancy_active_locker_unique`). Re-fetch and reconcile.
    if ((error as { code?: string }).code === "23505") {
      const { data: raced } = await supabase
        .from("locker_occupancy")
        .select("id, category, employee_name, badge_number")
        .eq("locker_number", locker.locker_number)
        .ilike("status", "active")
        .limit(1);
      const existing = raced?.[0];
      if (!existing) throw error;
      const sameone =
        norm(existing.employee_name) === norm(locker.employee_name) &&
        norm(existing.badge_number) === norm(locker.badge_number);
      if (sameone) {
        await supabase.from("locker_occupancy").update({ ...payloadCore, category: existing.category }).eq("id", existing.id);
        return;
      }
      throw new OccupancyConflictError(locker.locker_number, {
        category: existing.category,
        employee_name: existing.employee_name,
        badge_number: existing.badge_number,
      });
    }
    throw error;
  }
}
