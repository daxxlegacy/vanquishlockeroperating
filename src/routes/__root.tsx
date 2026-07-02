import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { prefetchLockers } from "@/lib/lockers-cache";
import { prefetchOccupancy } from "@/lib/occupancy-cache";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground font-display">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { title: "VanquishCapital — LockerOps" },
      {
        name: "description",
        content: "Manage 10,000+ lockers, track occupancy, and sync employee status from a single file upload.",
      },
      { property: "og:title", content: "VanquishCapital — LockerOps" },
      { name: "twitter:title", content: "VanquishCapital — LockerOps" },
      {
        property: "og:description",
        content: "Manage 10,000+ lockers, track occupancy, and sync employee status from a single file upload.",
      },
      {
        name: "twitter:description",
        content: "Manage 10,000+ lockers, track occupancy, and sync employee status from a single file upload.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1e34e11e-fdbb-4ee9-9e79-bbb1f3fa43d1/id-preview-11c5aeba--5d64ac73-9092-43d3-84f9-061c781c7a0c.lovable.app-1778143678341.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1e34e11e-fdbb-4ee9-9e79-bbb1f3fa43d1/id-preview-11c5aeba--5d64ac73-9092-43d3-84f9-061c781c7a0c.lovable.app-1778143678341.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
