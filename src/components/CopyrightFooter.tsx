// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

const PUBLIC_QR_PATHS = new Set(["/find-locker", "/locker-identity-update", "/ticket"]);

export function CopyrightFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user, loading } = useAuth();
  const path = pathname.replace(/\/$/, "") || "/";
  if (!PUBLIC_QR_PATHS.has(path) && (loading || !user || path === "/auth")) return null;

  return (
    <footer className="bg-background px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
      © 2026 Farid Asnawi. All rights reserved.
    </footer>
  );
}