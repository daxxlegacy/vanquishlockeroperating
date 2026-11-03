// Full-dataset lockers cache.
//
// IMPORTANT: list views (Lockers, Spare Keys, Occupancy) no longer use this —
// they page through the database via lockers-page.ts / spare-keys-page.ts /
// occupancy-page.ts. This module remains for the screens that genuinely need
// to compare the WHOLE dataset (Reconcile, Bulk Status Update, Record Intake,
// Upload, dashboard counts, locker pickers). It is loaded on demand by those
// screens only, and no longer mirrored into localStorage.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { emitRowsChanged, emitTableChanged } from "@/lib/row-events";
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

type State = { data: Locker[] | null; loading: boolean; refreshing: boolean };
let state: State = { data: null, loading: false, refreshing: false };

let index: Map<string, number> = new Map();
const subscribers = new Set<(s: State) => void>();
const patchSubscribers = new Set<(rows: Locker[]) => void>();

export function subscribeLockerPatches(callback: (rows: Locker[]) => void) {
  patchSubscribers.add(callback);
  return () => { patchSubscribers.delete(callback); };
}
let channel: ReturnType<typeof supabase.channel> | null = null;
let fetchPromise: Promise<void> | null = null;
let realtimePaused = 0; // counter for nested pauses
let authListenerStarted = false;

// Skip silent background refetch when data was fetched this recently.
const FRESH_WINDOW_MS = 60 * 1000;
let lastFetchAt = 0;

function rebuildIndex(data: Locker[]) {
  const m = new Map<string, number>();
  for (let i = 0; i < data.length; i++) m.set(data[i].id, i);
  index = m;
}

function emit() {
  for (const fn of subscribers) fn(state);
}

async function fetchAll(silent = false): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (silent) {
    state = { ...state, refreshing: true };
  } else {
    state = { ...state, loading: true, refreshing: true };
  }
  emit();
  fetchPromise = (async () => {
    try {
      const all: Locker[] = [];
      let from = 0;
      let failed = false;
      while (true) {
        // Query the masked view so national_id never arrives full for
        // non-authorised users. Cast because the view isn't in generated types.
        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              is: (col: string, v: null) => {
                range: (a: number, b: number) => Promise<{ data: Locker[] | null; error: { message: string } | null }>;
              };
            };
          };
        })
          .from("lockers_masked")
          .select("*")
          .is("deleted_at", null)
          .range(from, from + 999);
        if (error || !data) {
          failed = true;
          if (error) console.error("Failed to load lockers:", error.message);
          break;
        }
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      if (failed && all.length === 0) {
        state = { data: null, loading: false, refreshing: false };
        emit();
        return;
      }
      rebuildIndex(all);
      state = { data: all, loading: false, refreshing: false };
      lastFetchAt = Date.now();
      emit();
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

function isFresh() {
  return lastFetchAt > 0 && Date.now() - lastFetchAt < FRESH_WINDOW_MS;
}

/** Kick off cache warm-up without mounting a component. Safe to call multiple
 *  times — dedupes against in-flight fetches. Only call this from screens that
 *  genuinely need the entire dataset. */
export function prefetchLockers() {
  if (typeof window === "undefined") return;
  startAuthRefresh();
  ensureChannel();
  if (state.data || state.loading || fetchPromise) return;
  fetchAll(true);
}

async function refetchAfterAuthReady() {
  if (fetchPromise) {
    await fetchPromise.catch(() => {});
  }
  await fetchAll(true);
}

function startAuthRefresh() {
  if (authListenerStarted || typeof window === "undefined") return;
  authListenerStarted = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      state = { data: null, loading: false, refreshing: false };
      index = new Map();
      emit();
      return;
    }

    if (
      session?.user
      && state.data
      && (event === "SIGNED_IN" || event === "USER_UPDATED")
    ) {
      void refetchAfterAuthReady();
    }
  });
}

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel("lockers-shared-cache")
    .on("postgres_changes", { event: "*", schema: "public", table: "lockers" }, (payload) => {
      if (realtimePaused > 0) return;
      const cur = state.data;
      if (!cur) return;
      if (payload.eventType === "INSERT") {
        const row = payload.new as Locker;
        if (!row.deleted_at && !index.has(row.id)) {
          const next = [...cur, row];
          index.set(row.id, next.length - 1);
          state = { ...state, data: next };
          emit();
        }
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new as Locker;
        if (row.deleted_at) {
          const next = cur.filter((l) => l.id !== row.id);
          rebuildIndex(next);
          state = { ...state, data: next };
        } else {
          const i = index.get(row.id);
          if (i != null && cur[i]?.id === row.id) {
            // O(1) hot-swap in place
            const next = cur.slice();
            next[i] = row;
            state = { ...state, data: next };
          } else {
            const next = [...cur, row];
            index.set(row.id, next.length - 1);
            state = { ...state, data: next };
          }
        }
        emit();
      } else if (payload.eventType === "DELETE") {
        const row = payload.old as Locker;
        const next = cur.filter((l) => l.id !== row.id);
        rebuildIndex(next);
        state = { ...state, data: next };
        emit();
      }
    })
    .subscribe();
}

/** Optimistically patch one or more locker rows into the in-memory cache
 *  without refetching, and tell paginated list views to refresh those rows. */
export function patchLockersInCache(rows: Locker[]) {
  if (rows.length === 0) return;
  const cur = state.data;
  if (cur) {
    const next = cur.slice();
    for (const row of rows) {
      const i = index.get(row.id);
      if (row.deleted_at) {
        if (i != null) next.splice(i, 1);
      } else if (i != null && next[i]?.id === row.id) {
        next[i] = { ...next[i], ...row };
      } else {
        next.push(row);
      }
    }
    next.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
    rebuildIndex(next);
    state = { ...state, data: next };
    emit();
  }
  for (const callback of patchSubscribers) callback(rows);
  emitRowsChanged("lockers", rows.map((r) => r.id));
}

/** Optimistically remove a locker row from the in-memory cache (used after
 *  a soft delete) so the row disappears from the UI immediately. */
export function removeLockerFromCache(id: string) {
  const cur = state.data;
  if (cur) {
    const next = cur.filter((l) => l.id !== id);
    if (next.length !== cur.length) {
      rebuildIndex(next);
      state = { ...state, data: next };
      emit();
    }
  }
  emitRowsChanged("lockers", [id]);
}

export function getLockerById(id: string): Locker | null {
  const data = state.data;
  if (!data) return null;
  const i = index.get(id);
  if (i == null) return null;
  const row = data[i];
  return row && row.id === id ? row : null;
}

/** Synchronous snapshot of lockers in memory (null if not loaded yet). */
export function getLockersSnapshot(): Locker[] | null {
  return state.data;
}

/** Lightweight hook that only tracks whether a background refresh is in
 *  flight. Cheap for header/status indicators — does not subscribe to data. */
export function useLockersRefreshing() {
  const [r, set] = useState(state.refreshing);
  useEffect(() => {
    const fn = (s: State) => set(s.refreshing);
    subscribers.add(fn);
    set(state.refreshing);
    return () => { subscribers.delete(fn); };
  }, []);
  return r;
}

export function invalidateLockersCache() {
  // Silent refresh for the full-dataset consumers, plus a nudge to paginated
  // list views so they re-read the current page.
  lastFetchAt = 0;
  if (state.data) fetchAll(true);
  emitTableChanged("lockers");
}

/** Pause realtime patches (e.g. during a bulk import) so the table doesn't
 *  re-render hundreds of times. Returns a resume() that does a single refetch. */
export function pauseLockersRealtime() {
  realtimePaused++;
  return () => {
    realtimePaused = Math.max(0, realtimePaused - 1);
    if (realtimePaused === 0) invalidateLockersCache();
  };
}

export function useLockers() {
  const [s, set] = useState<State>(state);
  useEffect(() => {
    subscribers.add(set);
    startAuthRefresh();
    ensureChannel();
    if (!state.data && !state.loading) {
      fetchAll();
    } else if (!isFresh() && state.data && !fetchPromise) {
      fetchAll(true);
      set(state);
    } else {
      set(state);
    }
    return () => { subscribers.delete(set); };
  }, []);
  return { lockers: s.data, loading: s.loading, refreshing: s.refreshing, refresh: invalidateLockersCache };
}
