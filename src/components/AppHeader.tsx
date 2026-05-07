import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Lock, Upload, LayoutGrid, Table as TableIcon, LogOut, Shield, Users, Settings, Key, UserCog, History, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AppHeader() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (!user) return null;

  const navItems = [
    { to: "/", label: "Map", icon: LayoutGrid },
    { to: "/lockers", label: "Lockers", icon: TableIcon },
    { to: "/spare-keys", label: "Spare Keys", icon: Key },
    { to: "/occupancy", label: "Occupancy", icon: History },
    { to: "/duplicates", label: "Duplicates", icon: Users },
    { to: "/operations", label: "Operations", icon: Settings },
    { to: "/reconcile", label: "Reconcile", icon: ShieldAlert, adminOnly: true },
    { to: "/upload", label: "Upload", icon: Upload, adminOnly: true },
    { to: "/admin", label: "Admin", icon: UserCog, adminOnly: true },
  ];

  return (
    <header className="border-b bg-sidebar text-sidebar-foreground sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg">
          <div className="h-8 w-8 rounded-md bg-sidebar-primary grid place-items-center">
            <Lock className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          LockerOps
        </Link>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            if (item.adminOnly && role !== "admin") return null;
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
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Badge variant="outline" className="border-sidebar-border text-sidebar-foreground/90 gap-1">
            <Shield className="h-3 w-3" />
            {role ?? "..."}
          </Badge>
          <span className="text-sm text-sidebar-foreground/70 hidden md:inline">{user.email}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
