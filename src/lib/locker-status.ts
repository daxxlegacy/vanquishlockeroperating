// Centralized locker status metadata so colors / labels / options stay in sync.
export const LOCKER_STATUSES = [
  "active",
  "empty",
  "repair",
  "cleaning",
  "find_spare_key",
  "broken_door",
  "on_hold",
  "reserved",
  "returning_locker",
  "reset",
  "done_reset",
  "unknown",
] as const;

export type LockerStatus = (typeof LOCKER_STATUSES)[number];

export const STATUS_LABEL: Record<LockerStatus, string> = {
  active: "Occupied",
  empty: "Empty",
  repair: "Repair",
  cleaning: "Cleaning",
  find_spare_key: "Find spare key",
  broken_door: "Broken door",
  on_hold: "On hold",
  reserved: "Reserved",
  returning_locker: "Returning locker",
  reset: "Reset",
  done_reset: "Done reset",
  unknown: "Unknown",
};

// Tailwind class for cell background + border + text foreground.
export const STATUS_CELL: Record<LockerStatus, string> = {
  active: "bg-destructive border-destructive text-destructive-foreground",
  empty: "bg-success border-success text-success-foreground",
  repair: "bg-warning border-warning text-warning-foreground",
  cleaning: "bg-sky-500 border-sky-500 text-white",
  find_spare_key: "bg-orange-500 border-orange-500 text-white",
  broken_door: "bg-rose-700 border-rose-700 text-white",
  on_hold: "bg-amber-300 border-amber-300 text-amber-950",
  reserved: "bg-violet-500 border-violet-500 text-white",
  returning_locker: "bg-indigo-500 border-indigo-500 text-white",
  reset: "bg-pink-500 border-pink-500 text-white",
  done_reset: "bg-teal-600 border-teal-600 text-white",
  unknown: "bg-muted border-border text-muted-foreground",
};

// Just the swatch color (for legends / dots).
export const STATUS_SWATCH: Record<LockerStatus, string> = {
  active: "bg-destructive",
  empty: "bg-success",
  repair: "bg-warning",
  cleaning: "bg-sky-500",
  find_spare_key: "bg-orange-500",
  broken_door: "bg-rose-700",
  on_hold: "bg-amber-300",
  reserved: "bg-violet-500",
  returning_locker: "bg-indigo-500",
  reset: "bg-pink-500",
  done_reset: "bg-teal-600",
  unknown: "bg-muted-foreground",
};

/**
 * Normalize a free-text status value (from uploads, pasted data, etc.) to a
 * canonical LockerStatus. When the input is empty/unrecognized, fall back to
 * "active" if a badge is present, otherwise "empty".
 */
export function normalizeLockerStatus(
  raw: string | null | undefined,
  hasBadge = false,
): LockerStatus {
  if (raw === null || raw === undefined) return hasBadge ? "active" : "empty";
  const n = String(raw).toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return hasBadge ? "active" : "empty";

  // Direct match against canonical keys / labels first.
  for (const s of LOCKER_STATUSES) {
    if (n === s.replace(/_/g, " ")) return s;
    if (n === STATUS_LABEL[s].toLowerCase()) return s;
  }

  if (n.includes("done reset") || n.includes("reset done") || n.includes("reset complete")) return "done_reset";
  if (n.includes("reset")) return "reset";
  if (n.includes("return")) return "returning_locker";
  if (n.includes("clean") || n.includes("wash") || n.includes("sanitiz")) return "cleaning";
  if (n.includes("broken") || n.includes("damaged door") || n.includes("door")) return "broken_door";
  if (n.includes("on hold") || n.includes("hold") || n.includes("pending")) return "on_hold";
  if (n.includes("reserve") || n.includes("booked")) return "reserved";
  if (n.includes("repair") || n.includes("maintenance") || n.includes("fix") || n.includes("batch repair")) return "repair";
  if (
    n.includes("empty") || n.includes("vacant") || n.includes("free") ||
    n.includes("available") || n.includes("unoccupied") || n === "no"
  ) return "empty";
  if (
    n.includes("active") || n.includes("occupied") || n.includes("assigned") ||
    n.includes("in use") || n.includes("listing") || n.includes("taken")
  ) return "active";
  if (n.includes("unknown") || n === "n a" || n === "na") return "unknown";

  return hasBadge ? "active" : "empty";
}

/**
 * Default locker status to set after terminating an occupant, based on the
 * locker's key/lock type. Round-key and pull-key locks lose their primary key
 * with the occupant, so the locker enters "find spare key". Numeric/numerical
 * locks just need a code reset, so the locker goes to "reset".
 * Falls back to "empty" when the lock type is unknown.
 */
export function defaultPostTerminationStatus(
  keyLock: string | null | undefined,
): LockerStatus {
  const n = (keyLock ?? "").toLowerCase();
  if (!n) return "empty";
  if (n.includes("round") || n.includes("pull")) return "find_spare_key";
  if (n.includes("numeric") || n.includes("numerical")) return "reset";
  return "empty";
}

/**
 * Resolve the label to display for a locker's status. When a free-form
 * `custom_status` is set on the locker, that text wins; otherwise we fall
 * back to the canonical enum label.
 */
export function effectiveStatusLabel(
  status: string | null | undefined,
  customStatus: string | null | undefined,
): string {
  const c = (customStatus ?? "").trim();
  if (c) return c;
  if (!status) return "—";
  return STATUS_LABEL[status as LockerStatus] ?? status;
}

/**
 * True when the locker carries a non-empty custom status.
 */
export function hasCustomStatus(customStatus: string | null | undefined): boolean {
  return !!(customStatus && customStatus.trim());
}
