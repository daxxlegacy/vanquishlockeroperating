// Shared in-memory occupancy cache (per category) with localStorage warm
// cache and realtime patching. Makes switching between Full/Staff/Shoe tabs
// and re-visiting the Occupancy page instant.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OccCategory = "main" | "staff" | "shoe";

export type OccupancyRow = {
  id: string;
  category: OccCategory;
  locker_number: string;
  locker_row: string | null;
  locker_unit: string | null;
  locker_location_by_row: string | null;
  key_lock_type: string | null;
  badge_number: string | null;
  employee_name: string | null;
  national_id: string | null;
  work_location: string | null;
  contact: string | null;
  status: string | null;
  batch_intake_date: string | null;
  termination_date: string | null;
  gradeset: string | null;
  department: string | null;
  remarks: string | null;
  source_filename: string | null;
};

type State = { data: OccupancyRow[] | null; loading: boolean };

const states: Record<OccCategory, State> = {
  main: { data: null, loading: false },
  staff: { data: null, loading: false },
  shoe: { data: null, loading: false },
};
const subs: Record<OccCategory, Set<(s: State) => void>> = {
  main: new Set(), staff: new Set(), shoe: new Set(),
};
const fetchPromises: Partial<Record<OccCategory, Promise<void>>> = {};
let channel: ReturnType<typeof supabase.channel> | null = null;
let authListenerStarted = false;

const STORAGE_PREFIX = "lockerops.occupancy.cache.v1.";
const MAX_AGE_MS = 5 * 60 * 1000;

function emit(cat: OccCategory) {
  for (const fn of subs[cat]) fn(states[cat]);
}

// Never persist full national_id to browser storage.
function maskNidRow(r: OccupancyRow): OccupancyRow {
  const nid = r.national_id;
  if (!nid || /^\*+/.test(nid)) return r;
  const masked = nid.length <= 4 ? "*".repeat(nid.length) : "******" + nid.slice(-4);
  return { ...r, national_id: masked };
}

function writeStorage(cat: OccCategory, data: OccupancyRow[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + cat, JSON.stringify({ ts: Date.now(), data: data.map(maskNidRow) }));
  } catch { /* ignore quota */ }
}

function clearStorage(cat?: OccCategory) {
  if (typeof window === "undefined") return;
  try {
    if (cat) {
      localStorage.removeItem(STORAGE_PREFIX + cat);
      return;
    }
    for (const c of ["main", "staff", "shoe"] as OccCategory[]) {
      localStorage.removeItem(STORAGE_PREFIX + c);
    }
  } catch { /* ignore storage errors */ }
}

function readStorage(cat: OccCategory): OccupancyRow[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + cat);
    if (!raw) return null;
    const p = JSON.parse(raw) as { ts: number; data: OccupancyRow[] };
    if (!p || typeof p.ts !== "number" || !Array.isArray(p.data)) return null;
    if (Date.now() - p.ts > MAX_AGE_MS) return null;
    return p.data;
  } catch { return null; }
}

async function fetchCat(cat: OccCategory, silent = false): Promise<void> {
  if (fetchPromises[cat]) return fetchPromises[cat];
  if (!silent) { states[cat] = { ...states[cat], loading: true }; emit(cat); }
  fetchPromises[cat] = (async () => {
    try {
      const all: OccupancyRow[] = [];
      let from = 0;
      let failed = false;
      while (true) {
        // Query masked view so national_id is masked for non-authorised users.
        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, v: string) => {
                range: (a: number, b: number) => Promise<{ data: OccupancyRow[] | null; error: { message: string } | null }>;
              };
            };
          };
        })
          .from("locker_occupancy_masked")
          .select("*")
          .eq("category", cat)
          .range(from, from + 999);
        if (error || !data) {
          failed = true;
          if (error) console.error(`Failed to load ${cat} occupancy:`, error.message);
          break;
        }
        all.push(...(data as OccupancyRow[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      if (failed && all.length === 0) {
        states[cat] = { data: null, loading: false };
        emit(cat);
        return;
      }
      states[cat] = { data: all, loading: false };
      writeStorage(cat, all);
      emit(cat);
    } finally {
      delete fetchPromises[cat];
    }
  })();
  return fetchPromises[cat];
}

async function refetchAfterAuthReady() {
  const cats = ["main", "staff", "shoe"] as OccCategory[];
  await Promise.all(cats.map((cat) => fetchPromises[cat]?.catch(() => {})));
  await Promise.all(
    cats
      .filter((cat) => subs[cat].size > 0 || states[cat].data)
      .map((cat) => fetchCat(cat, true)),
  );
}

function startAuthRefresh() {
  if (authListenerStarted || typeof window === "undefined") return;
  authListenerStarted = true;

  supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user) void refetchAfterAuthReady();
  }).catch(() => {});

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      for (const cat of ["main", "staff", "shoe"] as OccCategory[]) {
        states[cat] = { data: null, loading: false };
        emit(cat);
      }
      clearStorage();
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

let pendingRefresh: Partial<Record<OccCategory, ReturnType<typeof setTimeout>>> = {};
function scheduleRefresh(cat: OccCategory) {
  if (pendingRefresh[cat]) clearTimeout(pendingRefresh[cat]);
  pendingRefresh[cat] = setTimeout(() => { fetchCat(cat, true); }, 800);
}

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel("occupancy-shared-cache")
    .on("postgres_changes", { event: "*", schema: "public", table: "locker_occupancy" }, (payload) => {
      const cat = ((payload.new as { category?: OccCategory })?.category
        ?? (payload.old as { category?: OccCategory })?.category) as OccCategory | undefined;
      if (cat && states[cat].data) scheduleRefresh(cat);
    })
    .subscribe();
}

export function invalidateOccupancyCache(cat?: OccCategory) {
  const cats: OccCategory[] = cat ? [cat] : ["main", "staff", "shoe"];
  for (const c of cats) {
    states[c] = { data: null, loading: false };
    emit(c);
    fetchCat(c);
  }
}

export function useOccupancy(cat: OccCategory) {
  const [s, set] = useState<State>(states[cat]);
  useEffect(() => {
    set(states[cat]);
    subs[cat].add(set);
    startAuthRefresh();
    ensureChannel();
    if (!states[cat].data && !states[cat].loading) {
      const warm = readStorage(cat);
      if (warm && warm.length > 0) {
        states[cat] = { data: warm, loading: false };
        emit(cat);
        fetchCat(cat, true);
      } else {
        fetchCat(cat);
      }
    }
    return () => { subs[cat].delete(set); };
  }, [cat]);
  return { rows: s.data, loading: s.loading, refresh: () => invalidateOccupancyCache(cat) };
}
