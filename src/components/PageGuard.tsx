import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { usePermissions, type AppPermission, PERMISSION_LABELS } from "@/lib/permissions";
import { AppHeader } from "@/components/AppHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";

export function PageGuard({ permission, children }: { permission: AppPermission; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { has, loaded } = usePermissions();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  if (loading || !user || !loaded) return <div className="min-h-screen" />;

  if (!has(permission)) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Access denied</AlertTitle>
            <AlertDescription>
              You don't have permission to view this page ({PERMISSION_LABELS[permission]}). Please contact an administrator.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
