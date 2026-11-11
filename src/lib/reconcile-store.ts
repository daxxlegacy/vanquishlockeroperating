// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// IndexedDB-backed persistence for the Reconcile page.
//
// Why not localStorage: a reconciled HR roster easily exceeds the ~5 MB
// localStorage quota. setItem then throws QuotaExceededError, the catch
// silently swallows it, and the next visit appears to have "no data" —
// forcing the user to re-upload after every navigation. IndexedDB has
// hundreds of MB available and stores structured data without JSON.stringify.

const DB_NAME = "lockerops";
const STORE = "reconcile";
const KEY = "state";

export const RECONCILE_META_KEY = "reconcile:meta";

export interface ReconcileMeta {
  filename: string | null;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveReconcileState<T>(value: T, meta: ReconcileMeta): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  try { localStorage.setItem(RECONCILE_META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
}

export async function loadReconcileState<T>(): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

export async function clearReconcileState(): Promise<void> {
  try { localStorage.removeItem(RECONCILE_META_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem("reconcile:state"); } catch { /* ignore */ } // legacy key
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* ignore */ }
}

export function readReconcileMeta(): ReconcileMeta | null {
  try {
    const raw = localStorage.getItem(RECONCILE_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReconcileMeta;
  } catch {
    return null;
  }
}
