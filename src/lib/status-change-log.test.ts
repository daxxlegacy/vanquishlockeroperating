// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleStatusChangeRows } from "./status-change-log";

test("never shows duplicate-removed entries while retaining genuine status changes", () => {
  const rows = [
    { id: "noise", new_status: "(duplicate removed)" },
    { id: "active", new_status: "active" },
    { id: "terminate", new_status: "Terminate (Full Locker)" },
  ];
  assert.deepEqual(visibleStatusChangeRows(rows).map((row) => row.id), ["active", "terminate"]);
});