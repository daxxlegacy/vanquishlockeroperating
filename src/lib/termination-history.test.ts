import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deduplicateTerminationEvents, sameTerminationPerson } from "./termination-history";

const event = (id: string, source = "occupancy", overrides = {}) => ({
  id, source, status: "Terminate", badge_number: " B123 ", employee_name: " Employee ",
  date: "2026-11-03", remarks: null as string | null, by: null as string | null,
  reason_code:null as string|null,termination_type:null as string|null,reason_detail:null as string|null,reason_category:null as string|null,...overrides,
});

describe("termination history rules", () => {
  test("prefers occupancy ID and copies reason and admin email", () => {
    const result = deduplicateTerminationEvents([
      event("t-1", "termination", { badge_number: "b123", date: "2026-11-03T12:00:00Z", remarks: "Resigned", by: "admin@example.com" }),
      event("o-1"),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "o-1");
    assert.equal(result[0].remarks, "Resigned");
    assert.equal(result[0].by, "admin@example.com");
  });
  test("same-source duplicates collapse but other dates and people remain", () => {
    const result = deduplicateTerminationEvents([event("o-1"), event("o-2"), event("o-3", "occupancy", { date: "2026-11-02" }), event("o-4", "occupancy", { badge_number: "B999" })]);
    assert.deepEqual(result.map(e => e.id), ["o-1", "o-3", "o-4"]);
  });
  test("merged termination retains reason metadata and private note without changing its occupancy ID", () => {
    const rows=deduplicateTerminationEvents([event("o-1", "occupancy", {reason_code:"RESIGN",reason_category:"Another Job"}),event("t-1","termination",{termination_type:"Voluntary",reason_detail:"Verification note"})]);
    assert.equal(rows[0].id,"o-1");
    assert.equal(rows[0].reason_code,"RESIGN");
    assert.equal(rows[0].termination_type,"Voluntary");
    assert.equal(rows[0].reason_detail,"Verification note");
  });
  test("falls back to case-insensitive name without badge", () => {
    assert.equal(deduplicateTerminationEvents([event("o-1", "occupancy", { badge_number: null }), event("t-1", "termination", { badge_number: "", employee_name: "employee", status: "Terminated" })]).length, 1);
  });
  test("never deduplicates Active, Transfer or Swap", () => {
    const rows = [event("a-1", "occupancy", { status: "Active" }), event("a-2", "occupancy", { status: "Active" }), event("m-1", "transfer"), event("m-2", "transfer"), event("s-1", "swap"), event("s-2", "swap")];
    assert.deepEqual(deduplicateTerminationEvents(rows), rows);
  });
  test("matches same badge OR same name without matching blank identities", () => {
    const person = { badge_number: " B123 ", employee_name: " Employee " };
    assert.equal(sameTerminationPerson(person, { badge_number: "b123", employee_name: "Other" }), true);
    assert.equal(sameTerminationPerson(person, { badge_number: "different", employee_name: "employee" }), true);
    assert.equal(sameTerminationPerson(person, { badge_number: "B999", employee_name: "Someone else" }), false);
    assert.equal(sameTerminationPerson({ badge_number: null, employee_name: null }, { badge_number: null, employee_name: null }), false);
  });
});