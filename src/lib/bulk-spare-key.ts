// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { Constants, type Database } from "@/integrations/supabase/types";
import { isCombinationLock } from "./combination-lock";
import { findHeaderRow, headerToken } from "./tabular-header";

export type KeyStatus = Database["public"]["Enums"]["key_status"];
export const KEY_STATUSES = Constants.public.Enums.key_status;
export const keyStatusLabel = (s: string | null) => s == null ? "N/A" : s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
export function normalizeSpareStatus(raw: unknown): KeyStatus | null {
  const token = headerToken(raw);
  const aliases: Record<string, KeyStatus> = { present: "available", found: "available", yes: "available", notavailable: "missing", lost: "missing", no: "missing", withstaff: "with_employee", withemployee: "with_employee", broken: "damaged", cleaning: "taken_for_cleaning", takenforcleaning: "taken_for_cleaning", notknown: "unknown" };
  return KEY_STATUSES.find(s => headerToken(s) === token) ?? aliases[token] ?? null;
}
const LOCKER_HEADERS = ["lockernumber", "locker", "lockerno", "lockerid", "locker num", "combinelocker"].map(headerToken);
const STATUS_HEADERS = ["newsparekeystatus", "sparekeystatus", "status", "newkeystatus", "sparekey", "newsparestatus"];
export type SpareInput = { sheet: string; row: number; locker_number: string; raw_status: string; new_status: KeyStatus | null };
export type SpareFile = { rows: SpareInput[]; columns: { sheet: string; headerRow: number; locker: string; status: string; rows: number; error?: string }[] };
export function parseSpareSheets(sheets: { sheet: string; cells: unknown[][] }[]): SpareFile {
  const result: SpareFile = { rows: [], columns: [] };
  for (const { sheet, cells } of sheets) {
    const findCols = (r: unknown[]) => [r.findIndex(v => LOCKER_HEADERS.includes(headerToken(v))), r.findIndex(v => STATUS_HEADERS.includes(headerToken(v)))];
    const header = findHeaderRow(cells, r => findCols(r).every(c => c >= 0));
    if (header < 0) { if (cells.some(r => r.some(v => String(v ?? "").trim()))) result.columns.push({ sheet, headerRow: 0, locker: "", status: "", rows: 0, error: "Missing Locker Number / New Spare Key Status headers" }); continue; }
    let cols = findCols(cells[header]);
    const summary = { sheet, headerRow: header + 1, locker: String(cells[header][cols[0]]), status: String(cells[header][cols[1]]), rows: 0 };
    for (let i = header + 1; i < cells.length; i++) {
      const r = cells[i];
      const next = findCols(r); if (next.every(c => c >= 0)) { cols = next; continue; }
      const locker = String(r[cols[0]] ?? "").trim().replace(/^'/, "").toUpperCase();
      const raw = String(r[cols[1]] ?? "").trim();
      if (!locker && !raw) continue;
      result.rows.push({ sheet, row: i + 1, locker_number: locker, raw_status: raw, new_status: normalizeSpareStatus(raw) }); summary.rows++;
    }
    result.columns.push(summary);
  }
  return result;
}
export type SpareLocker = Pick<Database["public"]["Tables"]["lockers"]["Row"], "id" | "locker_number" | "location" | "key_lock" | "spare_key_status">;
export type SparePreviewRow = SpareInput & { locker?: SpareLocker; action: "change" | "unchanged" | "problem"; reason: string; warning?: string };
export function buildSparePreview(rows: SpareInput[], lockers: SpareLocker[]): SparePreviewRow[] {
  const db = new Map(lockers.map(l => [l.locker_number.trim().toUpperCase(), l]));
  const last = new Map<string, number>(); const statuses = new Map<string, Set<string>>();
  rows.forEach((r, i) => { last.set(r.locker_number, i); const values = statuses.get(r.locker_number) ?? new Set<string>(); values.add(r.new_status ?? r.raw_status); statuses.set(r.locker_number, values); });
  return rows.map((r, i) => {
    const locker = db.get(r.locker_number);
    const warning = (statuses.get(r.locker_number)?.size ?? 0) > 1 ? "Conflicting duplicate statuses — last row wins" : undefined;
    const base = { ...r, locker, warning };
    if (last.get(r.locker_number) !== i) return { ...base, action: "problem", reason: "Duplicate locker — superseded by last row" };
    if (!locker) return { ...base, action: "problem", reason: "Locker not found" };
    if (isCombinationLock(locker.key_lock)) return { ...base, action: "problem", reason: "Skipped – numeric lock (no spare key)" };
    if (!r.new_status) return { ...base, action: "problem", reason: `Invalid status: ${r.raw_status || "(blank)"}` };
    return { ...base, action: locker.spare_key_status === r.new_status ? "unchanged" : "change", reason: locker.spare_key_status === r.new_status ? "Already that status" : "" };
  });
}
export const canApplySparePreview = (changes: number, confirmation: string) => changes > 0 && (changes <= 300 || confirmation === "CONFIRM");