import { getXLSX } from "@/lib/xlsx-lazy";
import defaultLayoutData from "@/data/locker-map-layout.json";
import { supabase } from "@/integrations/supabase/client";

export type SheetLayout = {
  rows: number;
  cols: number;
  cells: { r: number; c: number; n: string }[];
};
export type MapLayout = Record<string, SheetLayout>;

const ROW_ID = "current";
const EVT = "map-layout-changed";

const DEFAULT_LAYOUT = defaultLayoutData as MapLayout;

// In-memory cache so the existing sync getLayout()/hasLayoutOverride()
// API still works for component initial render. Hydrated from Supabase on
// first import and kept in sync via realtime + manual fetches.
let cachedLayout: MapLayout = DEFAULT_LAYOUT;
let cachedHasOverride = false;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let realtimeStarted = false;

function emit() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVT));
  }
}

function applyRow(row: { layout: unknown } | null) {
  if (row && row.layout && typeof row.layout === "object" && !Array.isArray(row.layout)) {
    cachedLayout = row.layout as MapLayout;
    cachedHasOverride = true;
  } else {
    cachedLayout = DEFAULT_LAYOUT;
    cachedHasOverride = false;
  }
  emit();
}

async function fetchLayoutOnce() {
  const { data, error } = await supabase
    .from("map_layouts")
    .select("layout")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) {
    // Leave defaults in place; surface error to console only.
    console.error("Failed to load map layout:", error.message);
    return;
  }
  applyRow(data);
}

function startRealtime() {
  if (realtimeStarted || typeof window === "undefined") return;
  realtimeStarted = true;
  supabase
    .channel("map_layouts_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "map_layouts" },
      () => {
        void fetchLayoutOnce();
      },
    )
    .subscribe();

  // Re-fetch when the auth session becomes available or changes. The very
  // first getLayout() call can fire before Supabase has attached the user's
  // access token, in which case RLS filters the row out and we'd otherwise
  // be stuck showing the default layout until a manual reload.
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
      void fetchLayoutOnce();
    }
  });
}

export function getDefaultLayout(): MapLayout {
  return DEFAULT_LAYOUT;
}

export function getLayout(): MapLayout {
  // Kick off hydration lazily; consumers re-render via onLayoutChange.
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    hydratePromise = fetchLayoutOnce();
    startRealtime();
  }
  return cachedLayout;
}

export function hasLayoutOverride(): boolean {
  // Ensure hydration started.
  getLayout();
  return cachedHasOverride;
}

export async function refreshLayout(): Promise<void> {
  await fetchLayoutOnce();
}

export async function saveLayout(layout: MapLayout): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const updated_by = auth.user?.id ?? null;
  const { error } = await supabase
    .from("map_layouts")
    .upsert([{ id: ROW_ID, layout: layout as never, updated_by }], { onConflict: "id" });
  if (error) throw new Error(error.message);
  cachedLayout = layout;
  cachedHasOverride = true;
  emit();
}

export async function clearLayoutOverride(): Promise<void> {
  const { error } = await supabase.from("map_layouts").delete().eq("id", ROW_ID);
  if (error) throw new Error(error.message);
  cachedLayout = DEFAULT_LAYOUT;
  cachedHasOverride = false;
  emit();
}

export function onLayoutChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Make sure realtime is running so other tabs/users trigger this handler.
  getLayout();
  // If hydration is still pending, fire once after it completes.
  if (hydratePromise) {
    hydratePromise.then(() => handler()).catch(() => {});
  }
  window.addEventListener(EVT, handler);
  return () => {
    window.removeEventListener(EVT, handler);
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
