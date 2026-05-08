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
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shield, AlertCircle, UserCog, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createUserAccount } from "@/lib/admin-invite.functions";
import { type AppPermission, PERMISSION_LABELS, PAGE_PERMISSIONS, ACTION_PERMISSIONS } from "@/lib/permissions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — LockerOps" }] }),
  component: AdminPage,
});

type Profile = { id: string; email: string | null; full_name: string | null };
type RoleRow = { user_id: string; role: "admin" | "viewer" };
type PermRow = { user_id: string; permission: AppPermission };

type CategoryKey = "pages" | "actions";
const CATEGORIES: { key: CategoryKey; label: string; perms: AppPermission[] }[] = [
  { key: "pages", label: "Page Access", perms: PAGE_PERMISSIONS },
  { key: "actions", label: "Actions", perms: ACTION_PERMISSIONS },
];

function AdminPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Map<string, "admin" | "viewer">>(new Map());
  const [perms, setPerms] = useState<Map<string, Set<AppPermission>>>(new Map());
  const [busy, setBusy] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Map<string, CategoryKey>>(new Map());

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
    await supabase.from("user_roles").delete().eq("user_id", uid).neq("role", newRole);
    const { error } = await supabase.from("user_roles").upsert({ user_id: uid, role: newRole });
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

  const setCategoryFor = (uid: string, key: CategoryKey) => {
    const next = new Map(activeCategory);
    next.set(uid, key);
    setActiveCategory(next);
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

  const pending = profiles.filter((p) => !roles.has(p.id));
  const active = profiles.filter((p) => roles.has(p.id));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <UserCog className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-bold">Admin — User Permissions</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Approve pending sign-ups and manage each user's role and granular permissions by category.
        </p>

        {pending.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
              Pending approval
              <Badge variant="outline">{pending.length}</Badge>
            </h2>
            <div className="space-y-3">
              {pending.map((p) => (
                <Card key={p.id} className="p-4 border-warning/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{p.full_name ?? "—"}</div>
                      <div className="text-sm text-muted-foreground">{p.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-warning text-warning">Pending</Badge>
                      <Button size="sm" disabled={busy} onClick={() => setRole(p.id, "viewer")}>
                        Approve as Viewer
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setRole(p.id, "admin")}>
                        Approve as Admin
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        <h2 className="font-display text-lg font-semibold mb-3">Active users</h2>
        <div className="space-y-3">
          {active.map((p) => {
            const r = roles.get(p.id) ?? "viewer";
            const userPerms = perms.get(p.id) ?? new Set<AppPermission>();
            const isSelf = p.id === user.id;
            const cat = activeCategory.get(p.id) ?? "pages";
            const currentCategory = CATEGORIES.find((c) => c.key === cat)!;
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

                <div className="pt-3 border-t grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4">
                  <div className="sm:border-r sm:pr-4">
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Permissions</div>
                    <div className="flex sm:flex-col gap-1">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setCategoryFor(p.id, c.key)}
                          className={`text-left text-sm px-3 py-2 rounded-md transition-colors ${
                            cat === c.key
                              ? "bg-primary/10 text-primary font-semibold"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-3">{currentCategory.label}</div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {currentCategory.perms.map((perm) => {
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
                      <p className="text-xs text-muted-foreground mt-3">Admins automatically have all permissions.</p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
