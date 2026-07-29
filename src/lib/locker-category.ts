// Canonical locker category derivation from the physical numbering convention.
//
//  - main  (Full Locker)  : digits followed by one or more letters — 1A, 1B, 1411E
//  - staff (Staff Locker) : 2-3 letters followed by digits — ANY prefix (AA01,
//                            MM06, ZZ18, ABC12). No alphabetical range limit.
//  - shoe  (Shoe Locker)  : a single letter A-Y followed by digits  — B08, Y12
//  - hr    (HR Locker)    : exactly "LK" + 2 digits, 01-40          — LK01 … LK40
//
// Anything else is unclassified (null) and must be reviewed manually.
import type { OccCategory } from "@/lib/occupancy-cache";

export const OCC_CATEGORIES: OccCategory[] = ["main", "staff", "shoe", "hr"];

export const OCC_CATEGORY_SHORT: Record<OccCategory, string> = {
  main: "Full Locker",
  staff: "Staff Locker",
  shoe: "Shoe Locker",
  hr: "HR Locker",
};

export function normalizeLockerNumber(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\u2060/g, "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Returns the correct category for a locker number, or null when unclassified. */
export function deriveOccCategory(raw: string | null | undefined): OccCategory | null {
  const n = normalizeLockerNumber(raw);
  if (!n) return null;

  // HR: LK01 - LK40 (exactly two digits).
  const hr = /^LK(\d{2})$/.exec(n);
  if (hr) {
    const num = parseInt(hr[1], 10);
    return num >= 1 && num <= 40 ? "hr" : null;
  }

  // Full: digits then letters.
  if (/^\d+[A-Z]+$/.test(n)) return "main";

  // Letters then digits.
  const lead = /^([A-Z]+)(\d+)$/.exec(n);
  if (lead) {
    const letters = lead[1];
    if (letters.length === 1) return letters === "Z" ? null : "shoe";
    if (letters.length === 2 || letters.length === 3) return "staff";
    return null;
  }

  return null;
}

/** Derive with a fallback for write paths that must always store something. */
export function deriveOccCategoryOr(raw: string | null | undefined, fallback: OccCategory): OccCategory {
  return deriveOccCategory(raw) ?? fallback;
}
