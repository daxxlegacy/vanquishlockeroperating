import { Loader2 } from "lucide-react";
import { useLockersRefreshing } from "@/lib/lockers-cache";
import { useOccupancyRefreshing } from "@/lib/occupancy-cache";

/** Subtle pill that appears in the header whenever any shared cache is
 *  quietly refreshing in the background. Non-blocking, no layout shift —
 *  reserves its own space and only fades in/out. */
export function BackgroundRefreshIndicator() {
  const lockersRefreshing = useLockersRefreshing();
  const occRefreshing = useOccupancyRefreshing();
  const active = lockersRefreshing || occRefreshing;

  return (
    <div
      aria-live="polite"
      aria-hidden={!active}
      className={`hidden sm:inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-sidebar-border text-[11px] font-medium text-sidebar-foreground/80 bg-sidebar-accent/40 transition-opacity duration-200 ${
        active ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      Updating…
    </div>
  );
}
