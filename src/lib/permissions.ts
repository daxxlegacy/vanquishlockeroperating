// Granular permission helpers — admins implicitly have everything.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppPermission =
  | "locker_management"
  | "termination_actions"
  | "upload_roster"
  | "run_automation"
  | "page_map"
  | "page_lockers"
  | "page_spare_keys"
  | "page_occupancy"
  | "page_duplicates"
  | "page_operations"
  | "page_reconcile"
  | "page_upload";

export const PERMISSION_LABELS: Record<AppPermission, string> = {
  locker_management: "Locker management (edit, assign, delete lockers)",
  termination_actions: "Termination actions (terminate, undo, bulk)",
  upload_roster: "Upload roster files",
  run_automation: "Run automation tasks",
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
];

export function usePermissions() {
  const { user, role } = useAuth();
  const [perms, setPerms] = useState<Set<AppPermission>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) { setPerms(new Set()); setLoaded(true); return; }
    setLoaded(false);
    supabase.from("user_permissions").select("permission").eq("user_id", user.id).then(({ data }) => {
      setPerms(new Set((data ?? []).map((d) => d.permission as AppPermission)));
      setLoaded(true);
    });
  }, [user]);

  const has = (p: AppPermission) => role === "admin" || perms.has(p);
  return { has, perms, loaded, isAdmin: role === "admin" };
}
