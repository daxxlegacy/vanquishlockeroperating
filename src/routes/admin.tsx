// Admin dashboard — list users, manage role + granular permissions.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, AlertCircle, UserCog } from "lucide-react";
import { toast } from "sonner";
import { type AppPermission, PERMISSION_LABELS } from "@/lib/permissions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — LockerOps" }] }),
  component: AdminPage,
});

const ALL_PERMS: AppPermission[] = ["locker_management", "termination_actions", "upload_roster", "run_automation"];

type Profile = { id: string; email: string | null; full_name: string | null };
type RoleRow = { user_id: string; role: "admin" | "viewer" };
type PermRow = { user_id: string; permission: AppPermission };

function AdminPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Map<string, "admin" | "viewer">>(new Map());
  const [perms, setPerms] = useState<Map<string, Set<AppPermission>>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const refresh = async () => {
    const [p, r, up] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("user_permissions").select("user_id,permission"),
    ]);
    setProfiles((p.data ?? []) as Profile[]);
    const rm = new Map<string, "admin" | "viewer">();
    for (const row of (r.data ?? []) as RoleRow[]) rm.set(row.user_id, row.role);
    setRoles(rm);
    const pm = new Map<string, Set<AppPermission>>();
    for (const row of (up.data ?? []) as PermRow[]) {
      if (!pm.has(row.user_id)) pm.set(row.user_id, new Set());
      pm.get(row.user_id)!.add(row.permission);
    }
    setPerms(pm);
  };
  useEffect(() => { if (isAdmin) refresh(); }, [isAdmin]);

  const setRole = async (uid: string, newRole: "admin" | "viewer") => {
    setBusy(true);
    const { error } = await supabase.from("user_roles").upsert({ user_id: uid, role: newRole }, { onConflict: "user_id,role" });
    // upsert with composite unique (user_id, role) won't replace different role — delete other first
    await supabase.from("user_roles").delete().eq("user_id", uid).neq("role", newRole);
    await supabase.from("user_roles").upsert({ user_id: uid, role: newRole });
    if (error) toast.error(error.message); else toast.success("Role updated");
    await refresh();
    setBusy(false);
  };

  const togglePerm = async (uid: string, perm: AppPermission, on: boolean) => {
    setBusy(true);
    if (on) {
      const { error } = await supabase.from("user_permissions").insert({ user_id: uid, permission: perm, granted_by: user!.id });
      if (error && !error.message.includes("duplicate")) toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_permissions").delete().eq("user_id", uid).eq("permission", perm);
      if (error) toast.error(error.message);
    }
    await refresh();
    setBusy(false);
  };

  if (loading || !user) return <div className="min-h-screen" />;

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-3xl mx-auto px-6 py-12">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Admins only</AlertTitle>
            <AlertDescription>You need admin role to manage users.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <UserCog className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-bold">Admin — User Permissions</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Grant role and granular permissions per user. New users sign up via the Auth page; admins control what they can do here.
        </p>

        <div className="space-y-3">
          {profiles.map((p) => {
            const r = roles.get(p.id) ?? "viewer";
            const userPerms = perms.get(p.id) ?? new Set<AppPermission>();
            const isSelf = p.id === user.id;
            return (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold">{p.full_name ?? "—"}</div>
                    <div className="text-sm text-muted-foreground">{p.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r === "admin" ? "default" : "outline"} className="gap-1">
                      <Shield className="h-3 w-3" />{r}
                    </Badge>
                    {!isSelf && (
                      <>
                        <Button size="sm" variant={r === "viewer" ? "default" : "outline"} disabled={busy}
                                onClick={() => setRole(p.id, "viewer")}>Viewer</Button>
                        <Button size="sm" variant={r === "admin" ? "default" : "outline"} disabled={busy}
                                onClick={() => setRole(p.id, "admin")}>Admin</Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-2 pt-3 border-t">
                  {ALL_PERMS.map((perm) => {
                    const checked = r === "admin" || userPerms.has(perm);
                    return (
                      <label key={perm} className={`flex items-start gap-2 text-sm ${r === "admin" ? "opacity-60" : ""}`}>
                        <Checkbox
                          checked={checked} disabled={busy || r === "admin"}
                          onCheckedChange={(v) => togglePerm(p.id, perm, !!v)}
                        />
                        <span>{PERMISSION_LABELS[perm]}</span>
                      </label>
                    );
                  })}
                </div>
                {r === "admin" && (
                  <p className="text-xs text-muted-foreground mt-2">Admins automatically have all permissions.</p>
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
