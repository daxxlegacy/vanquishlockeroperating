import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle2, AlertCircle, UserMinus, UserCheck, Plus, RefreshCw, Download, Search, Key, Settings2, Layers, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { parseBatchIntake, formatBatchIntake } from "@/lib/locker-utils";
import { normalizeLockerStatus } from "@/lib/locker-status";
import { Progress } from "@/components/ui/progress";
import { pauseLockersRealtime } from "@/lib/lockers-cache";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload Locker Data — LockerOps" },
      { name: "description", content: "Upload locker data file. The system auto-detects columns and syncs records." },
    ],
  }),
  component: () => (<PageGuard permission="page_upload"><UploadPage /></PageGuard>),
});

interface UploadHistoryRow {
  id: string;
  filename: string | null;
  rows_processed: number | null;
  resigned_count: number | null;
  active_count: number | null;
  created_at: string;
}

type LockerRow = {
  locker_number: string;
  location: string;
  row_label: string | null;
  unit_type: string | null;
  key_lock: string | null;
  badge_number: string | null;
  employee_name: string | null;
  status: "active" | "empty" | "repair" | "cleaning" | "broken_door" | "on_hold" | "reserved" | "unknown";
  
  spare_key_status: "available" | "missing" | "with_employee" | "damaged" | "unknown" | "taken" | "taken_for_cleaning";
  remark: string | null;
  batch_intake: string | null;
};

interface SheetReport {
  sheet: string;
  status: "ok" | "skipped";
  reason?: string;
  rowsRead: number;
  lockersFound: number;
}

interface PreviewResult {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  activeAfter: number;
  newlyResigned: { locker_number: string; employee_name: string | null; badge_number: string | null }[];
  parsed: LockerRow[];
  detectedColumns: Record<string, string>;
  sheetReports: SheetReport[];
  duplicatesMerged: number;
}

type RosterPerson = { badge: string | null; name: string | null; rowIndex: number };
type RosterMatchMode = "badge" | "name" | "both";

interface RosterCheckResult {
  filename: string;
  fileCount: number;
  dbCount: number;
  matchMode: RosterMatchMode;
  inFileNotInDb: RosterPerson[];
  inDbNotInFile: { locker_number: string; employee_name: string | null; badge_number: string | null }[];
  badgeMatchedNameDiffers: { badge: string; fileName: string; dbName: string; locker_number: string }[];
  nameMatchedBadgeDiffers: { name: string; fileBadge: string; dbBadge: string; locker_number: string }[];
}

interface MergeConfig {
  preferRowsWithBadgeAndName: boolean;
  preferNewestBatchIntake: boolean;
}

interface NormalizationConfig {
  uppercaseBadge: boolean;
  trimBadge: boolean;
  collapseNameSpaces: boolean;
  uppercaseName: boolean;
}

interface SpareSyncResult {
  filename: string;
  fileCount: number;
  matched: number;
  unmatched: { locker_number: string; status: string }[];
  updates: { locker_number: string; spare_key_status: LockerRow["spare_key_status"]; prevSpare: string | null }[];
}

function UploadPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);
  // Roster check (VLOOKUP-style)
  const [checkFile, setCheckFile] = useState<File | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<RosterCheckResult | null>(null);
  const [matchMode, setMatchMode] = useState<RosterMatchMode>("both");
  // Spare Key sync
  const [spareFile, setSpareFile] = useState<File | null>(null);
  const [spareBusy, setSpareBusy] = useState(false);
  const [spareResult, setSpareResult] = useState<SpareSyncResult | null>(null);
  // Configurable merge & normalization rules
  const [mergeCfg, setMergeCfg] = useState<MergeConfig>({
    preferRowsWithBadgeAndName: true,
    preferNewestBatchIntake: true,
  });
  const [normCfg, setNormCfg] = useState<NormalizationConfig>({
    uppercaseBadge: true,
    trimBadge: true,
    collapseNameSpaces: true,
    uppercaseName: true,
  });

  useEffect(() => {
    if (!loading) {
      if (!user) navigate({ to: "/auth" });
      else if (role && role !== "admin") navigate({ to: "/" });
    }
  }, [user, role, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("upload_history").select("*").order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setHistory((data as UploadHistoryRow[]) ?? []));
  }, [user]);

  const handleFile = async (f: File) => {
    setFile(f);
    setPreview(null);
    setParsing(true);
    try {
      const sheets = await parseFileAllSheets(f);
      if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) {
        toast.error("File is empty.");
        setParsing(false);
        return;
      }

      // Detect columns per sheet. Skip pivot/summary or invalid sheets, with a recorded reason.
      const mergedDetected: Record<string, string> = {};
      const byKey = new Map<string, LockerRow>();
      const sheetReports: SheetReport[] = [];
      let duplicatesMerged = 0;

      for (const { sheet, rows } of sheets) {
        if (rows.length === 0) {
          sheetReports.push({ sheet, status: "skipped", reason: "Empty sheet", rowsRead: 0, lockersFound: 0 });
          continue;
        }
        // Union of headers across the sheet.
        const headerSet = new Set<string>();
        for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) headerSet.add(k);
        const detected = detectColumns([...headerSet]);

        const missing: string[] = [];
        if (!detected.locker_number) missing.push("locker number");
        // Sheets must have at least one of badge or employee name to be useful for matching.
        const hasIdent = !!detected.badge_number || !!detected.employee_name;
        if (!hasIdent) missing.push("badge or employee name");

        if (missing.length > 0) {
          sheetReports.push({
            sheet,
            status: "skipped",
            reason: `Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
            rowsRead: rows.length,
            lockersFound: 0,
          });
          continue;
        }

        for (const [k, v] of Object.entries(detected)) if (!mergedDetected[k]) mergedDetected[k] = `${sheet}: ${v}`;

        let lockersFound = 0;
        for (const r of rows) {
          const row = mapRow(r, detected);
          if (!row) continue;
          // Apply normalization to badge/name early so dedup keys match across sheets.
          row.badge_number = normalizeBadge(row.badge_number, normCfg);
          row.employee_name = normalizeName(row.employee_name, normCfg);

          lockersFound++;
          const key = row.locker_number.trim().toUpperCase();
          const prev = byKey.get(key);
          if (!prev) { byKey.set(key, row); continue; }
          duplicatesMerged++;
          byKey.set(key, mergeLockerRows(prev, row, mergeCfg));
        }
        sheetReports.push({ sheet, status: "ok", rowsRead: rows.length, lockersFound });
      }

      if (byKey.size === 0) {
        toast.error("No usable sheets found. Check the Sheet report for the reason each sheet was skipped.");
        // Still surface the report so the user understands why.
        setPreview({
          totalRows: 0, toCreate: 0, toUpdate: 0, activeAfter: 0,
          newlyResigned: [], parsed: [], detectedColumns: mergedDetected,
          sheetReports, duplicatesMerged: 0,
        });
        setParsing(false);
        return;
      }

      const parsed: LockerRow[] = [...byKey.values()];
      const usedCount = sheetReports.filter((s) => s.status === "ok").length;
      toast.success(`Parsed ${parsed.length.toLocaleString()} lockers from ${usedCount} sheet${usedCount === 1 ? "" : "s"}${duplicatesMerged ? ` (${duplicatesMerged} duplicate${duplicatesMerged === 1 ? "" : "s"} merged)` : ""}.`);

      // Load existing lockers for diff
      const existing: { id: string; locker_number: string; employee_name: string | null; badge_number: string | null; status: string }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("lockers").select("id, locker_number, employee_name, badge_number, status").range(from, from + 999);
        if (!data || data.length === 0) break;
        existing.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }

      const existingMap = new Map(existing.map((l) => [l.locker_number.trim().toUpperCase(), l]));
      const incomingKeys = new Set(parsed.map((p) => p.locker_number.trim().toUpperCase()));

      let toCreate = 0;
      let toUpdate = 0;
      let activeAfter = 0;
      for (const p of parsed) {
        const k = p.locker_number.trim().toUpperCase();
        if (existingMap.has(k)) toUpdate++;
        else toCreate++;
        if (p.status === "active") activeAfter++;
      }

      // Resigned = currently active in DB but not present in upload
      const resigned: PreviewResult["newlyResigned"] = [];
      for (const l of existing) {
        if (l.status === "active" && !incomingKeys.has(l.locker_number.trim().toUpperCase())) {
          resigned.push({ locker_number: l.locker_number, employee_name: l.employee_name, badge_number: l.badge_number });
        }
      }

      setPreview({
        totalRows: parsed.length,
        toCreate,
        toUpdate,
        activeAfter,
        newlyResigned: resigned,
        parsed,
        detectedColumns: mergedDetected,
        sheetReports,
        duplicatesMerged,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
    setParsing(false);
  };

  const handleApply = async () => {
    if (!preview || !file || !user) return;
    setApplying(true);
    const resume = pauseLockersRealtime();
    const totalUnits = preview.parsed.length + preview.newlyResigned.length;
    setApplyProgress({ done: 0, total: totalUnits, phase: "Uploading lockers" });
    let done = 0;
    try {
      const CHUNK = 200;
      for (let i = 0; i < preview.parsed.length; i += CHUNK) {
        const slice = preview.parsed.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lockers")
          .upsert(slice, { onConflict: "locker_number" });
        if (error) throw error;
        done += slice.length;
        setApplyProgress({ done, total: totalUnits, phase: "Uploading lockers" });
      }

      const resignedKeys = preview.newlyResigned.map((r) => r.locker_number);
      for (let i = 0; i < resignedKeys.length; i += CHUNK) {
        const slice = resignedKeys.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lockers")
          .update({ status: "empty", employee_name: null, badge_number: null, remark: "Auto-resigned via upload" })
          .in("locker_number", slice);
        if (error) throw error;
        done += slice.length;
        setApplyProgress({ done, total: totalUnits, phase: "Marking resigned" });
      }

      await supabase.from("upload_history").insert({
        uploaded_by: user.id,
        filename: file.name,
        rows_processed: preview.totalRows,
        resigned_count: preview.newlyResigned.length,
        active_count: preview.activeAfter,
      });
      toast.success(`Sync complete — ${preview.toCreate} created, ${preview.toUpdate} updated, ${preview.newlyResigned.length} freed.`);
      setPreview(null);
      setFile(null);
      const { data } = await supabase.from("upload_history").select("*").order("created_at", { ascending: false }).limit(10);
      setHistory((data as UploadHistoryRow[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    }
    setApplying(false);
    setApplyProgress(null);
    resume(); // single refresh of cache
  };

  const exportLockers = async (fmt: "xlsx" | "csv") => {
    try {
      toast.info("Preparing export…");
      const all: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("locker_number, location, row_label, unit_type, key_lock, badge_number, employee_name, status, spare_key_status, remark, batch_intake, deleted_at, created_at, updated_at")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      const cleaned = all.map((r) => ({
        ...r,
        batch_intake: typeof r.batch_intake === "string" ? formatBatchIntake(r.batch_intake) : r.batch_intake,
      }));
      const stamp = new Date().toISOString().slice(0, 10);
      if (fmt === "csv") {
        const csv = Papa.unparse(cleaned);
        downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `lockers-${stamp}.csv`);
      } else {
        const ws = XLSX.utils.json_to_sheet(cleaned);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Lockers");
        const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
        downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `lockers-${stamp}.xlsx`);
      }
      toast.success(`Exported ${cleaned.length.toLocaleString()} lockers.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  };

  const runSpareKeySync = async (f: File, apply: boolean) => {
    setSpareBusy(true);
    if (!apply) setSpareResult(null);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const allRows: Record<string, unknown>[] = [];
      for (const sn of wb.SheetNames) {
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sn], { defval: "", raw: true });
        allRows.push(...json);
      }
      if (allRows.length === 0) { toast.error("Spare key file is empty."); setSpareBusy(false); return; }

      const detected = detectColumns(Object.keys(allRows[0]));
      const lockerKey = detected.locker_number;
      const physKey = detected.physical_key_status;
      const spareKey = detected.spare_key_status ?? detected.status;
      if (!lockerKey) {
        toast.error("Couldn't find a locker column (e.g. 'Combine Locker').");
        setSpareBusy(false);
        return;
      }

      const incoming = new Map<string, { spare: LockerRow["spare_key_status"] }>();
      for (const r of allRows) {
        const ln = getStr(r, lockerKey);
        if (!ln) continue;
        const spareRaw = spareKey ? getStr(r, spareKey) : null;
        const physRaw = physKey ? getStr(r, physKey) : null;
        // Sheet "Status" col = "Spare Key" (presence). Fall back to the physical-key column for the live state.
        const physMapped = mapKeyStatus(physRaw);
        const hasSpareMarker = !!spareRaw && spareRaw.toLowerCase().includes("spare");
        const spare: LockerRow["spare_key_status"] = hasSpareMarker ? physMapped : mapKeyStatus(spareRaw);
        incoming.set(ln.trim().toUpperCase(), { spare });
      }

      const dbLockers: { locker_number: string; spare_key_status: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("lockers")
          .select("locker_number, spare_key_status")
          .is("deleted_at", null)
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        dbLockers.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      const dbMap = new Map(dbLockers.map((l) => [l.locker_number.trim().toUpperCase(), l]));

      const updates: SpareSyncResult["updates"] = [];
      const unmatched: SpareSyncResult["unmatched"] = [];
      for (const [ln, v] of incoming) {
        const db = dbMap.get(ln);
        if (!db) { unmatched.push({ locker_number: ln, status: "not in DB" }); continue; }
        updates.push({
          locker_number: db.locker_number,
          spare_key_status: v.spare,
          prevSpare: db.spare_key_status,
        });
      }

      if (apply) {
        const resume = pauseLockersRealtime();
        try {
          for (const u of updates) {
            const { error } = await supabase.from("lockers")
              .update({ spare_key_status: u.spare_key_status })
              .eq("locker_number", u.locker_number);
            if (error) throw error;
          }
          const incomingKeys = new Set(incoming.keys());
          const noSpare = dbLockers
            .filter((l) => !incomingKeys.has(l.locker_number.trim().toUpperCase()) && l.spare_key_status !== "missing")
            .map((l) => l.locker_number);
          for (let i = 0; i < noSpare.length; i += 500) {
            const slice = noSpare.slice(i, i + 500);
            const { error } = await supabase.from("lockers").update({ spare_key_status: "missing" }).in("locker_number", slice);
            if (error) throw error;
          }
          toast.success(`Spare keys synced — ${updates.length} updated, ${noSpare.length} marked missing.`);
          setSpareResult(null);
          setSpareFile(null);
        } finally {
          resume();
        }
      } else {
        setSpareResult({ filename: f.name, fileCount: incoming.size, matched: updates.length, unmatched, updates });
        toast.success(`Preview — ${updates.length} matched, ${unmatched.length} not in DB.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Spare key sync failed");
    }
    setSpareBusy(false);
  };

  const runRosterCheck = async (f: File) => {
    setCheckBusy(true);
    setCheckResult(null);
    try {
      // Read every sheet in the roster file so multi-sheet workbooks are supported.
      const sheets = await parseFileAllSheets(f);
      const allRows: Record<string, unknown>[] = [];
      for (const { rows } of sheets) allRows.push(...rows);
      if (allRows.length === 0) { toast.error("Roster file is empty."); setCheckBusy(false); return; }

      // Detect across the union of headers in all sheets.
      const headerSet = new Set<string>();
      for (const r of allRows.slice(0, 200)) for (const k of Object.keys(r)) headerSet.add(k);
      const detected = detectColumns([...headerSet]);
      const badgeKey = detected.badge_number;
      const nameKey = detected.employee_name;

      if (matchMode === "badge" && !badgeKey) {
        toast.error("Match mode is 'Badge' but no badge column was found.");
        setCheckBusy(false);
        return;
      }
      if (matchMode === "name" && !nameKey) {
        toast.error("Match mode is 'Name' but no employee name column was found.");
        setCheckBusy(false);
        return;
      }
      if (!badgeKey && !nameKey) {
        toast.error("Couldn't find a badge or name column in the file.");
        setCheckBusy(false);
        return;
      }

      const peopleInFile: RosterPerson[] = [];
      const fileBadges = new Set<string>();
      const fileNames = new Set<string>();
      let rowIdx = 0;
      for (const r of allRows) {
        rowIdx++;
        const badge = normalizeBadge(badgeKey ? getStr(r, badgeKey) : null, normCfg);
        const name = normalizeName(nameKey ? getStr(r, nameKey) : null, normCfg);
        if (!badge && !name) continue;
        peopleInFile.push({ badge, name, rowIndex: rowIdx });
        if (badge) fileBadges.add(badgeKeyOf(badge, normCfg));
        if (name) fileNames.add(nameKeyOf(name, normCfg));
      }

      const dbPeople: { locker_number: string; employee_name: string | null; badge_number: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("locker_number, employee_name, badge_number")
          .is("deleted_at", null)
          .or("employee_name.not.is.null,badge_number.not.is.null")
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        dbPeople.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }

      const dbByBadge = new Map<string, typeof dbPeople[number]>();
      const dbByName = new Map<string, typeof dbPeople[number]>();
      for (const p of dbPeople) {
        if (p.badge_number) dbByBadge.set(badgeKeyOf(p.badge_number, normCfg), p);
        if (p.employee_name) dbByName.set(nameKeyOf(p.employee_name, normCfg), p);
      }

      const inFileNotInDb: RosterPerson[] = [];
      const badgeMatchedNameDiffers: RosterCheckResult["badgeMatchedNameDiffers"] = [];
      const nameMatchedBadgeDiffers: RosterCheckResult["nameMatchedBadgeDiffers"] = [];

      for (const p of peopleInFile) {
        const bMatch = p.badge ? dbByBadge.get(badgeKeyOf(p.badge, normCfg)) : undefined;
        const nMatch = p.name ? dbByName.get(nameKeyOf(p.name, normCfg)) : undefined;

        // "Not in DB" depends on the selected match mode.
        let consideredMatched: boolean;
        if (matchMode === "badge") consideredMatched = !!bMatch;
        else if (matchMode === "name") consideredMatched = !!nMatch;
        else consideredMatched = !!bMatch || !!nMatch;
        if (!consideredMatched) inFileNotInDb.push(p);

        // Partial-match diagnostics are always computed when both columns exist.
        if (bMatch && p.name && bMatch.employee_name &&
            nameKeyOf(bMatch.employee_name, normCfg) !== nameKeyOf(p.name, normCfg)) {
          badgeMatchedNameDiffers.push({
            badge: p.badge!, fileName: p.name, dbName: bMatch.employee_name, locker_number: bMatch.locker_number,
          });
        }
        if (nMatch && p.badge && nMatch.badge_number &&
            badgeKeyOf(nMatch.badge_number, normCfg) !== badgeKeyOf(p.badge, normCfg)) {
          nameMatchedBadgeDiffers.push({
            name: p.name!, fileBadge: p.badge, dbBadge: nMatch.badge_number, locker_number: nMatch.locker_number,
          });
        }
      }

      const inDbNotInFile = dbPeople.filter((p) => {
        const badgeIn = p.badge_number && fileBadges.has(badgeKeyOf(p.badge_number, normCfg));
        const nameIn = p.employee_name && fileNames.has(nameKeyOf(p.employee_name, normCfg));
        if (matchMode === "badge") return !badgeIn;
        if (matchMode === "name") return !nameIn;
        return !badgeIn && !nameIn;
      });

      setCheckResult({
        filename: f.name,
        fileCount: peopleInFile.length,
        dbCount: dbPeople.length,
        matchMode,
        inFileNotInDb,
        inDbNotInFile,
        badgeMatchedNameDiffers,
        nameMatchedBadgeDiffers,
      });
      toast.success(`Roster compared — ${inFileNotInDb.length} not in DB, ${inDbNotInFile.length} not in file.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Roster check failed");
    }
    setCheckBusy(false);
  };

  const exportRosterCheck = (fmt: "xlsx" | "csv") => {
    if (!checkResult) return;
    const sheets: Record<string, Record<string, unknown>[]> = {
      "In file NOT in DB": checkResult.inFileNotInDb.map((p) => ({ badge: p.badge ?? "", name: p.name ?? "" })),
      "In DB NOT in file": checkResult.inDbNotInFile.map((p) => ({
        locker_number: p.locker_number,
        badge: p.badge_number ?? "",
        name: p.employee_name ?? "",
      })),
      "Badge matched, name differs": checkResult.badgeMatchedNameDiffers as unknown as Record<string, unknown>[],
    };
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === "csv") {
      const csv = Papa.unparse([
        ...checkResult.inFileNotInDb.map((p) => ({ section: "in_file_not_in_db", locker_number: "", badge: p.badge ?? "", name: p.name ?? "" })),
        ...checkResult.inDbNotInFile.map((p) => ({ section: "in_db_not_in_file", locker_number: p.locker_number, badge: p.badge_number ?? "", name: p.employee_name ?? "" })),
        ...checkResult.badgeMatchedNameDiffers.map((p) => ({ section: "badge_matched_name_differs", locker_number: p.locker_number, badge: p.badge, name: `${p.fileName} (file) / ${p.dbName} (db)` })),
      ]);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `roster-check-${stamp}.csv`);
    } else {
      const wb = XLSX.utils.book_new();
      for (const [name, rows] of Object.entries(sheets)) {
        const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ note: "(empty)" }]);
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      }
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `roster-check-${stamp}.xlsx`);
    }
    toast.success("Roster check exported.");
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="font-display text-3xl font-bold">Upload Locker Data</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sync locker assignments, run roster checks, or update spare-key status from spreadsheets.
        </p>

        <Tabs defaultValue="roster" className="mt-6">
          <TabsList>
            <TabsTrigger value="roster"><UploadIcon className="h-4 w-4 mr-1.5" /> Roster Sync</TabsTrigger>
            <TabsTrigger value="check"><Search className="h-4 w-4 mr-1.5" /> Roster Check</TabsTrigger>
            <TabsTrigger value="spare"><Key className="h-4 w-4 mr-1.5" /> Spare Key</TabsTrigger>
            <TabsTrigger value="history"><FileSpreadsheet className="h-4 w-4 mr-1.5" /> History</TabsTrigger>
          </TabsList>

          <TabsContent value="roster" className="space-y-6">

        <Card className="mt-6 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <Label htmlFor="file" className="text-base font-display">Choose file</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Recognized columns: <code className="bg-muted px-1 py-0.5 rounded text-xs">Combine Locker</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Locker Location by Row</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Types of Key Lock</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">badge_number</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Vlookup O+C Name</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Status</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Status Available / Not Available</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Physical Key Status</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Remarks</code>, <code className="bg-muted px-1 py-0.5 rounded text-xs">Batch Intake</code>.
              </p>
              <div className="flex gap-3 items-center">
                <Input id="file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="cursor-pointer" />
                {parsing && <Badge variant="secondary">Parsing…</Badge>}
              </div>
            </div>
            <div className="flex flex-col gap-2 min-w-[180px]">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Export current data</Label>
              <Button variant="outline" size="sm" onClick={() => exportLockers("xlsx")}>
                <Download className="h-4 w-4 mr-1" /> Export as Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportLockers("csv")}>
                <Download className="h-4 w-4 mr-1" /> Export as CSV
              </Button>
            </div>
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="h-4 w-4 text-primary" />
            <h3 className="font-display text-sm font-bold uppercase tracking-wide">Merge & normalization rules</h3>
          </div>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <ToggleRow
              label="Prefer rows with badge + name"
              hint="When the same locker appears more than once, keep the row that has both fields filled."
              checked={mergeCfg.preferRowsWithBadgeAndName}
              onChange={(v) => setMergeCfg((c) => ({ ...c, preferRowsWithBadgeAndName: v }))}
            />
            <ToggleRow
              label="Prefer newest batch intake"
              hint="Tie-breaker — keep the assignment whose Batch Intake date is more recent."
              checked={mergeCfg.preferNewestBatchIntake}
              onChange={(v) => setMergeCfg((c) => ({ ...c, preferNewestBatchIntake: v }))}
            />
            <ToggleRow
              label="Trim & strip spaces in badge"
              hint='So "10 059 113" matches "10059113".'
              checked={normCfg.trimBadge}
              onChange={(v) => setNormCfg((c) => ({ ...c, trimBadge: v }))}
            />
            <ToggleRow
              label="Uppercase badge"
              hint='So "cs2869" matches "CS2869".'
              checked={normCfg.uppercaseBadge}
              onChange={(v) => setNormCfg((c) => ({ ...c, uppercaseBadge: v }))}
            />
            <ToggleRow
              label="Collapse extra spaces in name"
              hint='So "John  Doe" matches "John Doe".'
              checked={normCfg.collapseNameSpaces}
              onChange={(v) => setNormCfg((c) => ({ ...c, collapseNameSpaces: v }))}
            />
            <ToggleRow
              label="Uppercase employee name"
              hint='Case-insensitive matching of names.'
              checked={normCfg.uppercaseName}
              onChange={(v) => setNormCfg((c) => ({ ...c, uppercaseName: v }))}
            />
          </div>
        </Card>

        {preview && (
          <Card className="mt-6 p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Preview: {file?.name}</h2>
            </div>

            <div className="grid md:grid-cols-4 gap-3 mb-4">
              <Stat icon={UploadIcon} label="Rows in file" value={preview.totalRows} />
              <Stat icon={Plus} label="New lockers" value={preview.toCreate} accent="text-success" />
              <Stat icon={RefreshCw} label="Updates" value={preview.toUpdate} accent="text-primary" />
              <Stat icon={UserMinus} label="To resign" value={preview.newlyResigned.length} accent="text-destructive" />
            </div>

            <div className="grid md:grid-cols-3 gap-3 mb-4">
              <Stat icon={Layers} label="Sheets read" value={preview.sheetReports.filter((s) => s.status === "ok").length} />
              <Stat icon={FileSpreadsheet} label="Sheets skipped" value={preview.sheetReports.filter((s) => s.status === "skipped").length} accent="text-warning" />
              <Stat icon={GitMerge} label="Duplicates merged" value={preview.duplicatesMerged} accent="text-primary" />
            </div>

            <details className="mb-4 rounded-md border" open={preview.sheetReports.some((s) => s.status === "skipped")}>
              <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30 text-sm">
                Sheet report ({preview.sheetReports.length})
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30"><tr><Th>Sheet</Th><Th>Status</Th><Th>Rows</Th><Th>Lockers</Th><Th>Notes</Th></tr></thead>
                  <tbody>
                    {preview.sheetReports.map((s) => (
                      <tr key={s.sheet} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{s.sheet}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant={s.status === "ok" ? "outline" : "secondary"} className={s.status === "ok" ? "border-success text-success" : "border-warning text-warning"}>
                            {s.status === "ok" ? "Used" : "Skipped"}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{s.rowsRead.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{s.lockersFound.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{s.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="mb-4 rounded-md border p-3 bg-muted/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Detected column mapping</div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(preview.detectedColumns).map(([k, v]) => (
                  <div key={k}><span className="font-mono text-muted-foreground">{k}</span> ← <span className="font-medium">{v}</span></div>
                ))}
              </div>
            </div>

            {preview.newlyResigned.length > 0 ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{preview.newlyResigned.length} active locker(s) will be freed</AlertTitle>
                <AlertDescription>
                  These lockers are active in the system but missing from the upload. They will be set to <strong>empty</strong>.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="mb-4">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>No resignations detected</AlertTitle>
                <AlertDescription>All currently active lockers are present in the upload.</AlertDescription>
              </Alert>
            )}

            {preview.newlyResigned.length > 0 && (
              <div className="border rounded-md max-h-60 overflow-y-auto mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr><Th>Locker</Th><Th>Employee</Th><Th>Badge</Th></tr>
                  </thead>
                  <tbody>
                    {preview.newlyResigned.slice(0, 200).map((r) => (
                      <tr key={r.locker_number} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.locker_number}</td>
                        <td className="px-3 py-2">{r.employee_name ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.badge_number ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.newlyResigned.length > 200 && <div className="p-2 text-xs text-center text-muted-foreground border-t">… and {preview.newlyResigned.length - 200} more</div>}
              </div>
            )}

            <div className="border rounded-md max-h-72 overflow-auto mb-4">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr><Th>Locker</Th><Th>Location</Th><Th>Badge</Th><Th>Name</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {preview.parsed.slice(0, 50).map((p) => (
                    <tr key={p.locker_number} className="border-t">
                      <td className="px-3 py-2 font-medium">{p.locker_number}</td>
                      <td className="px-3 py-2">{p.location}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.badge_number ?? "—"}</td>
                      <td className="px-3 py-2">{p.employee_name ?? "—"}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.parsed.length > 50 && <div className="p-2 text-xs text-center text-muted-foreground border-t">Showing 50 of {preview.parsed.length} rows</div>}
            </div>

            {applyProgress && (
              <div className="mb-3 space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{applyProgress.phase}…</span>
                  <span>
                    {applyProgress.done.toLocaleString()} / {applyProgress.total.toLocaleString()}
                    {applyProgress.total > 0 && ` (${Math.round((applyProgress.done / applyProgress.total) * 100)}%)`}
                  </span>
                </div>
                <Progress value={applyProgress.total ? (applyProgress.done / applyProgress.total) * 100 : 0} />
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setPreview(null); setFile(null); }} disabled={applying}>Cancel</Button>
              <Button onClick={handleApply} disabled={applying}>
                {applying ? "Applying…" : "Apply changes"}
              </Button>
            </div>
          </Card>
        )}
        </TabsContent>

        <TabsContent value="check" className="space-y-6">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Search className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Roster check (VLOOKUP)</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Upload a roster Excel/CSV with badge numbers and/or names. We'll compare it to the locker database and show:
            people in the file but missing from the DB, people assigned to lockers but missing from the file, and partial matches.
            Nothing is changed — this is a report.
          </p>

          <div className="mb-4 rounded-md border p-3 bg-muted/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Match by</div>
            <RadioGroup
              value={matchMode}
              onValueChange={(v) => setMatchMode(v as RosterMatchMode)}
              className="flex flex-wrap gap-4 text-sm"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="badge" id="mm-badge" /> Badge only
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="name" id="mm-name" /> Employee name only
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="both" id="mm-both" /> Either badge or name
              </label>
            </RadioGroup>
          </div>

          <div className="flex gap-3 items-center flex-wrap">
            <Input type="file" accept=".csv,.xlsx,.xls" className="cursor-pointer max-w-sm"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCheckFile(f); runRosterCheck(f); } }} />
            {checkBusy && <Badge variant="secondary">Comparing…</Badge>}
            {checkFile && !checkBusy && <span className="text-xs text-muted-foreground">{checkFile.name}</span>}
            {checkFile && !checkBusy && (
              <Button variant="outline" size="sm" onClick={() => runRosterCheck(checkFile)}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-run with current settings
              </Button>
            )}
          </div>

          {checkResult && (
            <div className="mt-5 space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <Stat icon={UserCheck} label="People in file" value={checkResult.fileCount} />
                <Stat icon={UserMinus} label="In file, NOT in DB" value={checkResult.inFileNotInDb.length} accent="text-warning" />
                <Stat icon={UserMinus} label="In DB, NOT in file" value={checkResult.inDbNotInFile.length} accent="text-destructive" />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => exportRosterCheck("xlsx")}>
                  <Download className="h-4 w-4 mr-1" /> Export Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportRosterCheck("csv")}>
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
              </div>

              <details open className="rounded-md border">
                <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30">
                  In file but NOT in DB ({checkResult.inFileNotInDb.length})
                </summary>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0"><tr><Th>Badge</Th><Th>Name</Th></tr></thead>
                    <tbody>
                      {checkResult.inFileNotInDb.slice(0, 200).map((p, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{p.badge ?? "—"}</td>
                          <td className="px-3 py-1.5">{p.name ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {checkResult.inFileNotInDb.length > 200 && (
                    <div className="p-2 text-xs text-center text-muted-foreground border-t">… and {checkResult.inFileNotInDb.length - 200} more</div>
                  )}
                </div>
              </details>

              <details open className="rounded-md border">
                <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30">
                  Assigned in DB but NOT in file ({checkResult.inDbNotInFile.length})
                </summary>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0"><tr><Th>Locker</Th><Th>Badge</Th><Th>Name</Th></tr></thead>
                    <tbody>
                      {checkResult.inDbNotInFile.slice(0, 200).map((p) => (
                        <tr key={p.locker_number} className="border-t">
                          <td className="px-3 py-1.5 font-medium">{p.locker_number}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.badge_number ?? "—"}</td>
                          <td className="px-3 py-1.5">{p.employee_name ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {checkResult.inDbNotInFile.length > 200 && (
                    <div className="p-2 text-xs text-center text-muted-foreground border-t">… and {checkResult.inDbNotInFile.length - 200} more</div>
                  )}
                </div>
              </details>

              {checkResult.badgeMatchedNameDiffers.length > 0 && (
                <details className="rounded-md border">
                  <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30">
                    Badge matched but name differs ({checkResult.badgeMatchedNameDiffers.length})
                  </summary>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0"><tr><Th>Badge</Th><Th>Locker</Th><Th>Name in file</Th><Th>Name in DB</Th></tr></thead>
                      <tbody>
                        {checkResult.badgeMatchedNameDiffers.map((p, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5 font-mono">{p.badge}</td>
                            <td className="px-3 py-1.5 font-medium">{p.locker_number}</td>
                            <td className="px-3 py-1.5">{p.fileName}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{p.dbName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {checkResult.nameMatchedBadgeDiffers.length > 0 && (
                <details className="rounded-md border">
                  <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30">
                    Name matched but badge differs ({checkResult.nameMatchedBadgeDiffers.length})
                  </summary>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0"><tr><Th>Name</Th><Th>Locker</Th><Th>Badge in file</Th><Th>Badge in DB</Th></tr></thead>
                      <tbody>
                        {checkResult.nameMatchedBadgeDiffers.map((p, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5">{p.name}</td>
                            <td className="px-3 py-1.5 font-medium">{p.locker_number}</td>
                            <td className="px-3 py-1.5 font-mono">{p.fileBadge}</td>
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.dbBadge}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}
        </Card>
        </TabsContent>

        <TabsContent value="spare" className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Key className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Spare key sync</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Upload your <code className="bg-muted px-1 rounded">Spare_Key_Physical.xlsx</code> (multiple sheets supported). The system matches by <code className="bg-muted px-1 rounded">Combine Locker</code> and updates each locker's <strong>Spare Key Status</strong>. Lockers not listed are marked spare-key <em>missing</em>.
            </p>
            <div className="flex gap-3 items-center flex-wrap">
              <Input type="file" accept=".csv,.xlsx,.xls" className="cursor-pointer max-w-sm"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setSpareFile(f); runSpareKeySync(f, false); } }} />
              {spareBusy && <Badge variant="secondary">Working…</Badge>}
              {spareFile && !spareBusy && <span className="text-xs text-muted-foreground">{spareFile.name}</span>}
            </div>

            {spareResult && (
              <div className="mt-5 space-y-4">
                <div className="grid md:grid-cols-3 gap-3">
                  <Stat icon={Key} label="Lockers in file" value={spareResult.fileCount} />
                  <Stat icon={CheckCircle2} label="Matched in DB" value={spareResult.matched} accent="text-success" />
                  <Stat icon={AlertCircle} label="Not in DB" value={spareResult.unmatched.length} accent="text-warning" />
                </div>

                <div className="border rounded-md max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0"><tr><Th>Locker</Th><Th>Spare key</Th><Th>Was</Th></tr></thead>
                    <tbody>
                      {spareResult.updates.slice(0, 200).map((u) => (
                        <tr key={u.locker_number} className="border-t">
                          <td className="px-3 py-1.5 font-medium">{u.locker_number}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline">{u.spare_key_status}</Badge></td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{u.prevSpare ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {spareResult.updates.length > 200 && <div className="p-2 text-xs text-center text-muted-foreground border-t">… and {spareResult.updates.length - 200} more</div>}
                </div>

                {spareResult.unmatched.length > 0 && (
                  <details className="rounded-md border">
                    <summary className="px-3 py-2 cursor-pointer font-medium bg-muted/30">Not found in DB ({spareResult.unmatched.length})</summary>
                    <div className="max-h-48 overflow-auto p-3 text-xs font-mono">
                      {spareResult.unmatched.map((u) => u.locker_number).join(", ")}
                    </div>
                  </details>
                )}

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setSpareResult(null); setSpareFile(null); }}>Cancel</Button>
                  <Button onClick={() => spareFile && runSpareKeySync(spareFile, true)} disabled={spareBusy}>
                    {spareBusy ? "Applying…" : "Apply spare key sync"}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card className="p-6">
            <h2 className="font-display text-xl font-bold mb-4">Upload history</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No uploads yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left">
                    <tr><Th>Date</Th><Th>File</Th><Th>Rows</Th><Th>Active</Th><Th>Resigned</Th></tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t">
                        <td className="px-3 py-2">{new Date(h.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2">{h.filename}</td>
                        <td className="px-3 py-2">{h.rows_processed}</td>
                        <td className="px-3 py-2 text-success">{h.active_count}</td>
                        <td className="px-3 py-2 text-destructive">{h.resigned_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold text-xs uppercase tracking-wide text-muted-foreground text-left">{children}</th>;
}

function Stat({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; accent?: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <Icon className={`h-7 w-7 ${accent ?? "text-muted-foreground"}`} />
      <div>
        <div className="text-2xl font-bold font-display">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="flex-1">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

// ---------- helpers ----------
async function parseFile(f: File): Promise<Record<string, unknown>[]> {
  const sheets = await parseFileAllSheets(f);
  return sheets.flatMap((s) => s.rows);
}

async function parseFileAllSheets(f: File): Promise<{ sheet: string; rows: Record<string, unknown>[] }[]> {
  const ext = f.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data as Record<string, unknown>[]),
        error: (err) => reject(err),
      });
    });
    return [{ sheet: "csv", rows }];
  }
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  return wb.SheetNames.map((sn) => ({
    sheet: sn,
    rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sn], { defval: "", raw: true }),
  }));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-/+()]/g, "");
}

// ---------- Normalization & merge helpers ----------
function normalizeBadge(raw: string | null | undefined, cfg: NormalizationConfig): string | null {
  if (raw == null) return null;
  let s = String(raw);
  if (cfg.trimBadge) s = s.trim().replace(/\s+/g, "");
  if (cfg.uppercaseBadge) s = s.toUpperCase();
  return s === "" ? null : s;
}

function normalizeName(raw: string | null | undefined, cfg: NormalizationConfig): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (cfg.collapseNameSpaces) s = s.replace(/\s+/g, " ");
  if (cfg.uppercaseName) s = s.toUpperCase();
  return s === "" ? null : s;
}

// Lookup keys are always aggressively normalized so matching is reliable
// regardless of the user's display normalization toggles.
function badgeKeyOf(raw: string | null | undefined, _cfg: NormalizationConfig): string {
  return String(raw ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function nameKeyOf(raw: string | null | undefined, _cfg: NormalizationConfig): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

// Try to parse our stored batch_intake (string) back to a comparable timestamp.
function batchIntakeTs(b: string | null): number {
  if (!b) return -Infinity;
  // ISO yyyy-mm-dd
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(b);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  // dd/mm/yyyy
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(b);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const t = Date.parse(b);
  return Number.isFinite(t) ? t : -Infinity;
}

function mergeLockerRows(a: LockerRow, b: LockerRow, cfg: MergeConfig): LockerRow {
  // Score each candidate; higher score wins. Tie-breaker: newest batch_intake.
  const score = (r: LockerRow) => {
    let s = 0;
    if (cfg.preferRowsWithBadgeAndName) {
      if (r.badge_number && r.employee_name) s += 10;
      else if (r.badge_number || r.employee_name) s += 5;
    }
    if (r.status === "active") s += 2;
    if (r.spare_key_status !== "unknown") s += 1;
    return s;
  };
  const sa = score(a);
  const sb = score(b);
  let winner: LockerRow;
  let loser: LockerRow;
  if (sa !== sb) { winner = sa > sb ? a : b; loser = winner === a ? b : a; }
  else if (cfg.preferNewestBatchIntake) {
    winner = batchIntakeTs(a.batch_intake) >= batchIntakeTs(b.batch_intake) ? a : b;
    loser = winner === a ? b : a;
  } else { winner = a; loser = b; }

  return {
    ...winner,
    badge_number: winner.badge_number ?? loser.badge_number,
    employee_name: winner.employee_name ?? loser.employee_name,
    row_label: winner.row_label ?? loser.row_label,
    unit_type: winner.unit_type ?? loser.unit_type,
    key_lock: winner.key_lock ?? loser.key_lock,
    location: winner.location !== "Unassigned" ? winner.location : loser.location,
    remark: winner.remark ?? loser.remark,
    batch_intake: cfg.preferNewestBatchIntake
      ? (batchIntakeTs(winner.batch_intake) >= batchIntakeTs(loser.batch_intake) ? winner.batch_intake : loser.batch_intake)
      : (winner.batch_intake ?? loser.batch_intake),
    spare_key_status: winner.spare_key_status !== "unknown" ? winner.spare_key_status : loser.spare_key_status,
  };
}


// Maps our internal field → matching column header from the file
function detectColumns(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const aliases: Record<string, string[]> = {
    locker_number: ["combinelocker", "comblocker", "lockernumber", "locker", "lockerno", "lockerid"],
    location: ["lockerlocation", "lockerlocationbyrow", "location"],
    row_label: ["row", "rowlabel", "lockerlocationbyrow"],
    unit_type: ["typesofkeylock", "unittype", "type", "lockertype"],
    key_lock: ["keylock", "typesofkeylock", "lock"],
    badge_number: [
      "badgenumber", "badge", "badgeno", "badgeid",
      "vlookupocempnum", "vlookupempnum", "empnum", "employeenumber", "personnumber",
      "employeecode", "empcode", "employeeid", "empid", "staffid",
      "legacyid", "legacy",
    ],
    employee_name: [
      "vlookupocname", "ocname",
      "employeename", "name", "fullname",
      "legalfullname", "legalname",
    ],
    status: ["status"],
    physical_key_status: ["physicalkeystatus", "physicalkey", "statusavailablenotavailable", "statusavailable"],
    spare_key_status: ["sparekeystatus", "sparekey"],
    remark: ["remarks", "remark", "notes", "note"],
    batch_intake: ["batchintake", "batch", "intake", "intakedate"],
  };

  // Fields that should match by substring (flexible) vs exact normalized header.
  const substringFields = new Set(["badge_number", "employee_name"]);

  for (const [field, opts] of Object.entries(aliases)) {
    for (const h of headers) {
      const n = norm(h);
      const hit = substringFields.has(field)
        ? opts.some((o) => n.includes(o))
        : opts.includes(n);
      if (hit) {
        out[field] = h;
        break;
      }
    }
  }
  return out;
}

function getStr(row: Record<string, unknown>, key: string | undefined): string | null {
  if (!key) return null;
  const v = row[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapStatus(raw: string | null, hasBadge: boolean): LockerRow["status"] {
  return normalizeLockerStatus(raw, hasBadge) as LockerRow["status"];
}

function mapKeyStatus(raw: string | null): LockerRow["spare_key_status"] {
  if (!raw) return "unknown";
  const n = raw.toLowerCase();
  if (n.includes("clean")) return "taken_for_cleaning";
  if (n.includes("not available") || n.includes("missing")) return "missing";
  if (n.includes("with employee") || n.includes("withemp")) return "with_employee";
  if (n.includes("damage")) return "damaged";
  if (n.includes("taken")) return "taken";
  if (n.includes("spare")) return "available";
  if (n.includes("available") || n.includes("ok") || n.includes("yes")) return "available";
  return "unknown";
}

function mapRow(row: Record<string, unknown>, cols: Record<string, string>): LockerRow | null {
  const locker_number = getStr(row, cols.locker_number);
  if (!locker_number) return null;

  const badge_number = getStr(row, cols.badge_number);
  const employee_name = getStr(row, cols.employee_name);
  const statusRaw = getStr(row, cols.status);

  const hasBadge = !!badge_number;
  const status = mapStatus(statusRaw, hasBadge);
  const location = getStr(row, cols.location) ?? "Unassigned";

  return {
    locker_number,
    location,
    row_label: getStr(row, cols.row_label),
    unit_type: getStr(row, cols.unit_type),
    key_lock: getStr(row, cols.key_lock),
    badge_number,
    employee_name,
    status,
    spare_key_status: mapKeyStatus(getStr(row, cols.spare_key_status)),
    remark: getStr(row, cols.remark),
    batch_intake: cols.batch_intake ? parseBatchIntake(row[cols.batch_intake]) : null,
  };
}
