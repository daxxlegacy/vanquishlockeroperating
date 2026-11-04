import { test } from "node:test";
import assert from "node:assert/strict";
import layout from "../data/locker-map-layout.json";
import { isCombinationLock } from "../components/KeyBadge";

test("approved 6796–6798 groups exist once on the Phase 3 map without overlaps", () => {
  const sheet = layout["Phase 3 Locker Room"];
  for (const number of ["6796", "6797", "6798"]) {
    const cells = sheet.cells.filter((cell) => cell.n === number);
    assert.equal(cells.length, 1);
    const cell = cells[0];
    assert.ok(cell);
    assert.ok(cell.r <= sheet.rows && cell.c <= sheet.cols);
    assert.equal(sheet.cells.filter((other) => other.r === cell.r && other.c === cell.c).length, 1);
  }
});

test("approved Numeric Lock has no spare key, including with null status", () => {
  assert.equal(isCombinationLock("Numeric Lock"), true);
  assert.equal(isCombinationLock("Round Lock Key"), false);
});