// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
export type LookupAttempt = {
  id: string; attempted_at: string; ip_address: string | null; locker_number: string | null;
  entered_badge: string | null; owner_name_snapshot: string | null; owner_badge_snapshot: string | null;
  success: boolean; failure_reason: string | null; review: boolean;
};
export type LookupPage = { rows: LookupAttempt[]; total: number };
export const LOOKUP_PAGE_SIZE = 50;
export function lookupResult(a: Pick<LookupAttempt, 'success' | 'failure_reason'>) {
  if (a.success) return 'Success';
  const labels: Record<string,string> = { badge_mismatch:'Wrong badge', id_mismatch:'Wrong ID digits', locker_not_found:'Locker not found', empty_locker:'Empty locker', rate_limited:'Too many tries' };
  return a.failure_reason ? labels[a.failure_reason] ?? '—' : '—';
}
export function wrongEnteredBadge(a: Pick<LookupAttempt, 'success' | 'entered_badge' | 'owner_badge_snapshot'>) {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g,'');
  return !a.success && a.entered_badge !== null && !!a.owner_badge_snapshot && normalize(a.entered_badge) !== normalize(a.owner_badge_snapshot);
}
export function lookupExport(a: LookupAttempt) {
  return { When:a.attempted_at, Locker:a.locker_number ?? '—', 'Badge entered':a.entered_badge ?? '—', 'Name on record':a.owner_name_snapshot ?? '—', IP:a.ip_address ?? '—', Result:lookupResult(a) };
}