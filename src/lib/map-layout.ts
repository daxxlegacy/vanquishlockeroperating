import * as XLSX from "xlsx";
import defaultLayoutData from "@/data/locker-map-layout.json";

export type SheetLayout = {
  rows: number;
  cols: number;
  cells: { r: number; c: number; n: string }[];
};
export type MapLayout = Record<string, SheetLayout>;

const KEY = "lockerops.map_layout_override";
const EVT = "map-layout-changed";

const DEFAULT_LAYOUT = defaultLayoutData as MapLayout;

export function getDefaultLayout(): MapLayout {
  return DEFAULT_LAYOUT;
}

export function getLayout(): MapLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as MapLayout;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_LAYOUT;
    return parsed;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: MapLayout) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(layout));
  window.dispatchEvent(new Event(EVT));
}

export function clearLayoutOverride() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

export function hasLayoutOverride(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(KEY);
}

export function onLayoutChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener("storage", handler);
  };
}

/**
 * Parse an uploaded workbook into a MapLayout. Each sheet's used range becomes
 * a SheetLayout whose cells preserve the original (row, column) positions —
 * mirroring the format already used by `src/data/locker-map-layout.json`.
 * Empty cells are skipped. Cell values are coerced to trimmed uppercase strings.
 */
export async function parseLayoutFromFile(file: File): Promise<MapLayout> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: MapLayout = {};
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cells: SheetLayout["cells"] = [];
    let maxR = 0;
    let maxC = 0;
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (!cell || cell.v === undefined || cell.v === null) continue;
        const raw = String(cell.v).trim();
        if (!raw) continue;
        // 1-based positions to match existing layout JSON
        const r = R - range.s.r + 1;
        const c = C - range.s.c + 1;
        cells.push({ r, c, n: raw.toUpperCase() });
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }
    if (cells.length === 0) continue;
    out[sheetName] = { rows: maxR, cols: maxC, cells };
  }
  if (Object.keys(out).length === 0) {
    throw new Error("No usable sheets found in the file.");
  }
  return out;
}
