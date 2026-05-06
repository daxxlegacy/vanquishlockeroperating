// Sync a manual termination from the /lockers page into the locker_occupancy
// history (category = "main"). If an Active row exists for this locker +
// badge/employee, mark it Terminate; otherwise insert a fresh historical row.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export async function syncTerminationToOccupancy(
  locker: Locker,
  terminationDateIso: string,
  reason: string | null,
): Promise<void> {
  // 1. Find the active row for this locker + employee/badge
  const { data: existing } = await supabase
    .from("locker_occupancy")
    .select("id")
    .eq("category", "main")
    .eq("locker_number", locker.locker_number)
    .ilike("status", "active")
    .or(
      [
        locker.badge_number ? `badge_number.eq.${locker.badge_number}` : null,
        locker.employee_name ? `employee_name.eq.${locker.employee_name}` : null,
      ].filter(Boolean).join(",") || "id.is.null",
    )
    .limit(1);

  if (existing && existing.length > 0) {
    await supabase
      .from("locker_occupancy")
      .update({
        status: "Terminate",
        termination_date: terminationDateIso,
        remarks: reason ?? undefined,
      })
      .eq("id", existing[0].id);
    return;
  }

  // 2. No matching active row — insert a historical record
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
