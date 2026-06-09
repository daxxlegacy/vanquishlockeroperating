// Undo a recent termination (15 minute window) — restores employee, badge, and prior status.
// Also exposes terminateLocker() for one-shot terminations (used by bulk flows).
import { supabase } from "@/integrations/supabase/client";
import { syncTerminationToOccupancy } from "@/lib/occupancy-sync";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const TERMINATION_UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Terminate a single locker occupant. Inserts a terminations row, clears the
 * locker's occupant fields, sets the post-termination status, and syncs
 * occupancy history. Mirrors TerminateUserDialog so bulk flows behave identically.
 */
export async function terminateLocker(
  locker: Pick<Locker, "id" | "locker_number" | "location" | "row_label" | "employee_name" | "badge_number"> & Partial<Locker>,
  terminationDateIso: string,
  reason: string | null,
  newStatus: Database["public"]["Enums"]["locker_status"] = "empty",
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  if (!locker.employee_name) throw new Error(`Locker ${locker.locker_number} has no occupant`);

  const { error: e1 } = await supabase.from("terminations").insert({
    locker_id: locker.id,
    locker_number: locker.locker_number,
    location: locker.location,
    row_label: locker.row_label ?? null,
    employee_name: locker.employee_name,
    badge_number: locker.badge_number ?? null,
    termination_date: terminationDateIso,
    reason: reason && reason.trim() ? reason.trim() : null,
    terminated_by: u.user.id,
    terminated_by_email: u.user.email ?? null,
  });
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("lockers")
    .update({ employee_name: null, badge_number: null, national_id: null, batch_intake: null, status: newStatus })
    .eq("id", locker.id);
  if (e2) throw e2;

  await syncTerminationToOccupancy(locker as Locker, terminationDateIso, reason && reason.trim() ? reason.trim() : null);
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
