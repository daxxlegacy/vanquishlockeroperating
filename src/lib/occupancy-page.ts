// Server-side paginated access to the combined occupancy view.
//
// The database function search_occupancy() unions locker_occupancy with any
// lockers that have no occupancy record (the "synthetic" rows the page used to
// build client-side), groups by locker number (1 active + 1 most recent
// termination) and returns one page of locker groups at a time.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeRowsChanged } from "@/lib/row-events";
import type { OccCategory, OccupancyRow } from "@/lib/occupancy-cache";

export const OCC_PAGE_SIZE = 100;

export type OccPageRow = Omit<OccupancyRow, "id" | "category"> & {
  id: string;
  category: OccCategory;
  __synthetic?: boolean;
};

export type OccupancyQuery = {
  page: number;
  search: string;
  statusFilter: string;
  reasonFilter?: string;
  categoryFilter: "all" | OccCategory;
  locFilter: string;
  sortCol: string;
  sortDir: "asc" | "desc";
};

export type OccupancyStats = {
  total: number;
  unique_lockers: number;
  active: number;
  terminated: number;
};

export type OccupancyPageResult = {
  rows: OccPageRow[];
  total: number;
  stats: OccupancyStats;
};

const EMPTY_STATS: OccupancyStats = { total: 0, unique_lockers: 0, active: 0, terminated: 0 };

function args(q: OccupancyQuery, limit: number, offset: number) {
  return {
    _search: q.search.trim(),
    _status: q.statusFilter,
    _reason: q.reasonFilter ?? "all",
    _category: q.categoryFilter,
    _location: q.locFilter,
    _sort_col: q.sortCol,
    _sort_dir: q.sortDir,
    _limit: limit,
    _offset: offset,
  };
}

export async function fetchOccupancyPage(q: OccupancyQuery, pageSize = OCC_PAGE_SIZE): Promise<OccupancyPageResult> {
  const offset = Math.max(0, (q.page - 1) * pageSize);
  const { data, error } = await supabase.rpc("search_occupancy", args(q, pageSize, offset));
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { rows?: OccPageRow[]; total?: number; stats?: OccupancyStats };
  return { rows: r.rows ?? [], total: r.total ?? 0, stats: r.stats ?? EMPTY_STATS };
}

/** Stream all matching occupancy rows in chunks, for exports only. */
export async function fetchAllMatchingOccupancy(q: OccupancyQuery): Promise<OccPageRow[]> {
  const CHUNK = 500; // locker groups per chunk
  const out: OccPageRow[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += CHUNK) {
    const { data, error } = await supabase.rpc("search_occupancy", args(q, CHUNK, offset));
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { rows?: OccPageRow[]; total?: number };
    total = r.total ?? 0;
    out.push(...(r.rows ?? []));
    if ((r.rows ?? []).length === 0) break;
  }
  return out;
}

// ---------------------------------------------------------------- facets
let locCache: { at: number; value: string[] } | null = null;

export async function fetchOccupancyLocations(force = false): Promise<string[]> {
  if (!force && locCache && Date.now() - locCache.at < 5 * 60 * 1000) return locCache.value;
  const { data, error } = await supabase.rpc("occupancy_facets");
  if (error) return locCache?.value ?? [];
  const d = (data ?? {}) as { locations?: string[] };
  locCache = { at: Date.now(), value: d.locations ?? [] };
  return locCache.value;
}

export function useOccupancyLocations(): string[] {
  const [locations, setLocations] = useState<string[]>(locCache?.value ?? []);
  useEffect(() => { void fetchOccupancyLocations().then(setLocations); }, []);
  return locations;
}

// ---------------------------------------------------------------- page hook
export function useOccupancyPage(q: OccupancyQuery, pageSize = OCC_PAGE_SIZE) {
  const key = JSON.stringify({ ...q, pageSize });
  const [result, setResult] = useState<OccupancyPageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const reqId = useRef(0);
  const rowsRef = useRef<OccPageRow[]>([]);
  rowsRef.current = result?.rows ?? [];

  const load = useCallback(async (showSpinner: boolean) => {
    const id = ++reqId.current;
    if (showSpinner) setLoading(true);
    try {
      const res = await fetchOccupancyPage(q, pageSize);
      if (id !== reqId.current) return;
      setResult(res);
      setError(null);
      setStale(false);
    } catch (e) {
      if (id !== reqId.current) return;
      // Never leave the previous (unfiltered) page on screen after a failed
      // query — that looks like search/filters silently doing nothing.
      setResult(null);
      setError(e instanceof Error ? e.message : "Failed to load occupancy");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSize]);


  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  useEffect(() => {
    const channel = supabase
      .channel(`occupancy-page-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "locker_occupancy" }, (payload) => {
        const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
        const num = (payload.new as { locker_number?: string })?.locker_number
          ?? (payload.old as { locker_number?: string })?.locker_number;
        const onPage = rowsRef.current.some((r) => r.id === id || (num && r.locker_number === num));
        if (onPage) void load(false);
        else setStale(true);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => subscribeRowsChanged((table, ids) => {
    if (table !== "locker_occupancy" && table !== "lockers") return;
    if (ids.includes("*") || ids.some((id) => rowsRef.current.some((r) => r.id === id))) void load(false);
  }), [load]);

  return {
    rows: result?.rows ?? null,
    total: result?.total ?? 0,
    stats: result?.stats ?? EMPTY_STATS,
    loading: loading && !result,
    refreshing: loading,
    error,
    stale,
    refresh: () => load(false),
  };
}
