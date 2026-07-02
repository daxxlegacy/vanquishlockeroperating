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

type State = { data: Locker[] | null; loading: boolean };
let state: State = { data: null, loading: false };
let index: Map<string, number> = new Map();
const subscribers = new Set<(s: State) => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let fetchPromise: Promise<void> | null = null;
let realtimePaused = 0; // counter for nested pauses
let authListenerStarted = false;

const STORAGE_KEY = "lockerops.lockers.cache.v2";
const MAX_AGE_MS = 5 * 60 * 1000;

function rebuildIndex(data: Locker[]) {
  const m = new Map<string, number>();
  for (let i = 0; i < data.length; i++) m.set(data[i].id, i);
  index = m;
}

function emit() {
  for (const fn of subscribers) fn(state);
}

function writeToStorage(data: Locker[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ts: Date.now(), data }),
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

async function fetchAll(silent = false): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (!silent) {
    state = { ...state, loading: true };
    emit();
  }
  fetchPromise = (async () => {
    try {
      const all: Locker[] = [];
      let from = 0;
      let failed = false;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
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
        state = { data: null, loading: false };
        emit();
        return;
      }
      rebuildIndex(all);
      state = { data: all, loading: false };
      writeToStorage(all);
      emit();
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
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
      state = { data: null, loading: false };
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


export function invalidateLockersCache() {
  state = { data: null, loading: false };
  index = new Map();
  emit();
  fetchAll();
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
        state = { data: warm, loading: false };
        emit();
        // silent background refresh
        fetchAll(true);
      } else {
        fetchAll();
      }
    } else {
      set(state);
    }
    return () => { subscribers.delete(set); };
  }, []);
  return { lockers: s.data, loading: s.loading, refresh: invalidateLockersCache };
}
