// Admin command center — dashboard overview + grouped collapsible sections.
import { DeletionsPanel } from "@/components/operations/DeletionsPanel";
import { RunHistoryPanel } from "@/components/operations/RunHistoryPanel";
import { RecentTerminationsPanel } from "@/components/operations/RecentTerminationsPanel";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Shield, AlertCircle, UserCog, UserPlus, Trash2, Database, Download, Upload,
  ChevronDown, LayoutGrid, Table as TableIcon, Key, History, ShieldAlert,
  Upload as UploadIcon, LifeBuoy, ClipboardCheck, Zap, FileClock, ScrollText,
  UsersRound, Activity, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createUserAccount, deleteUserAccount } from "@/lib/admin-invite.functions";
import { createBackup, restoreBackup } from "@/lib/backup.functions";
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
  { key: "pages", label: "Page Permissions", perms: PAGE_PERMISSIONS },
  { key: "actions", label: "Actions", perms: ACTION_PERMISSIONS },
];

// ---- Section expand-state persistence ----
type SectionKey =
  | "overview" | "people" | "core" | "data" | "lifecycle" | "automation" | "system";

const SECTION_STATE_KEY = "lockerops.admin.sections.v1";
const DEFAULT_EXPANDED: Record<SectionKey, boolean> = {
  overview: true, people: true, core: false, data: false,
  lifecycle: false, automation: false, system: false,
};

function useSectionState() {
  const [state, setState] = useState<Record<SectionKey, boolean>>(() => {
    if (typeof window === "undefined") return DEFAULT_EXPANDED;
    try {
      const raw = localStorage.getItem(SECTION_STATE_KEY);
      if (!raw) return DEFAULT_EXPANDED;
      return { ...DEFAULT_EXPANDED, ...JSON.parse(raw) };
    } catch { return DEFAULT_EXPANDED; }
  });
  const toggle = (k: SectionKey) => setState((prev) => {
    const next = { ...prev, [k]: !prev[k] };
    try { localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  return [state, toggle] as const;
}

function SectionHeader({
  open, onToggle, title, subtitle, icon: Icon, badge,
}: {
  open: boolean; onToggle: () => void; title: string; subtitle?: string;
  icon: typeof LayoutGrid; badge?: number;
}) {
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base sm:text-lg font-semibold">{title}</h2>
            {badge != null && badge > 0 && (
              <Badge variant="destructive" className="h-5 min-w-[1.25rem] px-1.5 text-[10px]">
                {badge > 99 ? "99+" : badge}
              </Badge>
            )}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </CollapsibleTrigger>
  );
}

type QuickLink = {
  to: string; label: string; description: string; icon: typeof LayoutGrid;
  badge?: number; external?: boolean;
};

function QuickLinkGrid({ links }: { links: QuickLink[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((l) => (
        <Link
          key={l.to} to={l.to}
          className="group rounded-lg border p-3 hover:border-primary hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <l.icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-sm">{l.label}</div>
                {l.badge != null && l.badge > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-[1rem] px-1 text-[10px]">
                    {l.badge > 99 ? "99+" : l.badge}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground line-clamp-2">{l.description}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        </Link>
      ))}
    </div>
  );
}

function StatCard({
  label, value, hint, icon: Icon, to, tone = "default",
}: {
  label: string; value: number | string; hint?: string; icon: typeof LayoutGrid;
  to?: string; tone?: "default" | "warning" | "danger";
}) {
  const toneCls = tone === "danger"
    ? "border-destructive/40 bg-destructive/5"
    : tone === "warning"
    ? "border-warning/40 bg-warning/5"
    : "";
  const inner = (
    <div className={`rounded-lg border p-4 ${toneCls} ${to ? "hover:border-primary hover:bg-muted/30 transition-colors" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold font-display">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
  if (!to) return inner;
  return <Link to={to}>{inner}</Link>;
}

function AdminPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Map<string, "admin" | "viewer">>(new Map());
  const [perms, setPerms] = useState<Map<string, Set<AppPermission>>>(new Map());
  const [busy, setBusy] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Map<string, CategoryKey>>(new Map());
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "viewer">("viewer");
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const createUser = useServerFn(createUserAccount);
  const [sections, toggleSection] = useSectionState();

  // Overview counts
  const [pendingSupport, setPendingSupport] = useState<number | null>(null);
  const [pendingClaims, setPendingClaims] = useState<number | null>(null);
  const [drift, setDrift] = useState<number | null>(null);
  const [recentTerms, setRecentTerms] = useState<number | null>(null);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || newPassword.length < 8) return;
    setCreating(true);
    try {
      await createUser({
        data: {
          email: newEmail.trim(),
          password: newPassword,
          fullName: newName.trim() || undefined,
          role: newRole,
        },
      });
      toast.success(`Account created for ${newEmail}`);
      setNewEmail(""); setNewName(""); setNewPassword(""); setNewRole("viewer");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const removeUser = useServerFn(deleteUserAccount);
  const handleRemove = async (uid: string, label: string) => {
    if (!confirm(`Remove ${label}? This permanently deletes their account and all access.`)) return;
    setBusy(true);
    try {
      await removeUser({ data: { userId: uid } });
      toast.success("User removed");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to remove user");
    } finally {
      setBusy(false);
    }
  };

  const runBackup = useServerFn(createBackup);
  const runRestore = useServerFn(restoreBackup);
  const [backupBusy, setBackupBusy] = useState<"data" | "system" | "full" | null>(null);
  const [restoreBusy, setRestoreBusy] = useState<"data" | "system" | "full" | null>(null);

  const downloadBackup = async (kind: "data" | "system" | "full") => {
    setBackupBusy(kind);
    try {
      const result = await runBackup({ data: { kind } });
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `lockerops-backup-${kind}-${stamp}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 200);
      const tableCount = Object.keys(result.tables).length;
      const rowCount = Object.values(result.tables).reduce((s, r) => s + (r as unknown[]).length, 0);
      toast.success(`Backup ready — ${tableCount} tables, ${rowCount} rows`);
    } catch (err: any) {
      toast.error(err?.message ?? "Backup failed");
    } finally {
      setBackupBusy(null);
    }
  };

  const uploadRestore = async (kind: "data" | "system" | "full", file: File) => {
    if (!confirm(`Restore ${kind.toUpperCase()} from "${file.name}"? Existing rows with the same id will be overwritten.`)) return;
    setRestoreBusy(kind);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { kind?: string; tables?: Record<string, unknown[]> };
      if (!parsed.tables || typeof parsed.tables !== "object") throw new Error("Invalid backup file: missing tables");
      const res = await runRestore({ data: { kind, tables: parsed.tables as Record<string, any[]> } });
      const total = Object.values(res.report).reduce((s, n) => s + n, 0);
      toast.success(`Restored ${total} rows across ${Object.keys(res.report).length} tables`);
    } catch (err: any) {
      toast.error(err?.message ?? "Restore failed");
    } finally {
      setRestoreBusy(null);
    }
  };

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

  const refreshOverview = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [sup, cl, dr, tr] = await Promise.all([
      (supabase as any).from("support_requests").select("*", { count: "exact", head: true }).eq("status", "new"),
      (supabase as any).from("locker_identity_claims").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.rpc("count_occupancy_drift"),
      (supabase as any).from("terminations").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    ]);
    setPendingSupport(sup?.count ?? 0);
    setPendingClaims(cl?.count ?? 0);
    const driftVal =
      typeof dr?.data === "number" ? dr.data
      : (dr?.data && typeof dr.data === "object" && "count" in (dr.data as any))
        ? Number((dr.data as any).count) : 0;
    setDrift(Number.isFinite(driftVal) ? driftVal : 0);
    setRecentTerms(tr?.count ?? 0);
  };

  useEffect(() => { if (isAdmin) { refresh(); refreshOverview(); } }, [isAdmin]);

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

  const pending = useMemo(() => profiles.filter((p) => !roles.has(p.id)), [profiles, roles]);
  const active = useMemo(() => profiles.filter((p) => roles.has(p.id)), [profiles, roles]);

  if (loading || !user) return <div className="min-h-screen" />;

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Admins only</AlertTitle>
            <AlertDescription>You need admin role to manage users.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const fmt = (n: number | null) => (n == null ? "…" : n.toLocaleString());

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <UserCog className="h-6 w-6 text-primary" />
          <div>
            <h1 className="font-display text-3xl font-bold">Admin Command Center</h1>
            <p className="text-muted-foreground text-sm">Overview, access management, and quick links to every operational area.</p>
          </div>
        </div>

        {/* ==================== OVERVIEW ==================== */}
        <Card>
          <Collapsible open={sections.overview}>
            <SectionHeader
              open={sections.overview} onToggle={() => toggleSection("overview")}
              icon={Activity} title="Overview" subtitle="Live snapshot of things needing attention"
            />
            <CollapsibleContent>
              <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard
                  label="Pending support" value={fmt(pendingSupport)} icon={LifeBuoy}
                  to="/support-requests"
                  tone={(pendingSupport ?? 0) > 0 ? "warning" : "default"}
                  hint="Status = new"
                />
                <StatCard
                  label="Pending claims" value={fmt(pendingClaims)} icon={ClipboardCheck}
                  to="/support-requests"
                  tone={(pendingClaims ?? 0) > 0 ? "warning" : "default"}
                  hint="Locker identity claims"
                />
                <StatCard
                  label="Occupancy drift" value={fmt(drift)} icon={ShieldAlert}
                  to="/occupancy"
                  tone={(drift ?? 0) > 0 ? "danger" : "default"}
                  hint="Out-of-sync rows"
                />
                <StatCard
                  label="Terminations (7d)" value={fmt(recentTerms)} icon={FileClock}
                  hint="Last 7 days"
                />
                <StatCard
                  label="Pending approvals" value={fmt(pending.length)} icon={UsersRound}
                  tone={pending.length > 0 ? "warning" : "default"}
                  hint="Awaiting role"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* ==================== PEOPLE & ACCESS ==================== */}
        <Card>
          <Collapsible open={sections.people}>
            <SectionHeader
              open={sections.people} onToggle={() => toggleSection("people")}
              icon={UsersRound} title="People & Access"
              subtitle="Users, roles, and granular permissions"
              badge={pending.length}
            />
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-6">
                {/* Create account */}
                <div className="border rounded-md p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <UserPlus className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-base font-semibold">Create user account</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Creates an account immediately with the chosen role.
                  </p>
                  <form onSubmit={submitCreate} className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Email</label>
                      <Input type="email" required placeholder="person@company.com"
                             value={newEmail} onChange={(e) => setNewEmail(e.target.value)} disabled={creating} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Full name (optional)</label>
                      <Input type="text" placeholder="Jane Doe"
                             value={newName} onChange={(e) => setNewName(e.target.value)} disabled={creating} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Temporary password (min 8 chars)</label>
                      <div className="flex items-center gap-2">
                        <Input type={showPassword ? "text" : "password"} required minLength={8} placeholder="set a password"
                               autoComplete="new-password"
                               value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={creating} />
                        <Button type="button" size="sm" variant="outline" disabled={creating}
                                onClick={() => setShowPassword((p) => !p)}>
                          {showPassword ? "Hide" : "Show"}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Role</label>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant={newRole === "viewer" ? "default" : "outline"}
                                onClick={() => setNewRole("viewer")} disabled={creating}>Viewer</Button>
                        <Button type="button" size="sm" variant={newRole === "admin" ? "default" : "outline"}
                                onClick={() => setNewRole("admin")} disabled={creating}>Admin</Button>
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <Button type="submit" disabled={creating}>
                        {creating ? "Creating…" : "Create account"}
                      </Button>
                    </div>
                  </form>
                </div>

                {pending.length > 0 && (
                  <section>
                    <h3 className="font-display text-base font-semibold mb-3 flex items-center gap-2">
                      Pending approval
                      <Badge variant="outline">{pending.length}</Badge>
                    </h3>
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
                              <Button size="sm" variant="destructive" disabled={busy}
                                      onClick={() => handleRemove(p.id, p.email ?? "this user")}
                                      title="Remove user">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="font-display text-base font-semibold mb-3">Active users</h3>
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
                                  <Button size="sm" variant="destructive" disabled={busy}
                                          onClick={() => handleRemove(p.id, p.email ?? p.full_name ?? "this user")}
                                          title="Remove user">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
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
                </section>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* ==================== CORE OPERATIONS ==================== */}
        <Card>
          <Collapsible open={sections.core}>
            <SectionHeader
              open={sections.core} onToggle={() => toggleSection("core")}
              icon={LayoutGrid} title="Core Operations"
              subtitle="Day-to-day locker management pages"
            />
            <CollapsibleContent>
              <div className="px-4 pb-4">
                <QuickLinkGrid links={[
                  { to: "/", label: "Map", icon: LayoutGrid, description: "Visual floor plan of every locker and its status." },
                  { to: "/lockers", label: "Lockers", icon: TableIcon, description: "Tabular view — edit, assign, or delete lockers." },
                  { to: "/spare-keys", label: "Spare Keys", icon: Key, description: "Track which spare keys are missing, taken, or with employees." },
                  { to: "/occupancy", label: "Occupancy", icon: History, description: "Current occupants, history, and force-sync helpers." },
                ]} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* ==================== DATA & RECONCILIATION ==================== */}
        <Card>
          <Collapsible open={sections.data}>
            <SectionHeader
              open={sections.data} onToggle={() => toggleSection("data")}
              icon={ShieldAlert} title="Data & Reconciliation"
              subtitle="Roster uploads, drift detection, bulk edits"
              badge={drift ?? 0}
            />
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-4">
                <QuickLinkGrid links={[
                  { to: "/reconcile", label: "Reconcile", icon: ShieldAlert, description: "Compare HR roster against active occupancy and resolve conflicts." },
                  { to: "/upload", label: "Upload roster", icon: UploadIcon, description: "Import an Excel/CSV of employees to refresh occupancy." },
                  { to: "/lockers", label: "Bulk status update", icon: TableIcon, description: "On the Lockers page — use the Bulk tab to change many rows at once." },
                  { to: "/occupancy", label: "Sync occupancy", icon: History, description: "Reconcile the active locker table with the lockers table." },
                ]} />

                <div className="border rounded-md p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-base font-semibold">Backup & Restore</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    <strong>Data</strong> = lockers, occupancy, terminations, automation, audits, uploads.{" "}
                    <strong>System</strong> = users, roles, permissions. <strong>Full</strong> = both.
                    Restore upserts rows by id.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["data", "system", "full"] as const).map((kind) => (
                      <div key={kind} className="border rounded-md p-3 space-y-2">
                        <div className="font-semibold capitalize text-sm">{kind} backup</div>
                        <Button
                          size="sm" className="w-full gap-2"
                          disabled={backupBusy !== null}
                          onClick={() => downloadBackup(kind)}
                        >
                          <Download className="h-4 w-4" />
                          {backupBusy === kind ? "Exporting…" : `Backup ${kind}`}
                        </Button>
                        <label className="block">
                          <input
                            type="file" accept="application/json" className="hidden"
                            disabled={restoreBusy !== null}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) uploadRestore(kind, f);
                            }}
                          />
                          <span
                            className={`inline-flex items-center justify-center gap-2 text-sm w-full px-3 py-2 rounded-md border cursor-pointer hover:bg-muted ${
                              restoreBusy !== null ? "opacity-50 pointer-events-none" : ""
                            }`}
                          >
                            <Upload className="h-4 w-4" />
                            {restoreBusy === kind ? "Restoring…" : `Restore ${kind}`}
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* ==================== PEOPLE LIFECYCLE ==================== */}
        <Card>
          <Collapsible open={sections.lifecycle}>
            <SectionHeader
              open={sections.lifecycle} onToggle={() => toggleSection("lifecycle")}
              icon={LifeBuoy} title="People Lifecycle"
              subtitle="Terminations, support tickets, identity claims"
              badge={(pendingSupport ?? 0) + (pendingClaims ?? 0)}
            />
            <CollapsibleContent>
              <div className="px-4 pb-4">
                <QuickLinkGrid links={[
                  { to: "/support-requests", label: "Support Requests", icon: LifeBuoy, description: "Handle employee-submitted tickets (transfer, can't find, other).", badge: pendingSupport ?? undefined },
                  { to: "/support-requests", label: "Locker Identity Claims", icon: ClipboardCheck, description: "Review self-service ownership submissions.", badge: pendingClaims ?? undefined },
                  { to: "/occupancy", label: "Terminations", icon: FileClock, description: "View terminated employees and undo actions from Occupancy history." },
                ]} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* ==================== AUTOMATION ==================== */}
        <Card>
          <Collapsible open={sections.automation}>
            <SectionHeader
              open={sections.automation} onToggle={() => toggleSection("automation")}
              icon={Zap} title="Automation"
              subtitle="Batch termination and run history"
            />
            <CollapsibleContent>
              <div className="px-4 pb-4">
                <QuickLinkGrid links={[
                  { to: "/reconcile", label: "Automation", icon: Zap, description: "Run automated termination workflows from the Reconcile page." },
                  { to: "/reconcile", label: "Run History", icon: FileClock, description: "Review past automation runs and their outcomes." },
                ]} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* ==================== SYSTEM ==================== */}
        <Card>
          <Collapsible open={sections.system}>
            <SectionHeader
              open={sections.system} onToggle={() => toggleSection("system")}
              icon={ScrollText} title="System"
              subtitle="Audit trail and database health"
            />
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-3">
                <QuickLinkGrid links={[
                  { to: "/occupancy", label: "Audit Log", icon: ScrollText, description: "Historical actions are visible on the Occupancy page's history tab." },
                ]} />
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>DB migration check</AlertTitle>
                  <AlertDescription className="text-xs">
                    After a deploy, verify recent migrations applied — especially the{" "}
                    <code className="text-[11px]">locker_occupancy_active_locker_unique</code> constraint,
                    which prevents duplicate active assignments.
                  </AlertDescription>
                </Alert>
                <div className="pt-2">
                  <h3 className="text-sm font-semibold mb-2">Termination History (yesterday &amp; today)</h3>
                  <RecentTerminationsPanel />
                </div>
                <div className="pt-2">
                  <h3 className="text-sm font-semibold mb-2">Deletion Audit</h3>
                  <DeletionsPanel />
                </div>
                <div className="pt-2">
                  <h3 className="text-sm font-semibold mb-2">Automation Run History</h3>
                  <RunHistoryPanel />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </main>
    </div>
  );
}
