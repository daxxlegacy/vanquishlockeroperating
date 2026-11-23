// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
export type FailureReason = 'locker_not_found' | 'badge_mismatch' | 'id_mismatch' | 'rate_limited' | 'empty_locker';
export function attemptLog(input: {
  ip: string; locker: string | null; badge: string; success: boolean;
  owner?: { employee_name?: string | null; badge_number?: string | null; status?: string | null } | null;
  reason: FailureReason | null;
}) {
  const empty = input.owner?.status === 'empty';
  // Explicit allowlist: never copy the request body or national ID data.
  return {
    ip_address: input.ip, locker_number: input.locker, success: input.success,
    entered_badge: input.badge.trim().slice(0, 30),
    owner_name_snapshot: empty ? null : input.owner?.employee_name ?? null,
    owner_badge_snapshot: empty ? null : input.owner?.badge_number ?? null,
    failure_reason: input.success ? null : input.reason,
  };
}