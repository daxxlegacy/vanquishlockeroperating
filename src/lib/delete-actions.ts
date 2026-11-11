// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Soft-delete + audit logging + undo helpers (15-minute window).
import { supabase } from "@/integrations/supabase/client";

export const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const UNDO_TOAST_MS = 12_000;          // visible toast time

async function currentUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function softDeleteLocker(opts: {
  id: string;
  locker_number: string;
  location: string;
  reason: string;
}) {
  const me = await currentUser();
  const now = new Date().toISOString();

  const { error: e1 } = await supabase
    .from("lockers")
    .update({ deleted_at: now, deletion_reason: opts.reason, deleted_by: me.id })
    .eq("id", opts.id);
  if (e1) throw e1;

  const { data: audit, error: e2 } = await supabase
    .from("deletion_audit")
    .insert({
      deleted_by: me.id,
      deleted_by_email: me.email,
      deletion_kind: "locker",
      locker_id: opts.id,
      locker_number: opts.locker_number,
      location: opts.location,
      affected_count: 1,
      affected_locker_numbers: [opts.locker_number],
      reason: opts.reason,
    })
    .select("id")
    .single();
  if (e2) throw e2;

  return { auditId: audit.id, deletedAt: now };
}

export async function softDeleteLocation(opts: { location: string; reason: string }) {
  const me = await currentUser();
  const now = new Date().toISOString();

  // fetch ids + numbers first so we can record + restore them later
  const { data: rows, error: eFetch } = await supabase
    .from("lockers")
    .select("id, locker_number")
    .eq("location", opts.location)
    .is("deleted_at", null);
  if (eFetch) throw eFetch;
  const ids = (rows ?? []).map((r) => r.id);
  const numbers = (rows ?? []).map((r) => r.locker_number);
  if (ids.length === 0) return { auditId: null, count: 0 };

  const { error: e1 } = await supabase
    .from("lockers")
    .update({ deleted_at: now, deletion_reason: opts.reason, deleted_by: me.id })
    .in("id", ids);
  if (e1) throw e1;

  const { data: audit, error: e2 } = await supabase
    .from("deletion_audit")
    .insert({
      deleted_by: me.id,
      deleted_by_email: me.email,
      deletion_kind: "location",
      location: opts.location,
      affected_count: ids.length,
      affected_locker_numbers: numbers,
      reason: opts.reason,
    })
    .select("id")
    .single();
  if (e2) throw e2;

  return { auditId: audit.id, count: ids.length };
}

/** Restore a deletion (single locker or whole location). Returns affected count. */
export async function undoDeletion(auditId: string): Promise<number> {
  const me = await currentUser();

  const { data: audit, error: eA } = await supabase
    .from("deletion_audit")
    .select("*")
    .eq("id", auditId)
    .single();
  if (eA || !audit) throw eA ?? new Error("Audit entry not found");
  if (audit.undone_at) throw new Error("Already restored");

  const ageMs = Date.now() - new Date(audit.created_at).getTime();
  if (ageMs > UNDO_WINDOW_MS) throw new Error("Undo window has expired");

  let count = 0;
  if (audit.deletion_kind === "locker" && audit.locker_id) {
    const { error, count: c } = await supabase
      .from("lockers")
      .update({ deleted_at: null, deletion_reason: null, deleted_by: null }, { count: "exact" })
      .eq("id", audit.locker_id);
    if (error) throw error;
    count = c ?? 0;
  } else {
    // location bulk: match by location + numbers + still soft-deleted
    const { error, count: c } = await supabase
      .from("lockers")
      .update({ deleted_at: null, deletion_reason: null, deleted_by: null }, { count: "exact" })
      .eq("location", audit.location)
      .in("locker_number", audit.affected_locker_numbers ?? [])
      .not("deleted_at", "is", null);
    if (error) throw error;
    count = c ?? 0;
  }

  await supabase
    .from("deletion_audit")
    .update({ undone_at: new Date().toISOString(), undone_by: me.id })
    .eq("id", auditId);

  return count;
}
