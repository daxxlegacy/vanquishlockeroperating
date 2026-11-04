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

test("new units replace WUXI immediately after 6631–6633 on the same row", () => {
  const sheet = layout["Phase 3 Locker Room"];
  const row = sheet.cells.filter((cell) => cell.r === 9 && cell.c >= 2 && cell.c <= 7)
    .sort((a, b) => a.c - b.c);
  assert.deepEqual(row.map((cell) => [cell.c, cell.n]), [
    [2, "6631"], [3, "6632"], [4, "6633"], [5, "6796"], [6, "6797"], [7, "6798"],
  ]);
  assert.equal(sheet.cells.some((cell) => cell.n === "WUXI"), false);
});

test("approved Numeric Lock has no spare key, including with null status", () => {
  assert.equal(isCombinationLock("Numeric Lock"), true);
  assert.equal(isCombinationLock("Round Lock Key"), false);
});