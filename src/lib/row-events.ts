// Tiny cross-module event bus so paginated list views can react to single-row
// mutations performed by dialogs (Save, Terminate, Swap, Transfer, Delete…)
// without holding the whole table in memory.
export type RowEventTable = "lockers" | "locker_occupancy";

type Listener = (table: RowEventTable, ids: string[]) => void;

const listeners = new Set<Listener>();

/** Notify list views that specific rows changed (or were removed). */
export function emitRowsChanged(table: RowEventTable, ids: string[]) {
  if (ids.length === 0) return;
  for (const fn of listeners) {
    try { fn(table, ids); } catch { /* listener errors must not break callers */ }
  }
}

/** Notify list views that an unknown/large set of rows changed. */
export function emitTableChanged(table: RowEventTable) {
  for (const fn of listeners) {
    try { fn(table, ["*"]); } catch { /* ignore */ }
  }
}

export function subscribeRowsChanged(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
