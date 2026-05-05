// Undo a recent termination (15 minute window) — restores employee, badge, and prior status.
import { supabase } from "@/integrations/supabase/client";

export const TERMINATION_UNDO_WINDOW_MS = 15 * 60 * 1000;

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
