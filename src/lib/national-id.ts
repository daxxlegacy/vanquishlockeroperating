// Client helpers for National ID masking + on-demand reveal.
// The database enforces masking through the `lockers_masked` /
// `locker_occupancy_masked` views; these helpers keep the frontend consistent.
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/lib/permissions";

/** Convert any national_id string to its masked form: ******LAST4. */
export function maskNationalId(nid: string | null | undefined): string {
  if (!nid) return "";
  const s = String(nid).trim();
  if (s === "") return "";
  if (s.length <= 4) return "*".repeat(s.length);
  return "******" + s.slice(-4);
}

/** Detect a value that has already been server-side masked. */
export function isMaskedNationalId(nid: string | null | undefined): boolean {
  if (!nid) return false;
  return /^\*+/.test(String(nid));
}

/** True for admins or users granted the `view_national_id` permission. */
export function useCanRevealNationalId(): boolean {
  const { has } = usePermissions();
  return has("view_national_id");
}

export type NidTable = "lockers" | "locker_occupancy";

/** Calls the server-side reveal RPC (logged + rate-limited). */
export function useRevealNationalId() {
  return useCallback(async (recordId: string, table: NidTable): Promise<string> => {
    // Cast to `never` because `reveal_national_id` isn't in the generated types yet.
    const { data, error } = await supabase.rpc("reveal_national_id" as never, {
      _record_id: recordId,
      _table_name: table,
    } as never);
    if (error) throw new Error(error.message);
    return (data as string | null) ?? "";
  }, []);
}

/** Simple confirmation before exporting a file that contains National ID data. */
export function confirmNidExport(): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(
    "This export contains National ID data (masked for users without the view_national_id permission). Continue?",
  );
}

/**
 * For CSV/XLSX export by an authorised user: fetch full national_id values
 * from the base table in one query and return a Map<id, full_nid>.
 * Callers that don't have permission should skip this and keep masked values.
 */
export async function fetchFullNationalIds(
  table: NidTable,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => { in: (col: string, v: string[]) => Promise<{ data: { id: string; national_id: string | null }[] | null; error: unknown }> };
      };
    }).from(table).select("id,national_id").in("id", slice);
    if (error || !data) continue;
    for (const r of data) if (r.national_id) out.set(r.id, r.national_id);
  }
  return out;
}
