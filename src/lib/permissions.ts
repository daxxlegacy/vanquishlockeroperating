// Granular permission helpers — admins implicitly have everything.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppPermission = "locker_management" | "termination_actions" | "upload_roster" | "run_automation";

export const PERMISSION_LABELS: Record<AppPermission, string> = {
  locker_management: "Locker management (edit, assign, delete lockers)",
  termination_actions: "Termination actions (terminate, undo, bulk)",
  upload_roster: "Upload roster files",
  run_automation: "Run automation tasks",
};

export function usePermissions() {
  const { user, role } = useAuth();
  const [perms, setPerms] = useState<Set<AppPermission>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) { setPerms(new Set()); setLoaded(true); return; }
    supabase.from("user_permissions").select("permission").eq("user_id", user.id).then(({ data }) => {
      setPerms(new Set((data ?? []).map((d) => d.permission as AppPermission)));
      setLoaded(true);
    });
  }, [user]);

  const has = (p: AppPermission) => role === "admin" || perms.has(p);
  return { has, perms, loaded, isAdmin: role === "admin" };
}
