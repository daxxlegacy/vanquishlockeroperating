// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Server-side paginated access to the Spare Keys listing.
// Numeric / numerical (combination) locks have no spare key and are excluded
// inside the database function, together with the four status counts and the
// location list, so the browser never scans the full table.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeRowsChanged } from "@/lib/row-events";
import type { Locker } from "@/lib/lockers-page";

export const SPARE_PAGE_SIZE = 100;

export type SpareKeysQuery = {
  page: number;
  search: string;
  spareFilter: string;
  locFilter: string;
};

export type SpareKeysPageResult = {
  rows: Locker[];
  total: number;
  eligibleTotal: number;
  counts: Record<string, number>;
  locations: string[];
};

function args(q: SpareKeysQuery, limit: number, offset: number) {
  return {
    _search: q.search.trim(),
    _spare: q.spareFilter,
    _location: q.locFilter,
    _limit: limit,
    _offset: offset,
  };
}

function parse(data: unknown): SpareKeysPageResult {
  const r = (data ?? {}) as {
    rows?: Locker[]; total?: number; eligible_total?: number;
    counts?: Record<string, number>; locations?: string[];
  };
  return {
    rows: r.rows ?? [],
    total: r.total ?? 0,
    eligibleTotal: r.eligible_total ?? 0,
    counts: r.counts ?? {},
    locations: r.locations ?? [],
  };
}

export async function fetchSpareKeysPage(q: SpareKeysQuery, pageSize = SPARE_PAGE_SIZE): Promise<SpareKeysPageResult> {
  const offset = Math.max(0, (q.page - 1) * pageSize);
  const { data, error } = await supabase.rpc("search_spare_keys", args(q, pageSize, offset));
  if (error) throw new Error(error.message);
  return parse(data);
}

/** Stream all matching spare-key rows in chunks, for the Excel export. */
export async function fetchAllMatchingSpareKeys(q: SpareKeysQuery): Promise<Locker[]> {
  const CHUNK = 1000;
  const out: Locker[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += CHUNK) {
    const { data, error } = await supabase.rpc("search_spare_keys", args(q, CHUNK, offset));
    if (error) throw new Error(error.message);
    const res = parse(data);
    total = res.total;
    out.push(...res.rows);
    if (res.rows.length < CHUNK) break;
  }
  return out;
}

export function useSpareKeysPage(q: SpareKeysQuery, pageSize = SPARE_PAGE_SIZE) {
  const key = JSON.stringify({ ...q, pageSize });
  const [result, setResult] = useState<SpareKeysPageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const rowsRef = useRef<Locker[]>([]);
  rowsRef.current = result?.rows ?? [];

  const load = useCallback(async (showSpinner: boolean) => {
    const id = ++reqId.current;
    if (showSpinner) setLoading(true);
    try {
      const res = await fetchSpareKeysPage(q, pageSize);
      if (id !== reqId.current) return;
      setResult(res);
      setError(null);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load spare keys");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSize]);

  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  useEffect(() => {
    const channel = supabase
      .channel(`spare-keys-page-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lockers" }, (payload) => {
        const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
        if (id && rowsRef.current.some((r) => r.id === id)) void load(false);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => subscribeRowsChanged((table, ids) => {
    if (table !== "lockers") return;
    if (ids.includes("*") || ids.some((id) => rowsRef.current.some((r) => r.id === id))) void load(false);
  }), [load]);

  return {
    rows: result?.rows ?? null,
    total: result?.total ?? 0,
    eligibleTotal: result?.eligibleTotal ?? 0,
    counts: result?.counts ?? {},
    locations: result?.locations ?? [],
    loading: loading && !result,
    refreshing: loading,
    error,
    refresh: () => load(false),
  };
}
