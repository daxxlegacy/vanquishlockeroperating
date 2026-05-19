// Stores the set of locker numbers whose batch intake failed to parse during
// the most recent upload. Used by the map and lockers table to surface a
// visual warning on the affected cells/rows.

const KEY = "lockerops.batch_intake_warnings";

export interface BatchIntakeWarningStore {
  lockerNumbers: string[];
  filename: string | null;
  at: string; // ISO timestamp
}

export function saveBatchIntakeWarnings(lockerNumbers: string[], filename: string | null) {
  if (typeof window === "undefined") return;
  try {
    const uniq = Array.from(new Set(lockerNumbers.map((n) => n.trim()).filter(Boolean)));
    const payload: BatchIntakeWarningStore = {
      lockerNumbers: uniq,
      filename,
      at: new Date().toISOString(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event("batch-intake-warnings-changed"));
  } catch {
    // ignore
  }
}

export function readBatchIntakeWarnings(): BatchIntakeWarningStore | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BatchIntakeWarningStore;
  } catch {
    return null;
  }
}

export function clearBatchIntakeWarnings() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("batch-intake-warnings-changed"));
  } catch {
    // ignore
  }
}

export function useBatchIntakeWarningSet(): {
  set: Set<string>;
  store: BatchIntakeWarningStore | null;
} {
  // Lazy-load React only on client component callers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  const [store, setStore] = React.useState<BatchIntakeWarningStore | null>(() => readBatchIntakeWarnings());
  React.useEffect(() => {
    const refresh = () => setStore(readBatchIntakeWarnings());
    window.addEventListener("batch-intake-warnings-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("batch-intake-warnings-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const set = React.useMemo(
    () => new Set((store?.lockerNumbers ?? []).map((n) => n.trim().toUpperCase())),
    [store],
  );
  return { set, store };
}
