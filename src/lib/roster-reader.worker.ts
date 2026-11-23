// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseRosterSheets, rosterToken } from "./roster-parser";
import { parseSpareSheets } from "./bulk-spare-key";

self.onmessage = async (event: MessageEvent<{ file: File; includeNationalId: boolean; mode?: string }>) => {
  try {
    const { file, includeNationalId, mode } = event.data;
    let sheets: { sheet: string; cells: unknown[][] }[];
    if (file.name.toLowerCase().endsWith(".csv")) {
      const parsed = Papa.parse<string[]>(await file.text(), { header: false, skipEmptyLines: false });
      const error = parsed.errors.find(e => e.code !== "UndetectableDelimiter");
      if (error && mode === "spare-status") throw new Error(error.message);
      sheets = [{ sheet: "csv", cells: parsed.data }];
    } else {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      sheets = workbook.SheetNames.map(sheet => {
        const ws = workbook.Sheets[sheet];
        const cells = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true, blankrows: true, range: 0 });
        if (mode === "spare-status") {
          for (let r = 0; r < cells.length; r++) {
            for (let c = 0; c < cells[r].length; c++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c })];
              if (cell) cells[r][c] = cell.w ?? cell.v;
            }
          }
          return { sheet, cells };
        }
        // Excel may encode leading zeros as a cell number format rather than text.
        // Preserve that formatted identifier without formatting dates or other data.
        let badgeColumn = -1;
        for (let r = 0; r < cells.length; r++) {
          const row = cells[r];
          const person = row.findIndex(v => rosterToken(v) === "personnumber");
          const badge = row.findIndex(v => ["badgenumber", "badgeno", "badge", "badgeid", "employeecode", "employeenumber", "employeeid", "empid", "empcode", "empnum", "staffid", "vlookupocempnum", "vlookupempnum"].includes(rosterToken(v)));
          if (person >= 0 || badge >= 0) { badgeColumn = person >= 0 ? person : badge; continue; }
          if (badgeColumn < 0) continue;
          const cell = ws[XLSX.utils.encode_cell({ r, c: badgeColumn })];
          if (typeof cell?.v === "number" && cell.w && /^0\d+$/.test(cell.w)) row[badgeColumn] = cell.w;
        }
        return { sheet, cells };
      });
    }
    self.postMessage({ result: mode === "spare-status" ? parseSpareSheets(sheets) : parseRosterSheets(sheets, includeNationalId) });
  } catch (error) {
    self.postMessage({ error: event.data.mode === "spare-status" && error instanceof Error ? error.message : "Could not read roster file. Check that it is a valid Excel or CSV file." });
  }
};