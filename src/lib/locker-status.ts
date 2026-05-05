// Centralized locker status metadata so colors / labels / options stay in sync.
export const LOCKER_STATUSES = [
  "active",
  "empty",
  "repair",
  "cleaning",
  "broken_door",
  "on_hold",
  "reserved",
  "unknown",
] as const;

export type LockerStatus = (typeof LOCKER_STATUSES)[number];

export const STATUS_LABEL: Record<LockerStatus, string> = {
  active: "Occupied",
  empty: "Empty",
  repair: "Repair",
  cleaning: "Cleaning",
  broken_door: "Broken door",
  on_hold: "On hold",
  reserved: "Reserved",
  unknown: "Unknown",
};

// Tailwind class for cell background + border + text foreground.
export const STATUS_CELL: Record<LockerStatus, string> = {
  active: "bg-destructive border-destructive text-destructive-foreground",
  empty: "bg-success border-success text-success-foreground",
  repair: "bg-warning border-warning text-warning-foreground",
  cleaning: "bg-sky-500 border-sky-500 text-white",
  broken_door: "bg-rose-700 border-rose-700 text-white",
  on_hold: "bg-amber-300 border-amber-300 text-amber-950",
  reserved: "bg-violet-500 border-violet-500 text-white",
  unknown: "bg-muted border-border text-muted-foreground",
};

// Just the swatch color (for legends / dots).
export const STATUS_SWATCH: Record<LockerStatus, string> = {
  active: "bg-destructive",
  empty: "bg-success",
  repair: "bg-warning",
  cleaning: "bg-sky-500",
  broken_door: "bg-rose-700",
  on_hold: "bg-amber-300",
  reserved: "bg-violet-500",
  unknown: "bg-muted-foreground",
};
