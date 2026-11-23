// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpareSheets, buildSparePreview, normalizeSpareStatus, canApplySparePreview, KEY_STATUSES } from "./bulk-spare-key";
test("all seven enum statuses and common case/space variants normalize", () => {
  assert.equal(KEY_STATUSES.length, 7);
  for (const s of KEY_STATUSES) assert.equal(normalizeSpareStatus(`  ${s.replace(/_/g, ' ').toUpperCase()}  `), s);
  assert.equal(normalizeSpareStatus("With staff"), "with_employee");
  assert.equal(normalizeSpareStatus("Lost"), "missing");
  assert.equal(normalizeSpareStatus("invented"), null);
});
test("title rows, reordered aliases, repeated headers, empty columns and multiple sheets", () => {
  const file = parseSpareSheets([{sheet:"one",cells:[["title"],[],["", "Status", "Locker No"],["", "Available", "1A"],["", "", ""],["", "Status", "Locker No"],["", "Missing", "1B"]]}, {sheet:"two",cells:[["Locker", "New Spare Key Status"],["1C","Unknown"]]}]);
  assert.equal(file.rows.length,3); assert.equal(file.columns[0].headerRow,3); assert.equal(file.rows[0].row,4); assert.equal(file.rows[2].sheet,"two");
});
test("five-locker preview changes only final valid rows, excludes numeric locks and identifies invalid/missing", () => {
  const file=parseSpareSheets([{sheet:"test",cells:[["Locker Number","New Spare Key Status"],["1A","Missing"],["1B","Available"],["1B","Unknown"],["1C","invalid"],["6796A","Available"],["1D","Available"]]}]);
  const lockers=["1A","1B","1C","6796A","1D"].map((n)=>({id:n,locker_number:n,location:"Location",key_lock:n==="6796A"?"Numeric Lock":"Round Lock Key",spare_key_status:n==="1D"?"available" as const:n==="6796A"?null:"missing" as const}));
  const before=JSON.stringify(lockers); const rows=buildSparePreview(file.rows,lockers);
  assert.deepEqual(rows.filter(r=>r.action==="change").map(r=>[r.locker_number,r.new_status]),[["1B","unknown"]]);
  assert.equal(rows.filter(r=>r.action==="unchanged").length,2);
  assert.equal(rows.find(r=>r.locker_number==="6796A")?.reason,"Skipped – numeric lock (no spare key)");
  assert.equal(rows[1].action,"problem"); assert.match(rows[2].warning ?? "",/last row wins/);
  assert.match(rows[3].reason,/Invalid status/); assert.equal(JSON.stringify(lockers),before);
  assert.equal(buildSparePreview(file.rows,[])[0].reason,"Locker not found");
});
test("more than 300 changes requires typing exactly CONFIRM", () => {
  assert.equal(canApplySparePreview(300,""),true); assert.equal(canApplySparePreview(301,""),false);
  assert.equal(canApplySparePreview(301,"confirm"),false); assert.equal(canApplySparePreview(301,"CONFIRM"),true); assert.equal(canApplySparePreview(0,"CONFIRM"),false);
});