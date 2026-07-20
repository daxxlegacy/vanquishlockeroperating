import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Lock, Upload, LayoutGrid, Table as TableIcon, LogOut, Shield, Key, UserCog, History, ShieldAlert, Menu, LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePermissions, type AppPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useNewSupportRequestsCount } from "@/lib/support-requests";
import { BackgroundRefreshIndicator } from "@/components/BackgroundRefreshIndicator";


export function AppHeader() {
  const { user, role, signOut } = useAuth();
  const { has } = usePermissions();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const newSupportCount = useNewSupportRequestsCount();

  if (!user) return null;

  const navItems: { to: string; label: string; icon: typeof LayoutGrid; perm?: AppPermission | AppPermission[]; adminOnly?: boolean; badgeCount?: number }[] = [
    { to: "/", label: "Map", icon: LayoutGrid, perm: "page_map" },
    { to: "/lockers", label: "Lockers", icon: TableIcon, perm: "page_lockers" },
    { to: "/spare-keys", label: "Spare Keys", icon: Key, perm: "page_spare_keys" },
    { to: "/occupancy", label: "Occupancy", icon: History, perm: "page_occupancy" },
    { to: "/support-requests", label: "Support", icon: LifeBuoy, perm: ["page_support_requests", "manage_support_requests"], badgeCount: newSupportCount },
    { to: "/reconcile", label: "Reconcile", icon: ShieldAlert, perm: "page_reconcile" },
    { to: "/upload", label: "Upload", icon: Upload, perm: "page_upload" },
    { to: "/admin", label: "Admin", icon: UserCog, adminOnly: true },
  ];

  const visibleItems = navItems.filter((item) => {
    if (item.adminOnly && role !== "admin") return false;
    if (item.perm) {
      const perms = Array.isArray(item.perm) ? item.perm : [item.perm];
      if (!perms.some((p) => has(p))) return false;
    }
    return true;
  });


  return (
    <header className="border-b bg-sidebar text-sidebar-foreground sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-3 xl:gap-8">
        {/* Mobile menu */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="xl:hidden text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shrink-0"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-sidebar text-sidebar-foreground border-sidebar-border p-0 flex flex-col">
            <SheetHeader className="px-4 pt-4 pb-2 text-left">
              <SheetTitle className="flex items-center gap-2 font-display font-bold text-lg text-sidebar-foreground">
                <div className="h-8 w-8 rounded-md bg-sidebar-primary grid place-items-center">
                  <Lock className="h-4 w-4 text-sidebar-primary-foreground" />
                </div>
                LockerOps
              </SheetTitle>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
              {visibleItems.map((item) => {
                const active = path === item.to;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium flex items-center gap-3 transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    {item.badgeCount && item.badgeCount > 0 ? (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">
                        {item.badgeCount > 99 ? "99+" : item.badgeCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-sidebar-border px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-sidebar-border text-sidebar-foreground/90 gap-1">
                  <Shield className="h-3 w-3" />
                  {role ?? "..."}
                </Badge>
              </div>
              <div className="text-xs text-sidebar-foreground/70 truncate">{user.email}</div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={async () => {
                  setMenuOpen(false);
                  await signOut();
                  navigate({ to: "/auth" });
                }}
              >
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg shrink-0">
          <div className="h-8 w-8 rounded-md bg-sidebar-primary grid place-items-center">
            <Lock className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          LockerOps
        </Link>

        {/* Desktop nav — unchanged on large screens */}
        <nav className="hidden xl:flex items-center gap-1">
          {visibleItems.map((item) => {
            const active = path === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.badgeCount && item.badgeCount > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">
                    {item.badgeCount > 99 ? "99+" : item.badgeCount}
                  </span>
                ) : null}
              </Link>

            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3 min-w-0">
          <BackgroundRefreshIndicator />


          <Badge variant="outline" className="border-sidebar-border text-sidebar-foreground/90 gap-1 shrink-0">
            <Shield className="h-3 w-3" />
            {role ?? "..."}
          </Badge>
          <span className="text-sm text-sidebar-foreground/70 hidden xl:inline truncate">{user.email}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shrink-0"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
