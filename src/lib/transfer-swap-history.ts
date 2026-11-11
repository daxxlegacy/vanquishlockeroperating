// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Dedicated Transfer & Swap history log shown on the Reconcile page.
// Intentionally separate from `terminations` and `locker_occupancy` so that
// clearing this history never touches termination or occupancy data.
//
// REQUIREMENT: the manual, date-range scoped "Clear History" action below is the
// ONLY way rows are ever removed from `transfer_swap_history`. There must never
// be a scheduled job, cron entry, expiry trigger, or automatic cleanup touching
// this table. (Verified: the table carries only an `updated_at` trigger and the
// 10-second duplicate-insert guard — neither deletes rows.)
//
// History rows are written server-side inside the `transfer_locker()` and
// `swap_lockers()` database functions, so no frontend insert helper exists.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";




/* ------------------------------------------------------------------ *
 * In-memory cache + queries for the Transfer & Swap History panel.
 * Same pattern as lockers-cache.ts: a module-level store, subscriber
 * notification, patch/remove helpers for instant UI updates, and an
 * invalidate() background-refetch safety net.
 * ------------------------------------------------------------------ */

export type TransferSwapHistoryRow =
  Database["public"]["Tables"]["transfer_swap_history"]["Row"];

type HistoryState = {
  data: TransferSwapHistoryRow[] | null;
  loading: boolean;
};

let historyState: HistoryState = { data: null, loading: false };
const historySubscribers = new Set<(s: HistoryState) => void>();
let historyFetch: Promise<void> | null = null;

function emitHistory() {
  for (const fn of historySubscribers) fn(historyState);
}

function sortRows(rows: TransferSwapHistoryRow[]) {
  return [...rows].sort((a, b) => {
    if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1;
    return (a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1;
  });
}

/** Fetch the history list from the database (most recent first). */
export async function fetchTransferSwapHistory(): Promise<TransferSwapHistoryRow[]> {
  const { data, error } = await supabase
    .from("transfer_swap_history")
    .select("*")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) throw new Error(error.message);
  return (data ?? []) as TransferSwapHistoryRow[];
}

/** Load into the shared cache. `silent` keeps existing rows visible. */
export async function loadTransferSwapHistory(silent = false): Promise<void> {
  if (historyFetch) return historyFetch;
  historyState = { ...historyState, loading: !silent && !historyState.data };
  emitHistory();
  historyFetch = (async () => {
    try {
      const rows = await fetchTransferSwapHistory();
      historyState = { data: sortRows(rows), loading: false };
      emitHistory();
    } catch (e) {
      historyState = { ...historyState, loading: false };
      emitHistory();
      throw e;
    } finally {
      historyFetch = null;
    }
  })();
  return historyFetch;
}

/**
 * Instant-update helper: upsert rows into the cache and notify subscribers
 * so the panel re-renders without waiting for a refetch.
 */
export function patchTransferSwapHistoryInCache(rows: TransferSwapHistoryRow[]): void {
  if (!historyState.data || rows.length === 0) return;
  const next = [...historyState.data];
  for (const row of rows) {
    const i = next.findIndex((r) => r.id === row.id);
    if (i >= 0) next[i] = { ...next[i], ...row };
    else next.push(row);
  }
  historyState = { ...historyState, data: sortRows(next) };
  emitHistory();
}

/** Instant-update helper: drop rows from the cache by id. */
export function removeTransferSwapHistoryFromCache(ids: string[]): void {
  if (!historyState.data || ids.length === 0) return;
  const drop = new Set(ids);
  historyState = {
    ...historyState,
    data: historyState.data.filter((r) => !drop.has(r.id)),
  };
  emitHistory();
}

/** Background safety-net refresh. */
export function invalidateTransferSwapHistory(): void {
  void loadTransferSwapHistory(true).catch(() => {});
}

/** React binding for the shared cache. */
export function useTransferSwapHistory() {
  const [s, setS] = useState<HistoryState>(historyState);
  useEffect(() => {
    historySubscribers.add(setS);
    setS(historyState);
    if (!historyState.data && !historyFetch) {
      void loadTransferSwapHistory().catch((e: unknown) => {
        console.error("[transfer-swap-history] load failed:", e);
      });
    }
    return () => {
      historySubscribers.delete(setS);
    };
  }, []);
  return { items: s.data, loading: s.loading, reload: () => loadTransferSwapHistory(true) };
}

export interface ClearHistoryRangeResult {
  removedIds: string[];
  auditError: string | null;
}

/**
 * Delete every history entry whose `occurred_on` falls inside [from, to] and
 * write an audit row. Returns the deleted ids so the caller can patch the
 * cache immediately.
 */
export async function clearTransferSwapHistoryRange(
  from: string,
  to: string,
  performer: { id: string; email?: string | null },
): Promise<ClearHistoryRangeResult> {
  const { data: deleted, error } = await supabase
    .from("transfer_swap_history")
    .delete()
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .select("id");
  if (error) throw new Error(error.message);

  const removedIds = (deleted ?? []).map((r) => (r as { id: string }).id);

  const { error: logErr } = await supabase.from("transfer_swap_history_clears").insert({
    from_date: from,
    to_date: to,
    removed_count: removedIds.length,
    performed_by: performer.id,
    performed_by_email: performer.email ?? null,
  });

  return { removedIds, auditError: logErr?.message ?? null };
}

/** Delete a single history entry. */
export async function deleteTransferSwapHistoryEntry(id: string): Promise<void> {
  const { error } = await supabase.from("transfer_swap_history").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
