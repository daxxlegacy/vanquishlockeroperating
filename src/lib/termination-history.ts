// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
export type TerminationIdentity = {
  badge_number: string | null;
  employee_name: string | null;
};

export function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isTerminatedStatus(status: string | null | undefined): boolean {
  return ["terminate", "terminated"].includes(normalizeIdentity(status));
}

export function sameTerminationPerson(a: TerminationIdentity, b: TerminationIdentity): boolean {
  const badge = normalizeIdentity(a.badge_number);
  const name = normalizeIdentity(a.employee_name);
  return Boolean(
    (badge && badge === normalizeIdentity(b.badge_number)) ||
    (name && name === normalizeIdentity(b.employee_name)),
  );
}

type Event = TerminationIdentity & {
  source: string;
  status: string;
  date: string | null;
  remarks: string | null;
  by: string | null;
  reason_code?: string | null;
  termination_type?: string | null;
  reason_category?: string | null;
  reason_detail?: string | null;
};

/** Display-only deduplication: retained event IDs still address their own records. */
export function deduplicateTerminationEvents<T extends Event>(events: T[]): T[] {
  const retained: T[] = [];
  const positions = new Map<string, number>();
  for (const event of events) {
    if (!isTerminatedStatus(event.status) || !["occupancy", "termination"].includes(event.source)) {
      retained.push(event);
      continue;
    }
    const person = normalizeIdentity(event.badge_number) || normalizeIdentity(event.employee_name);
    const key = JSON.stringify([person, event.date?.slice(0, 10) ?? ""]);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, retained.length);
      retained.push({ ...event });
      continue;
    }
    const previous = retained[position];
    const preferIncoming = event.source === "occupancy" && previous.source !== "occupancy";
    const keep = preferIncoming ? event : previous;
    const other = preferIncoming ? previous : event;
    retained[position] = {
      ...keep,
      remarks: keep.remarks?.trim() ? keep.remarks : other.remarks,
      by: keep.by?.trim() ? keep.by : other.by,
      reason_code: keep.reason_code ?? other.reason_code,
      termination_type: keep.termination_type ?? other.termination_type,
      reason_category: keep.reason_category ?? other.reason_category,
      reason_detail: keep.reason_detail ?? other.reason_detail,
    };
  }
  return retained;
}