// Shared in-memory lockers cache with realtime patching.
// Used by /lockers, /spare-keys, /duplicates so switching tabs is instant
// and a single realtime subscription keeps every page in sync.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

type State = { data: Locker[] | null; loading: boolean };
let state: State = { data: null, loading: false };
const subscribers = new Set<(s: State) => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let fetchPromise: Promise<void> | null = null;
let realtimePaused = 0; // counter for nested pauses

function emit() {
  for (const fn of subscribers) fn(state);
}

async function fetchAll() {
  if (fetchPromise) return fetchPromise;
  state = { ...state, loading: true };
  emit();
  fetchPromise = (async () => {
    try {
      const all: Locker[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("*")
          .is("deleted_at", null)
          .range(from, from + 999);
        if (error || !data) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      state = { data: all, loading: false };
      emit();
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
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
        if (!row.deleted_at) {
          state = { ...state, data: [...cur, row] };
          emit();
        }
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new as Locker;
        if (row.deleted_at) {
          state = { ...state, data: cur.filter((l) => l.id !== row.id) };
        } else {
          state = {
            ...state,
            data: cur.some((l) => l.id === row.id)
              ? cur.map((l) => (l.id === row.id ? row : l))
              : [...cur, row],
          };
        }
        emit();
      } else if (payload.eventType === "DELETE") {
        const row = payload.old as Locker;
        state = { ...state, data: cur.filter((l) => l.id !== row.id) };
        emit();
      }
    })
    .subscribe();
}

export function invalidateLockersCache() {
  state = { data: null, loading: false };
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
    ensureChannel();
    if (!state.data && !state.loading) fetchAll();
    else set(state);
    return () => { subscribers.delete(set); };
  }, []);
  return { lockers: s.data, loading: s.loading, refresh: invalidateLockersCache };
}
