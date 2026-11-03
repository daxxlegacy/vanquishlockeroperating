import type { Database } from "@/integrations/supabase/types";
import type { OccupancyRow } from "@/lib/occupancy-cache";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
export type AtomicTerminationResult = {
  status: "terminated" | "noop";
  termination_id?: string;
  locker: Locker;
  occupancy_rows: OccupancyRow[];
  removed_occupancy_ids: string[];
};

/** Publish committed state only; a failed RPC must never clear a client row. */
export function applyTerminationResult(
  result: AtomicTerminationResult,
  cache: {
    removeOccupancy: (ids: string[]) => void;
    patchOccupancy: (rows: OccupancyRow[]) => void;
    patchLockers: (rows: Locker[]) => void;
    refreshOccupancy: () => void;
  },
): void {
  cache.removeOccupancy(result.removed_occupancy_ids);
  cache.patchOccupancy(result.occupancy_rows);
  cache.patchLockers([result.locker]);
  cache.refreshOccupancy();
}