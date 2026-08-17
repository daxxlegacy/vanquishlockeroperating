// Shared in-memory lockers cache with realtime patching.
// Used by /lockers, /spare-keys, /duplicates so switching tabs is instant
// and a single realtime subscription keeps every page in sync.
//
// Improvements:
// - localStorage warm-cache (stale-while-revalidate, 5 min max age)
// - O(1) id->index Map for realtime patches
// - getLockerById() lookup without Supabase round-trip
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

type State = {
  data: Locker[] | null;
  loading: boolean;
  refreshing: boolean;
  /** Set when the most recent fetch could not be confirmed complete. */
  incomplete: { loaded: number; expected: number | null } | null;
};
let state: State = { data: null, loading: false, refreshing: false, incomplete: null };


let index: Map<string, number> = new Map();
const subscribers = new Set<(s: State) => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let fetchPromise: Promise<void> | null = null;
let realtimePaused = 0; // counter for nested pauses
let authListenerStarted = false;

const STORAGE_KEY = "lockerops.lockers.cache.v2";
// Warm cache validity — realtime keeps memory in sync, so we can safely
// trust localStorage for much longer than the original 5 minutes.
const MAX_AGE_MS = 30 * 60 * 1000;
// Skip silent background refetch when data was fetched this recently.
// Realtime patches keep it live; this avoids redundant network calls
// every time a route/tab remounts.
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

// Never persist full national_id to browser storage; keep only a masked form.
function maskForStorage(row: Locker): Locker {
  const nid = row.national_id;
  if (!nid || /^\*+/.test(nid)) return row;
  const masked = nid.length <= 4 ? "*".repeat(nid.length) : "******" + nid.slice(-4);
  return { ...row, national_id: masked };
}

function writeToStorage(data: Locker[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ts: Date.now(), data: data.map(maskForStorage) }),
    );
  } catch {
    // quota / serialization errors — ignore
  }
}

function clearStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function readFromStorage(): Locker[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: Locker[] };
    if (!parsed || typeof parsed.ts !== "number" || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

type MaskedClient = {
  from: (t: string) => {
    select: (c: string, o?: { count?: "exact"; head?: boolean }) => {
      is: (col: string, v: null) => {
        range: (a: number, b: number) => Promise<{ data: Locker[] | null; error: { message: string } | null; count: number | null }>;
      } & Promise<{ data: Locker[] | null; error: { message: string } | null; count: number | null }>;
    };
  };
};

const masked = () => supabase as unknown as MaskedClient;

/** Exact number of non-deleted lockers, or null when the count query fails. */
async function fetchExpectedCount(): Promise<number | null> {
  try {
    const { count, error } = await masked()
      .from("lockers_masked")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);
    if (error) return null;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

/** One full pagination pass. Returns rows plus whether every page succeeded. */
async function fetchOnce(): Promise<{ rows: Locker[]; ok: boolean }> {
  const all: Locker[] = [];
  let from = 0;
  while (true) {
    // Query the masked view so national_id never arrives full for
    // non-authorised users. Cast because the view isn't in generated types.
    const { data, error } = await masked()
      .from("lockers_masked")
      .select("*")
      .is("deleted_at", null)
      .range(from, from + 999);
    if (error || !data) {
      if (error) console.error("Failed to load lockers:", error.message);
      return { rows: all, ok: false };
    }
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return { rows: all, ok: true };
}

const MAX_ATTEMPTS = 3;

async function fetchAll(silent = false): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (silent) {
    state = { ...state, refreshing: true };
  } else {
    state = { ...state, loading: true, refreshing: true };
  }
  emit();
  const timerLabel = import.meta.env.DEV
    ? `[perf] lockers-cache fetchAll${silent ? " (silent)" : ""}`
    : null;
  if (timerLabel) console.time(timerLabel);
  fetchPromise = (async () => {
    try {
      const expected = await fetchExpectedCount();
      let last: { rows: Locker[]; ok: boolean } = { rows: [], ok: false };

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        last = await fetchOnce();
        const complete = last.ok && (expected == null || last.rows.length === expected);
        if (complete) {
          rebuildIndex(last.rows);
          state = { data: last.rows, loading: false, refreshing: false, incomplete: null };
          lastFetchAt = Date.now();
          writeToStorage(last.rows);
          emit();
          return;
        }
        console.warn(
          `[lockers-cache] incomplete fetch (attempt ${attempt}/${MAX_ATTEMPTS}): got ${last.rows.length}${
            expected == null ? "" : ` of ${expected}`
          }`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }

      // Still incomplete after retries — never persist or promote a partial
      // dataset. Keep the last known good data visible and flag the failure.
      const incomplete = { loaded: last.rows.length, expected };
      if (state.data && state.data.length > 0) {
        state = { ...state, loading: false, refreshing: false, incomplete };
      } else if (last.rows.length > 0) {
        // Nothing better to show — surface the partial data but mark it as such
        // and do NOT write it to localStorage.
        rebuildIndex(last.rows);
        state = { data: last.rows, loading: false, refreshing: false, incomplete };
      } else {
        state = { data: null, loading: false, refreshing: false, incomplete };
      }
      emit();
    } finally {
      fetchPromise = null;
      if (timerLabel) console.timeEnd(timerLabel);
    }
  })();
  return fetchPromise;
}



function isFresh() {
  return lastFetchAt > 0 && Date.now() - lastFetchAt < FRESH_WINDOW_MS;
}

/** Kick off cache warm-up without mounting a component. Safe to call
 *  multiple times — dedupes against in-flight fetches. Reads warm cache
 *  from localStorage first, then triggers a silent background refresh. */
export function prefetchLockers() {
  if (typeof window === "undefined") return;
  startAuthRefresh();
  ensureChannel();
  if (state.data || state.loading || fetchPromise) return;
  const warm = readFromStorage();
  if (warm && warm.length > 0) {
    rebuildIndex(warm);
    state = { data: warm, loading: false, refreshing: false };

    emit();
    if (!isFresh()) fetchAll(true);
  } else {
    fetchAll(true);
  }
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

  supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user) void refetchAfterAuthReady();
  }).catch(() => {});

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      state = { data: null, loading: false, refreshing: false };
      index = new Map();
      clearStorage();
      emit();
      return;
    }

    if (
      session?.user
      && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
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
          writeToStorage(next);
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
        writeToStorage(state.data!);
        emit();
      } else if (payload.eventType === "DELETE") {
        const row = payload.old as Locker;
        const next = cur.filter((l) => l.id !== row.id);
        rebuildIndex(next);
        state = { ...state, data: next };
        writeToStorage(next);
        emit();
      }
    })
    .subscribe();
}

/** Optimistically patch one or more locker rows into the in-memory cache
 *  without refetching. Emits to subscribers so the UI updates instantly. */
export function patchLockersInCache(rows: Locker[]) {
  const cur = state.data;
  if (!cur || rows.length === 0) return;
  const next = cur.slice();
  for (const row of rows) {
    const i = index.get(row.id);
    if (row.deleted_at) {
      if (i != null) {
        next.splice(i, 1);
      }
    } else if (i != null && next[i]?.id === row.id) {
      next[i] = { ...next[i], ...row };
    } else {
      next.push(row);
    }
  }
  rebuildIndex(next);
  state = { ...state, data: next };
  writeToStorage(next);
  emit();
}

/** Optimistically remove a locker row from the in-memory cache (used after
 *  a soft delete) so the row disappears from the UI immediately. */
export function removeLockerFromCache(id: string) {
  const cur = state.data;
  if (!cur) return;
  const next = cur.filter((l) => l.id !== id);
  if (next.length === cur.length) return;
  rebuildIndex(next);
  state = { ...state, data: next };
  writeToStorage(next);
  emit();
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
  // Silent refresh: keep existing data visible, refetch in background.
  // Avoids the full loading skeleton flicker that made refreshes feel slow.
  lastFetchAt = 0;
  if (state.data) {
    fetchAll(true);
  } else {
    fetchAll();
  }
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
      const warm = readFromStorage();
      if (warm && warm.length > 0) {
        rebuildIndex(warm);
        state = { data: warm, loading: false, refreshing: false };
        emit();
        // silent background refresh (skip if fetched very recently — realtime keeps it live)
        if (!isFresh()) fetchAll(true);
      } else {
        fetchAll();
      }
    } else {
      set(state);
    }
    return () => { subscribers.delete(set); };
  }, []);
  return { lockers: s.data, loading: s.loading, refreshing: s.refreshing, refresh: invalidateLockersCache };

}
