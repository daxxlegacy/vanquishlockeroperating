import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpareKeySheets, planSpareKeySync } from "./spare-key-sync";

test("Spare Keys export headers round-trip every exported status under a title row", () => {
  const statuses = ["available", "missing", "with_employee", "damaged", "unknown", "taken", "taken_for_cleaning"];
  const r = parseSpareKeySheets([{ sheet: "Spare Keys", cells: [["Export"], [], ["Locker #", "Location", "Spare Key Status"], ...statuses.map((s,i) => [`${i+1}A`, "Plant", s.replace(/_/g," ")])] }]);
  assert.deepEqual(r.rows.map(r=>r.spare_key_status), statuses);
  assert.equal(r.summaries[0].headerRow, 3); assert.deepEqual(r.errors, []);
});
test("legacy Combine Locker and independent multi-sheet headers map physical spare markers", () => {
  const r = parseSpareKeySheets([{ sheet:"Old", cells:[["Title"],["Combine Locker","Status","Physical Key Status"],[" 1a ","Spare Key","Not Available"]] },{sheet:"New",cells:[["Spare Key Status","Locker #"],["with employee","2A"]]}]);
  assert.deepEqual(r.rows, [{locker_number:"1A",spare_key_status:"missing"},{locker_number:"2A",spare_key_status:"with_employee"}]);
});
test("original workbook misspelled Physicial Key maps Yes and Taken For Cleaning", () => {
  const r = parseSpareKeySheets([{sheet:"Spare Key",cells:[[],[],["Combine Locker","Status","Physicial Key"],["1A","Spare Key","Yes"],["2A","Spare Key","Taken For Cleaning"]]}]);
  assert.deepEqual(r.rows.map(r=>r.spare_key_status),["available","taken_for_cleaning"]);
  assert.equal(r.summaries[0].headerRow,3);
});
test("plan includes unlisted-to-missing, excludes unchanged and matches by number only", () => {
  const p = planSpareKeySync([{locker_number:"1A",spare_key_status:"taken"},{locker_number:"9A",spare_key_status:"available"}], [{id:"1",locker_number:"1a",spare_key_status:"available"},{id:"2",locker_number:"2A",spare_key_status:"available"},{id:"3",locker_number:"3A",spare_key_status:"missing"}]);
  assert.deepEqual(p.changes.map(c=>[c.locker_number,c.prevSpare,c.spare_key_status,c.unlisted]), [["1a","available","taken",false],["2A","available","missing",true]]);
  assert.equal(p.matched,1); assert.equal(p.unmatched[0].locker_number,"9A");
});
test("invalid status and conflicting duplicate rows block a safe preview", () => {
  const r = parseSpareKeySheets([{sheet:"S",cells:[["Locker #","Spare Key Status"],["1A","available"],["1A","missing"],["2A","nonsense"]]}]);
  assert.equal(r.errors.length,2);
});