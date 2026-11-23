// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
/** Shared browser/worker-safe numeric-lock predicate; no spare key applies. */
export function isCombinationLock(keyLock: string | null | undefined): boolean {
  return /numeric/i.test(keyLock ?? "");
}