// Helpers to encode/decode page filter state into a single `f` URL param so
// users can bookmark / share a filtered view. We base64-JSON encode to keep
// the URL short and to avoid escaping headaches with checkbox value lists.

export type SortState = { col: string; dir: "asc" | "desc" } | null;

export type SerializedFilterState = {
  cf?: Record<string, string[]>; // column filter selections
  q?: string;                    // search
  sort?: SortState;
  // extra arbitrary scalar filters (status select, location, etc.)
  x?: Record<string, string>;
};

function b64encode(s: string): string {
  if (typeof window === "undefined") return "";
  return window.btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  if (typeof window === "undefined") return "";
  try { return decodeURIComponent(escape(window.atob(s))); } catch { return ""; }
}

export function encodeFilterState(state: SerializedFilterState): string {
  // Strip empty parts for tiny URLs.
  const out: SerializedFilterState = {};
  if (state.cf) {
    const cf: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(state.cf)) if (v.length > 0) cf[k] = v;
    if (Object.keys(cf).length) out.cf = cf;
  }
  if (state.q) out.q = state.q;
  if (state.sort) out.sort = state.sort;
  if (state.x) {
    const x: Record<string, string> = {};
    for (const [k, v] of Object.entries(state.x)) if (v && v !== "all") x[k] = v;
    if (Object.keys(x).length) out.x = x;
  }
  if (!Object.keys(out).length) return "";
  return b64encode(JSON.stringify(out));
}

export function decodeFilterState(raw: string | null): SerializedFilterState | null {
  if (!raw) return null;
  const j = b64decode(raw);
  if (!j) return null;
  try { return JSON.parse(j) as SerializedFilterState; } catch { return null; }
}

export function colFiltersToObj(cf: Record<string, Set<string>>): Record<string, string[]> {
  const o: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(cf)) if (v.size > 0) o[k] = [...v];
  return o;
}
export function objToColFilters(o: Record<string, string[]> | undefined): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) out[k] = new Set(v);
  return out;
}

/** Write `?<key>=...` to the current URL without triggering a navigation. */
export function writeFilterParam(encoded: string, key = "f") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (encoded) url.searchParams.set(key, encoded);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", url.toString());
}

export function readFilterParam(key = "f"): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(key);
}

/** Cycle asc -> desc -> off for a given column key. */
export function cycleSort(cur: SortState, col: string): SortState {
  if (!cur || cur.col !== col) return { col, dir: "asc" };
  if (cur.dir === "asc") return { col, dir: "desc" };
  return null;
}
