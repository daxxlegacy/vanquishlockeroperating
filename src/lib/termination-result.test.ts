// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTerminationResult, type AtomicTerminationResult } from "./termination-result";

test("publishes final saved locker/occupancy and removes only RPC-reported IDs before refresh", () => {
  const result = {
    status: "terminated", locker: { id: "locker-1", status: "empty", employee_name: null, spare_key_status: "available" },
    occupancy_rows: [{ id: "kept", status: "Terminate" }, { id: "other-person", status: "Terminate" }],
    removed_occupancy_ids: ["duplicate"],
  } as AtomicTerminationResult;
  const calls: unknown[] = [];
  applyTerminationResult(result, {
    removeOccupancy: ids => calls.push(["remove", ids]),
    patchOccupancy: rows => calls.push(["occupancy", rows]),
    patchLockers: rows => calls.push(["lockers", rows]),
    refreshOccupancy: () => calls.push("refresh"),
  });
  assert.deepEqual(calls, [["remove", ["duplicate"]], ["occupancy", result.occupancy_rows], ["lockers", [result.locker]], "refresh"]);
  assert.equal(result.locker.spare_key_status, "available");
});

test("idempotent noop reconciles final saved state without inventing deleted IDs", () => {
  const result = { status: "noop", locker: { id: "locker-1", employee_name: null }, occupancy_rows: [], removed_occupancy_ids: [] } as unknown as AtomicTerminationResult;
  let deleted: string[] = ["must-not-survive"];
  let patched: unknown;
  applyTerminationResult(result, { removeOccupancy: ids => { deleted = ids; }, patchOccupancy: () => {}, patchLockers: rows => { patched = rows; }, refreshOccupancy: () => {} });
  assert.deepEqual(deleted, []);
  assert.deepEqual(patched, [result.locker]);
});