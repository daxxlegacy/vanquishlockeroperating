import { findHeaderRow, headerToken } from "./tabular-header";

export type SpareKeyStatus = "available" | "missing" | "with_employee" | "damaged" | "unknown" | "taken" | "taken_for_cleaning";
export type SpareKeySheetSummary = { sheet: string; headerRow: number | null; rows: number; lockerColumn?: string; statusColumn?: string; physicalColumn?: string };
export type SpareKeyFileResult = { rows: { locker_number: string; spare_key_status: SpareKeyStatus }[]; summaries: SpareKeySheetSummary[]; errors: string[]; duplicateOverrides: number };
const LOCKERS = ["locker", "lockernumber", "lockerno", "lockerid", "combinelocker", "comblocker"];
const SPARE = ["sparekeystatus", "sparekey"];
const PHYSICAL = ["physicalkeystatus", "physicalkey", "physicialkey", "statusavailablenotavailable", "statusavailable"];
const pick = (tokens: string[], aliases: string[]) => tokens.findIndex(t => aliases.includes(t));
const isHeader = (row: unknown[]) => {
  const tokens = row.map(headerToken);
  return pick(tokens, LOCKERS) >= 0 && pick(tokens, [...SPARE, ...PHYSICAL, "status"]) >= 0;
};

export function parseSpareKeyStatus(raw: unknown): SpareKeyStatus | null {
  const token = headerToken(raw);
  const values: Record<string, SpareKeyStatus> = {
    available: "available", sparekey: "available", spare: "available", ok: "available", yes: "available",
    missing: "missing", notavailable: "missing", no: "missing",
    withemployee: "with_employee", withemp: "with_employee",
    damaged: "damaged", damage: "damaged", unknown: "unknown",
    taken: "taken", takenforcleaning: "taken_for_cleaning", cleaning: "taken_for_cleaning",
  };
  return values[token] ?? null;
}

export function parseSpareKeySheets(sheets: { sheet: string; cells: unknown[][] }[]): SpareKeyFileResult {
  const result: SpareKeyFileResult = { rows: [], summaries: [], errors: [], duplicateOverrides: 0 };
  const incoming = new Map<string, SpareKeyStatus>();
  for (const { sheet, cells } of sheets) {
    const start = findHeaderRow(cells, isHeader);
    const summary: SpareKeySheetSummary = { sheet, headerRow: start < 0 ? null : start + 1, rows: 0 };
    result.summaries.push(summary);
    if (start < 0) continue;
    let lockerIndex = -1, statusIndex = -1, physicalIndex = -1, explicit = false;
    const configure = (row: unknown[]) => {
      const tokens = row.map(headerToken);
      lockerIndex = pick(tokens, LOCKERS);
      statusIndex = pick(tokens, SPARE); explicit = statusIndex >= 0;
      if (!explicit) statusIndex = tokens.indexOf("status");
      physicalIndex = pick(tokens, PHYSICAL);
      summary.lockerColumn = String(row[lockerIndex]);
      summary.statusColumn = statusIndex >= 0 ? String(row[statusIndex]) : undefined;
      summary.physicalColumn = physicalIndex >= 0 ? String(row[physicalIndex]) : undefined;
    };
    configure(cells[start]);
    for (let i = start + 1; i < cells.length; i++) {
      const row = cells[i];
      if (isHeader(row)) { configure(row); continue; }
      const locker = String(row[lockerIndex] ?? "").trim().toUpperCase();
      if (!locker || !/^([0-9]+[A-Z]+|[A-Z]+[0-9]+)$/.test(locker)) continue;
      const statusRaw = row[statusIndex];
      const usePhysical = !explicit && (statusIndex < 0 || headerToken(statusRaw).includes("spare"));
      if (usePhysical && physicalIndex < 0) { result.errors.push(`${sheet}: missing Physical Key column.`); continue; }
      const raw = usePhysical ? row[physicalIndex] : statusRaw;
      const status = String(raw ?? "").trim() === "" ? "unknown" : parseSpareKeyStatus(raw);
      summary.rows++;
      if (!status) { result.errors.push(`${sheet}, row ${i + 1}: unrecognized Spare Key Status for ${locker}.`); continue; }
      const previous = incoming.get(locker);
      // Preserve the legacy last-row-wins behavior; surface overrides in preview.
      if (previous && previous !== status) result.duplicateOverrides++;
      incoming.set(locker, status);
    }
  }
  result.rows = [...incoming].map(([locker_number, spare_key_status]) => ({ locker_number, spare_key_status }));
  return result;
}

export type SpareKeyChange = { id: string; locker_number: string; prevSpare: string | null; spare_key_status: SpareKeyStatus; unlisted: boolean };
export function requiresSpareKeyConfirmation(changes: Pick<SpareKeyChange, "spare_key_status">[]) {
  return changes.length > 300 || changes.filter(change => change.spare_key_status === "missing").length > 100;
}

export function canConfirmSpareKeySync(changes: Pick<SpareKeyChange, "spare_key_status">[], confirmation: string) {
  return !requiresSpareKeyConfirmation(changes) || confirmation === "CONFIRM";
}

export function planSpareKeySync(incoming: SpareKeyFileResult["rows"], lockers: { id: string; locker_number: string; spare_key_status: string | null }[]) {
  const byNumber = new Map(incoming.map(r => [r.locker_number.trim().toUpperCase(), r.spare_key_status]));
  const known = new Set(lockers.map(l => l.locker_number.trim().toUpperCase()));
  const changes: SpareKeyChange[] = [];
  let matched = 0;
  for (const locker of lockers) {
    const listed = byNumber.get(locker.locker_number.trim().toUpperCase());
    if (listed) matched++;
    const next = listed ?? "missing";
    if (locker.spare_key_status !== next) changes.push({ id: locker.id, locker_number: locker.locker_number, prevSpare: locker.spare_key_status, spare_key_status: next, unlisted: !listed });
  }
  return { changes, matched, unmatched: incoming.filter(r => !known.has(r.locker_number.trim().toUpperCase())) };
}