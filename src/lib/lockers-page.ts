// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Server-side paginated access to the lockers table.
//
// Only the current page (100 rows by default) is ever fetched and held in
// state — searching, filtering, sorting and counting all happen in Postgres
// through the search_lockers() function. This replaces the old
// "load all 12k rows into the browser" approach in lockers-cache.ts for the
// LIST views; single-row flows (LockerDetail, Terminate, Swap, Transfer) are
// unchanged and notify list views through row-events.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeRowsChanged } from "@/lib/row-events";
import { subscribeLockerPatches } from "@/lib/lockers-cache";
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

export type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const PAGE_SIZE = 100;

export type LockersQuery = {
  page: number;
  search: string;
  statusFilter: string;
  locFilter: string;
  keyLockFilter: string;
  missingNid: boolean;
  missingBadge: boolean;
  statusIn?: string[];
  locationIn?: string[];
  sortCol: string;
  sortDir: "asc" | "desc";
};

export type LockersPageResult = {
  rows: Locker[];
  total: number;
  missingNid: number;
  missingBadge: number;
};

type RawResult = {
  rows?: Locker[];
  total?: number;
  missing_nid?: number;
  missing_badge?: number;
};

function rpcArgs(q: LockersQuery, limit: number, offset: number) {
  return {
    _search: q.search.trim(),
    _status: q.statusFilter,
    _location: q.locFilter,
    _key_lock: q.keyLockFilter,
    _missing_nid: q.missingNid,
    _missing_badge: q.missingBadge,
    _status_in: q.statusIn && q.statusIn.length > 0 ? q.statusIn : undefined,
    _location_in: q.locationIn && q.locationIn.length > 0 ? q.locationIn : undefined,
    _sort_col: q.sortCol,
    _sort_dir: q.sortDir,
    _limit: limit,
    _offset: offset,
  };
}

export async function fetchLockersPage(q: LockersQuery, pageSize = PAGE_SIZE): Promise<LockersPageResult> {
  const offset = Math.max(0, (q.page - 1) * pageSize);
  const { data, error } = await supabase.rpc("search_lockers", rpcArgs(q, pageSize, offset));
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as RawResult;
  return {
    rows: r.rows ?? [],
    total: r.total ?? 0,
    missingNid: r.missing_nid ?? 0,
    missingBadge: r.missing_badge ?? 0,
  };
}

/** Stream every row matching the current filters, in chunks, for exports.
 *  Rows are returned but never cached — the caller discards them after writing
 *  the file. */
export async function fetchAllMatchingLockers(
  q: LockersQuery,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Locker[]> {
  const CHUNK = 1000;
  const out: Locker[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += CHUNK) {
    const { data, error } = await supabase.rpc("search_lockers", rpcArgs(q, CHUNK, offset));
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as RawResult;
    total = r.total ?? 0;
    out.push(...(r.rows ?? []));
    onProgress?.(out.length, total);
    if ((r.rows ?? []).length < CHUNK) break;
  }
  return out;
}

// ---------------------------------------------------------------- facets
export type LockerFacets = {
  locations: string[];
  keyLocks: string[];
  customStatuses: string[];
  total: number;
};

const EMPTY_FACETS: LockerFacets = { locations: [], keyLocks: [], customStatuses: [], total: 0 };
const FACET_TTL_MS = 5 * 60 * 1000;
let facetCache: { at: number; value: LockerFacets } | null = null;
let facetPromise: Promise<LockerFacets> | null = null;
const facetSubs = new Set<(f: LockerFacets) => void>();

export async function fetchLockerFacets(force = false): Promise<LockerFacets> {
  if (!force && facetCache && Date.now() - facetCache.at < FACET_TTL_MS) return facetCache.value;
  if (facetPromise) return facetPromise;
  facetPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc("locker_facets");
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as {
        locations?: string[]; key_locks?: string[]; custom_statuses?: string[]; total?: number;
      };
      const value: LockerFacets = {
        locations: d.locations ?? [],
        keyLocks: d.key_locks ?? [],
        customStatuses: d.custom_statuses ?? [],
        total: d.total ?? 0,
      };
      facetCache = { at: Date.now(), value };
      for (const fn of facetSubs) fn(value);
      return value;
    } catch {
      return facetCache?.value ?? EMPTY_FACETS;
    } finally {
      facetPromise = null;
    }
  })();
  return facetPromise;
}

export function useLockerFacets(): LockerFacets {
  const [facets, setFacets] = useState<LockerFacets>(facetCache?.value ?? EMPTY_FACETS);
  useEffect(() => {
    facetSubs.add(setFacets);
    void fetchLockerFacets().then(setFacets);
    return () => { facetSubs.delete(setFacets); };
  }, []);
  return facets;
}

/** Force the next facet read to hit the database (after add/delete flows). */
export function invalidateLockerFacets() {
  facetCache = null;
  void fetchLockerFacets(true);
}

// ------------------------------------------------------- last page warm cache
const LAST_PAGE_KEY = "lockerops.lockers.lastpage.v1";

function maskNid(row: Locker): Locker {
  const nid = row.national_id;
  if (!nid || /^\*+/.test(nid)) return row;
  const masked = nid.length <= 4 ? "*".repeat(nid.length) : "******" + nid.slice(-4);
  return { ...row, national_id: masked };
}

function writeLastPage(key: string, result: LockersPageResult) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({
      key, at: Date.now(), result: { ...result, rows: result.rows.map(maskNid) },
    }));
  } catch { /* quota — ignore */ }
}

function readLastPage(key: string): LockersPageResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_PAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { key: string; at: number; result: LockersPageResult };
    if (p.key !== key || Date.now() - p.at > 10 * 60 * 1000) return null;
    return p.result;
  } catch { return null; }
}

// ---------------------------------------------------------------- page hook
export function useLockersPage(q: LockersQuery, pageSize = PAGE_SIZE) {
  const key = JSON.stringify({ ...q, pageSize });
  const [result, setResult] = useState<LockersPageResult | null>(() => readLastPage(key));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const reqId = useRef(0);
  const rowsRef = useRef<Locker[]>([]);
  rowsRef.current = result?.rows ?? [];

  const load = useCallback(async (showSpinner: boolean) => {
    const id = ++reqId.current;
    if (showSpinner) setLoading(true);
    try {
      const res = await fetchLockersPage(q, pageSize);
      if (id !== reqId.current) return;
      setResult(res);
      setError(null);
      setStale(false);
      writeLastPage(key, res);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load lockers");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSize]);

  useEffect(() => {
    const warm = readLastPage(key);
    if (warm) setResult(warm);
    void load(!warm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Realtime: only refresh when a change touches a row on this page; otherwise
  // surface a lightweight "updates available" flag.
  useEffect(() => {
    const channel = supabase
      .channel(`lockers-page-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lockers" }, (payload) => {
        const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
        if (id && rowsRef.current.some((r) => r.id === id)) void load(false);
        else setStale(true);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Local single-row mutations (dialogs) refresh the current page immediately.
  useEffect(() => subscribeLockerPatches((patched) => {
    // Only the first natural-sort page has a known lower bound. Other pages and
    // custom sorts are reconciled by the normal server refresh, not appended.
    if (q.page !== 1 || q.sortCol !== "num") return;
    setResult((current) => {
      if (!current) return current;
      const search = q.search.trim().toLowerCase();
      const matches = patched.filter((r) => !r.deleted_at
        && (q.statusFilter === "all" || r.status === q.statusFilter)
        && (q.locFilter === "all" || r.location === q.locFilter)
        && (q.keyLockFilter === "all" || r.key_lock === q.keyLockFilter)
        && (!q.statusIn?.length || q.statusIn.includes(r.status))
        && (!q.locationIn?.length || q.locationIn.includes(r.location))
        && (!q.missingNid || !r.national_id?.trim())
        && (!q.missingBadge || !r.badge_number?.trim())
        && (!search || [r.locker_number, r.employee_name, r.badge_number, r.key_lock, r.location].some(v => v?.toLowerCase().includes(search))));
      const byId = new Map(current.rows.map(r => [r.id, r]));
      for (const row of matches) byId.set(row.id, row);
      const rows = [...byId.values()].sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number) * (q.sortDir === "desc" ? -1 : 1)).slice(0, pageSize);
      return { ...current, rows };
    });
  }), [key, pageSize]);

  useEffect(() => subscribeRowsChanged((table, ids) => {
    if (table !== "lockers") return;
    if (ids.includes("*") || ids.some((id) => rowsRef.current.some((r) => r.id === id))) void load(false);
  }), [load]);

  return {
    rows: result?.rows ?? null,
    total: result?.total ?? 0,
    missingNid: result?.missingNid ?? 0,
    missingBadge: result?.missingBadge ?? 0,
    loading: loading && !result,
    refreshing: loading,
    error,
    stale,
    refresh: () => load(false),
  };
}
