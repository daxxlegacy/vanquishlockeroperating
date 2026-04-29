// Utilities for locker numbers and date parsing.

/**
 * Natural sort key for locker numbers across all known formats:
 *   1A..6378F      -> [0, <num>, <letters>]   (digits-first)
 *   A01..Y40       -> [1, <single-letter>, <num>]
 *   LK01..LK40     -> [2, "LK", <num>]
 *   AA01..KKK18    -> [3, <letters length>, <letters>, <num>]
 * Anything else falls back to string compare last.
 */
export function lockerSortKey(raw: string): (string | number)[] {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return [9, s];

  // digits-first: 1A, 12B, 6378F
  let m = s.match(/^(\d+)([A-Z]*)$/);
  if (m) return [0, parseInt(m[1], 10), m[2]];

  // single letter + digits: A01..Y40
  m = s.match(/^([A-Z])(\d+)$/);
  if (m) return [1, m[1], parseInt(m[2], 10)];

  // LK + digits explicit bucket so it comes after A..Y series
  m = s.match(/^(LK)(\d+)$/);
  if (m) return [2, "LK", parseInt(m[2], 10)];

  // multi-letter + digits: AA01..KKK18
  m = s.match(/^([A-Z]{2,})(\d+)$/);
  if (m) return [3, m[1].length, m[1], parseInt(m[2], 10)];

  return [9, s];
}

export function compareLockerNumbers(a: string, b: string): number {
  const ka = lockerSortKey(a);
  const kb = lockerSortKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const x = ka[i] ?? "";
    const y = kb[i] ?? "";
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else {
      const xs = String(x);
      const ys = String(y);
      if (xs !== ys) return xs < ys ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Parse a batch intake value into ISO yyyy-mm-dd.
 * Accepts: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd,
 * Excel date serial numbers, and JS Date objects. Returns null if unparseable.
 */
export function parseBatchIntake(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  // Excel numeric serial date
  if (typeof value === "number" && isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const s = String(value).trim();
  if (!s) return null;

  // dd/mm/yyyy (or dd-mm-yyyy / dd.mm.yyyy)
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? "19" : "20") + yyyy;
    const d = parseInt(dd, 10);
    const mo = parseInt(mm, 10);
    const y = parseInt(yyyy, 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Fallback: let Date try
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

/** Format ISO yyyy-mm-dd back to dd/mm/yyyy for display. */
export function formatBatchIntake(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
