import { parseBatchIntake } from "@/lib/locker-utils";
import { mapHrReason, mapTerminationType, reasonClash, type TerminationMetadata } from "./termination-reasons";

export type HrPerson = TerminationMetadata & {
  badge: string | null; name: string | null; status: "current" | "terminated";
  joinDate: string | null; terminateDate: string | null; workLocation: string | null;
  gradeset: string | null; department: string | null; warnings: string[]; rowNumber: number;
};
export type HrNeedsCheck = { rowNumber: number; badge: string | null; name: string | null; issue: string };
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s_\-/+().]/g, "");
const aliases: Record<string, string[]> = {
  badge: ["employeecode","empcode","employeeid","empid","badgenumber","badge","personnumber"],
  name: ["employeename","name","fullname","legalname"], status: ["status","employeestatus","employmentstatus","75","57"],
  terminate: ["t1terminatedate","terminatedate","terminationdate","terminated","termdate","resigndate","resignationdate","lastworkingday","lastworkingdate","lwd","exitdate","leavingdate","dateofleaving","dateoftermination"],
  join: ["joincompanydate","joindate","hiredate","joiningdate","dateofjoining"],
  workLocation: ["worklocation","location","site"], gradeset: ["gradeset","grade"], department: ["departmentname","department","deptname"],
  type: ["termtype13","termtype"], separation: ["separationtype18","separationtype"], category: ["actual/suspected19","actualsuspected19","actualsuspected"], detail: ["reason20","reason"],
};
type Layout = Record<string, number>;
function layoutFor(row: unknown[]): Layout | null {
  const out: Layout = {};
  for (const [key, names] of Object.entries(aliases)) {
    const i = row.findIndex(v => names.map(norm).includes(norm(v)));
    if (i >= 0) out[key] = i;
  }
  return out.badge !== undefined || out.name !== undefined ? out : null;
}
const suspicious = (v: unknown) => typeof v === "number" || /^(?:\d{6}-\d{2}-\d{4}|\d+(?:\.\d+)?)$/.test(String(v ?? "").trim());
// No raw HR row or national ID is ever returned or retained in parsed state.
const safeText = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return !s || /\d{6}-\d{2}-\d{4}/.test(s) ? null : s;
};
export function parseHrRows(rows: unknown[][], filename: string, includeDetail: boolean): { people: HrPerson[]; needsCheck: HrNeedsCheck[] } {
  const headers = rows.map((row,index) => ({ index, layout: layoutFor(row) })).filter((x): x is { index:number; layout:Layout } => x.layout !== null);
  if (!headers.length) throw new Error("Couldn't find Employee Code or Employee Name in the file.");
  let layout = headers[0].layout;
  const people: HrPerson[] = [], needsCheck: HrNeedsCheck[] = [];
  const fileTerminated = /terminat|resign|leaver|exit\s*list/i.test(filename);
  for (let i=headers[0].index+1; i<rows.length; i++) {
    const header = headers.find(h=>h.index===i);
    if (header) { layout=header.layout; continue; }
    const row=rows[i];
    if (!row || row.every(v=>v==null || v==="")) continue;
    let chosen=layout;
    const get=(key:string,l=chosen) => l[key]===undefined ? null : row[l[key]];
    if (layout.type !== undefined && suspicious(get("type"))) {
      const candidates = headers.map(h=>h.layout).filter(l=> l.type!==undefined && l.type!==layout.type && !!mapTerminationType(get("type",l)) && !suspicious(get("type",l)) && safeText(get("badge",l))===safeText(get("badge",layout)) && safeText(get("name",l))===safeText(get("name",layout)));
      const unique = new Map(candidates.map(l=>[JSON.stringify(l),l]));
      if (unique.size!==1) {
        needsCheck.push({rowNumber:i+1,badge:safeText(get("badge",layout)),name:safeText(get("name",layout)),issue:"Misaligned Term Type; no unambiguous alternate header layout"});
        continue;
      }
      chosen=Array.from(unique.values())[0];
    }
    const badge=safeText(get("badge")),name=safeText(get("name"));
    if (!badge && !name) continue;
    const statusRaw=(safeText(get("status")) ?? "").toLowerCase();
    const terminateDate=parseBatchIntake(get("terminate"));
    const status = statusRaw.includes("terminat") || statusRaw==="resigned" || (!!terminateDate && !statusRaw.includes("current")) || (fileTerminated && !statusRaw.includes("current")) ? "terminated" : "current";
    const termination_type=mapTerminationType(get("type")), reason_code=mapHrReason(get("separation"));
    const warnings:string[]=[];
    if (status==="terminated" && !safeText(get("separation"))) warnings.push("No reason in HR file");
    if (reasonClash(termination_type,reason_code)) warnings.push("Type and Reason clash");
    people.push({badge,name,status,joinDate:parseBatchIntake(get("join")),terminateDate,workLocation:safeText(get("workLocation")),gradeset:safeText(get("gradeset")),department:safeText(get("department")),termination_type,reason_code,reason_category:safeText(get("category")),reason_detail:includeDetail?safeText(get("detail")):null,warnings,rowNumber:i+1});
  }
  return {people,needsCheck};
}