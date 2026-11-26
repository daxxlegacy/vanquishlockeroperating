// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLockersByMapLocation } from "./map-location";

test("relocated lockers retain their old Map location instead of Location C", () => {
  const locker = { locker_number: "411F", location: "Location C", map_location: "Sixth Row Horizontal" };
  const groups = groupLockersByMapLocation([locker]);
  assert.deepEqual(groups.get("Sixth Row Horizontal"), [locker]);
  assert.equal(groups.has("Location C"), false);
});

test("Map uses current location when map_location is null or absent", () => {
  const lockers = [{ location: "Phase 3 Locker Room", map_location: null }, { location: "Phase 3 Locker Room" }];
  assert.equal(groupLockersByMapLocation(lockers).get("Phase 3 Locker Room")?.length, 2);
});

test("Map null fallback follows COALESCE and does not replace an explicit empty string", () => {
  const locker = { location: "Location B", map_location: "" };
  assert.deepEqual(groupLockersByMapLocation([locker]).get(""), [locker]);
});