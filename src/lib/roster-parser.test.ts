// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRosterBadge, parseRosterSheets } from "./roster-parser";

test("title and blank rows preserve row 3 detection and named fields", () => {
  const r = parseRosterSheets([{ sheet: "Sheet1", cells: [["Active/Term Roster"], [], ["AssignmentNumber", "LegacyID", "PersonNumber", "LegalFullName", "NationalID", "Location", "JobName", "AssignmentType"], ["E10056326", "OLD", "00123", "Test Name", "TEST-ID", "Plant", "Operator", "Contractor"]] }], true);
  assert.equal(r.summaries[0].headerRow, 3); assert.equal(r.rows[0].badge, "00123"); assert.equal(r.rows[0].nationalId, "TEST-ID"); assert.equal(r.rows[0].jobName, "Operator"); assert.equal(r.rows[0].assignmentType, "Contractor"); assert.equal(r.rows[0].location, "Plant");
});
test("legacy and assignment columns never become badges", () => {
  const r = parseRosterSheets([{ sheet: "S", cells: [["LegacyID", "AssignmentNumber", "Name", "National ID"], ["123", "E123", "Test", "TEST-ID"]] }]);
  assert.equal(r.rows[0].badge, null); assert.equal(r.rows[0].nationalId, null);
});
test("badges retain zeros and strip apostrophes and decimal suffixes", () => {
  assert.equal(normalizeRosterBadge(" '00123.0 "), "00123"); assert.equal(normalizeRosterBadge(10056326), "10056326"); assert.equal(normalizeRosterBadge(1e21), "1000000000000000000000");
});
test("all aliases and reordered contractor block map by header name", () => {
  for (const badge of ["PersonNumber", "Employee Code", "Employee Number", "Badge Number", "Badge No", "Emp ID"]) {
    const r = parseRosterSheets([{ sheet: "S", cells: [[badge, "Full Name", "NRIC"], ["001", "First", "TEST-ID"], ["Extra", "IC Number", "Legal Name", badge], ["X", "TEST-ID2", "Second", "002"]] }], true);
    assert.equal(r.rows[1].badge, "002"); assert.equal(r.rows[1].name, "Second"); assert.equal(r.rows[1].nationalId, "TEST-ID2");
  }
});
test("scan stops at 30 rows and unions sheets with independent headers", () => {
  const r = parseRosterSheets([{ sheet: "A", cells: [...Array.from({length:29},()=>[]), ["Badge", "Name"], ["001", "A"]] }, { sheet: "B", cells: [["Name", "Emp ID"], ["B", "002"]] }, { sheet: "Ignored", cells: [...Array.from({length:30},()=>[]), ["Badge", "Name"], ["003", "C"]] }]);
  assert.deepEqual(r.rows.map(row=>[row.sheet,row.badge]), [["A","001"],["B","002"]]); assert.equal(r.summaries[2].headerRow, null);
});
test("11,200 rows parsed once without unnamed-column phantom rows", () => {
  const r = parseRosterSheets([{sheet:"Sheet1",cells:[["Active/Term Roster"],[],["PersonNumber","LegalFullName","", "Unnamed: 3"],...Array.from({length:11200},(_,i)=>[String(i).padStart(8,"0"),`Test ${i}`]),["","","ignored","ignored"]]}]);
  assert.equal(r.rows.length,11200); assert.equal(r.summaries[0].rows,11200); assert.equal(r.rows[0].badge,"00000000");
});