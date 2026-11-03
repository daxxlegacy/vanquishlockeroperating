export const rosterToken = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const BADGES = ["personnumber", "badgenumber", "badgeno", "badge", "badgeid", "employeecode", "employeenumber", "employeeid", "empid", "empcode", "empnum", "staffid", "vlookupocempnum", "vlookupempnum"];
const NAMES = ["legalfullname", "legalname", "employeename", "fullname", "name", "ocname", "vlookupocname"];
const IDS = ["nationalid", "nric", "icnumber", "ic", "identitycard", "mykad", "icno", "nationalidnumber", "nationalidno", "passport", "passportnumber", "passportno"];
const MARKERS = new Set([...BADGES, ...NAMES, ...IDS, "legacyid"]);

export type RosterRow = { badge: string | null; name: string | null; names: string[]; nationalId: string | null; location: string | null; jobName: string | null; assignmentType: string | null; sheet: string; rowIndex: number };
export type RosterSheetSummary = { sheet: string; headerRow: number | null; rows: number; badgeColumn?: string; nameColumn?: string; nationalIdColumn?: string };
export type RosterFileResult = { rows: RosterRow[]; summaries: RosterSheetSummary[] };

export function normalizeRosterBadge(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let text = typeof value === "number" ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : String(value);
  text = text.trim().replace(/^'/, "").trim().replace(/\.0$/, "");
  return text || null;
}

const cellText = (value: unknown): string | null => String(value ?? "").trim() || null;

/** Header names are resolved per block, never against another sheet's positions. */
export function parseRosterSheets(sheets: { sheet: string; cells: unknown[][] }[], includeNationalId = false): RosterFileResult {
  const result: RosterFileResult = { rows: [], summaries: [] };
  for (const { sheet, cells } of sheets) {
    const headerIndex = cells.slice(0, 30).findIndex(row => row.filter(v => MARKERS.has(rosterToken(v))).length >= 2);
    const summary: RosterSheetSummary = { sheet, headerRow: headerIndex < 0 ? null : headerIndex + 1, rows: 0 };
    result.summaries.push(summary);
    if (headerIndex < 0) continue;
    let headers: string[] = [];
    let badgeIndex = -1, nameIndex = -1, idIndex = -1, locationIndex = -1, jobIndex = -1, assignmentIndex = -1;
    let nameIndices: number[] = [];
    const configure = (row: unknown[]) => {
      headers = row.map(v => cellText(v) ?? "");
      const tokens = headers.map(rosterToken);
      const pick = (aliases: string[]) => { for (const alias of aliases) { const index = tokens.indexOf(alias); if (index >= 0) return index; } return -1; };
      badgeIndex = pick(BADGES); nameIndex = pick(NAMES); idIndex = pick(IDS);
      nameIndices = tokens.flatMap((t, i) => NAMES.includes(t) ? [i] : []);
      locationIndex = pick(["location", "worklocation", "worksite"]);
      jobIndex = pick(["jobname"]); assignmentIndex = pick(["assignmenttype"]);
    };
    configure(cells[headerIndex]);
    summary.badgeColumn = headers[badgeIndex]; summary.nameColumn = headers[nameIndex]; summary.nationalIdColumn = headers[idIndex];
    for (let i = headerIndex + 1; i < cells.length; i++) {
      const row = cells[i] ?? [];
      // Repeated contractor headers may introduce an extra column; re-map names.
      if (row.filter(v => MARKERS.has(rosterToken(v))).length >= 2) { configure(row); continue; }
      if (!row.some((v, c) => headers[c] && !/^(__empty|unnamed)/i.test(headers[c]) && cellText(v))) continue;
      const names = nameIndices.map(c => cellText(row[c])).filter((v): v is string => v !== null);
      const badge = normalizeRosterBadge(row[badgeIndex]);
      result.rows.push({ badge, name: cellText(row[nameIndex]), names, nationalId: includeNationalId ? cellText(row[idIndex]) : null, location: cellText(row[locationIndex]), jobName: cellText(row[jobIndex]), assignmentType: cellText(row[assignmentIndex]), sheet, rowIndex: i + 1 });
      summary.rows++;
    }
  }
  return result;
}