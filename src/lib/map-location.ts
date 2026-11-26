// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
type MapLocker = { location: string; map_location?: string | null };

/** Map-only grouping. Operational pages must continue to use location. */
export function groupLockersByMapLocation<T extends MapLocker>(lockers: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const locker of lockers) {
    const location = locker.map_location ?? locker.location;
    const group = groups.get(location) ?? [];
    group.push(locker);
    groups.set(location, group);
  }
  return groups;
}