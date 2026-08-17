// Occupancy row types + instant-update notifications.
//
// The Occupancy list is now server-paginated (see occupancy-page.ts), so this
// module no longer holds a full client-side dataset or a localStorage cache.
// It keeps the shared row type and the two entry points single-row flows use
// (patch / invalidate), which now notify paginated views through row-events.
import { emitRowsChanged, emitTableChanged } from "@/lib/row-events";

export type OccCategory = "main" | "staff" | "shoe" | "hr";

export type OccupancyRow = {
  id: string;
  category: OccCategory;
  locker_number: string;
  locker_row: string | null;
  locker_unit: string | null;
  locker_location_by_row: string | null;
  key_lock_type: string | null;
  badge_number: string | null;
  employee_name: string | null;
  national_id: string | null;
  work_location: string | null;
  contact: string | null;
  status: string | null;
  batch_intake_date: string | null;
  termination_date: string | null;
  gradeset: string | null;
  department: string | null;
  remarks: string | null;
  source_filename: string | null;
};

/** Notify list views that specific occupancy rows changed, so the currently
 *  visible page refreshes immediately. */
export function patchOccupancyInCache(rows: OccupancyRow[]) {
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length > 0) emitRowsChanged("locker_occupancy", ids);
}

/** Notify list views that an unknown/large set of occupancy rows changed. */
export function invalidateOccupancyCache(_cat?: OccCategory) {
  emitTableChanged("locker_occupancy");
}

/** Kept for header indicators — paginated views own their own loading state. */
export function useOccupancyRefreshing() {
  return false;
}
