import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseRosterSheets } from "./roster-parser";

self.onmessage = async (event: MessageEvent<{ file: File; includeNationalId: boolean }>) => {
  try {
    const { file, includeNationalId } = event.data;
    let sheets: { sheet: string; cells: unknown[][] }[];
    if (file.name.toLowerCase().endsWith(".csv")) {
      sheets = [{ sheet: "csv", cells: Papa.parse<string[]>(await file.text(), { header: false, skipEmptyLines: false }).data }];
    } else {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      sheets = workbook.SheetNames.map(sheet => ({ sheet, cells: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "", raw: true, blankrows: true, range: 0 }) }));
    }
    self.postMessage({ result: parseRosterSheets(sheets, includeNationalId) });
  } catch {
    self.postMessage({ error: "Could not read roster file. Check that it is a valid Excel or CSV file." });
  }
};