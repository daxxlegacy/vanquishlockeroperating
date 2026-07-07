// Granular permission helpers — admins implicitly have everything.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppPermission =
  | "locker_management"
  | "termination_actions"
  | "upload_roster"
  | "run_automation"
  | "view_national_id"
  | "manage_support_requests"
  | "page_map"
  | "page_lockers"
  | "page_spare_keys"
  | "page_occupancy"
  | "page_duplicates"
  | "page_operations"
  | "page_reconcile"
  | "page_support_requests"
  | "page_upload";

export const PERMISSION_LABELS: Record<AppPermission, string> = {
  locker_management: "Locker management (edit, assign, delete lockers)",
  termination_actions: "Termination actions (terminate, undo, bulk)",
  upload_roster: "Upload roster files",
  run_automation: "Run automation tasks",
  view_national_id: "View full National ID (bypass masking)",
  manage_support_requests: "Manage Support Requests (view & resolve)",
  page_map: "View Map page",
  page_lockers: "View Lockers page",
  page_spare_keys: "View Spare Keys page",
  page_occupancy: "View Occupancy page",
  page_duplicates: "View Duplicates page",
  page_operations: "View Operations page",
  page_reconcile: "View Reconcile page",
  page_upload: "View Upload page",
};



export const PAGE_PERMISSIONS: AppPermission[] = [
  "page_map",
  "page_lockers",
  "page_spare_keys",
  "page_occupancy",
  "page_duplicates",
  "page_operations",
  "page_reconcile",
  "page_upload",
];

export const ACTION_PERMISSIONS: AppPermission[] = [
  "locker_management",
  "termination_actions",
  "upload_roster",
  "run_automation",
  "view_national_id",
  "manage_support_requests",
];



const PERMS_CACHE_KEY = "lockerops.auth.perms.v1";

function readCachedPerms(userId: string): AppPermission[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERMS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.userId !== userId || !Array.isArray(parsed.perms)) return null;
    return parsed.perms;
  } catch { return null; }
}

function writeCachedPerms(userId: string, perms: AppPermission[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PERMS_CACHE_KEY, JSON.stringify({ userId, perms })); } catch { /* ignore */ }
}

export function usePermissions() {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;
  const [perms, setPerms] = useState<Set<AppPermission>>(() => {
    if (!userId) return new Set();
    const cached = readCachedPerms(userId);
    return cached ? new Set(cached) : new Set();
  });
  const [loaded, setLoaded] = useState<boolean>(() => {
    if (!userId) return true;
    return readCachedPerms(userId) !== null;
  });

  useEffect(() => {
    if (!userId) { setPerms(new Set()); setLoaded(true); return; }
    const cached = readCachedPerms(userId);
    if (cached) {
      setPerms(new Set(cached));
      setLoaded(true);
    }
    supabase.from("user_permissions").select("permission").eq("user_id", userId).then(({ data }) => {
      const list = (data ?? []).map((d) => d.permission as AppPermission);
      setPerms(new Set(list));
      writeCachedPerms(userId, list);
      setLoaded(true);
    });
  }, [userId]);

  const has = (p: AppPermission) => role === "admin" || perms.has(p);
  return { has, perms, loaded, isAdmin: role === "admin" };
}
