import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizedNewLockerNumber, validNewLockerNumber, newLockerPayload } from "./add-locker";
import { compareLockerNumbers } from "./locker-utils";

describe("Add Locker rules", () => {
  test("trims and uppercases; accepts only numeric-letter or letter-numeric forms", () => {
    assert.equal(normalizedNewLockerNumber(" 12a "), "12A");
    for (const n of [" 12a ", "A01", "AA01", "LK01"]) assert.equal(validNewLockerNumber(n), true);
    for (const n of ["", "12", "AB", "12 A", "1A2", "A-01"]) assert.equal(validNewLockerNumber(n), false);
  });
  test("always creates an empty locker with no occupant or intake", () => {
    const payload = newLockerPayload("12a", "Walkway Café", null);
    assert.equal(payload.status, "empty");
    for (const key of ["employee_name", "badge_number", "national_id", "batch_intake", "remark"] as const) assert.equal(payload[key], null);
    assert.equal(payload.key_lock, null);
    assert.equal(payload.location, "Walkway Café");
  });
  test("derives unit type from existing category helper for new lockers only", () => {
    for (const [n, unit] of [["12A", "Full Locker"], ["A01", "Shoe Locker"], ["AA01", "Staff Locker"], ["LK01", "HR Locker"]]) assert.equal(newLockerPayload(n, "Test", "Numeric Lock").unit_type, unit);
  });
  test("natural sort puts numeric prefixes before letter-first groups", () => {
    assert.deepEqual(["AA01", "2A", "1B", "A01", "1A", "10A"].sort(compareLockerNumbers), ["1A", "1B", "2A", "10A", "A01", "AA01"]);
  });
});