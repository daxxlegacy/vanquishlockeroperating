// Lightweight in-memory event bus used by GlobalSearch to ask a target page
// to open a specific row's detail. The page subscribes on mount and
// receives events for its `kind`.
import { useEffect } from "react";

export type FocusKind = "locker" | "occupancy" | "ticket";
type Listener = (value: string) => void;

const listeners: Record<FocusKind, Set<Listener>> = {
  locker: new Set(),
  occupancy: new Set(),
  ticket: new Set(),
};

// Pending value delivered to the first subscriber that mounts (handles the
// case where GlobalSearch navigates to a page that hasn't mounted yet).
const pending: Partial<Record<FocusKind, string>> = {};

export function emitFocus(kind: FocusKind, value: string) {
  if (listeners[kind].size === 0) {
    pending[kind] = value;
    return;
  }
  for (const fn of listeners[kind]) fn(value);
}

export function useFocusListener(kind: FocusKind, fn: Listener) {
  useEffect(() => {
    listeners[kind].add(fn);
    const p = pending[kind];
    if (p !== undefined) {
      delete pending[kind];
      // Defer to next tick so route/component is fully mounted.
      setTimeout(() => fn(p), 0);
    }
    return () => {
      listeners[kind].delete(fn);
    };
  }, [kind, fn]);
}
