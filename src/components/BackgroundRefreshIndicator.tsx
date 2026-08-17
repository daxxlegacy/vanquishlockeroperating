import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  invalidateLockersCache,
  useLockersIncomplete,
  useLockersRefreshing,
} from "@/lib/lockers-cache";
import { useOccupancyRefreshing } from "@/lib/occupancy-cache";

/** Subtle pill that appears in the header whenever any shared cache is
 *  quietly refreshing in the background. Non-blocking, no layout shift —
 *  reserves its own space and only fades in/out.
 *
 *  When the locker list failed to load completely, it switches to a visible
 *  "X of Y loaded" warning with a retry button so a truncated dataset is
 *  never displayed as if it were correct. */
export function BackgroundRefreshIndicator() {
  const lockersRefreshing = useLockersRefreshing();
  const occRefreshing = useOccupancyRefreshing();
  const incomplete = useLockersIncomplete();
  const active = lockersRefreshing || occRefreshing;
  const warned = useRef(false);

  useEffect(() => {
    if (incomplete && !warned.current) {
      warned.current = true;
      toast.error("Failed to load full locker list", {
        description: `Loaded ${incomplete.loaded}${
          incomplete.expected != null ? ` of ${incomplete.expected}` : ""
        } lockers — showing last saved data, please retry.`,
        action: { label: "Retry", onClick: () => invalidateLockersCache() },
      });
    }
    if (!incomplete) warned.current = false;
  }, [incomplete]);

  if (incomplete && !active) {
    return (
      <div
        aria-live="polite"
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-destructive/40 text-[11px] font-medium text-destructive bg-destructive/10"
      >
        <AlertTriangle className="h-3 w-3" />
        <span>
          {incomplete.loaded}
          {incomplete.expected != null ? ` of ${incomplete.expected}` : ""} lockers loaded
        </span>
        <button
          type="button"
          onClick={() => invalidateLockersCache()}
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:opacity-80"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

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
