import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle2, AlertCircle, UserMinus, UserCheck, Plus, RefreshCw, Download, Search, Key } from "lucide-react";
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
  component: UploadPage,
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
  physical_key_status: "available" | "missing" | "with_employee" | "damaged" | "unknown" | "taken" | "taken_for_cleaning";
  spare_key_status: "available" | "missing" | "with_employee" | "damaged" | "unknown" | "taken" | "taken_for_cleaning";
  remark: string | null;
  batch_intake: string | null;
};

interface PreviewResult {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  activeAfter: number;
  newlyResigned: { locker_number: string; employee_name: string | null; badge_number: string | null }[];
  parsed: LockerRow[];
  detectedColumns: Record<string, string>;
}

type RosterPerson = { badge: string | null; name: string | null };
interface RosterCheckResult {
  filename: string;
  fileCount: number;
  dbCount: number;
  inFileNotInDb: RosterPerson[];   // employees on the uploaded list with no badge/name match in DB
  inDbNotInFile: { locker_number: string; employee_name: string | null; badge_number: string | null }[];
  badgeMatchedNameDiffers: { badge: string; fileName: string; dbName: string; locker_number: string }[];
}

interface SpareSyncResult {
  filename: string;
  fileCount: number;
  matched: number;
  unmatched: { locker_number: string; status: string }[];
  updates: { locker_number: string; spare_key_status: LockerRow["spare_key_status"]; physical_key_status: LockerRow["physical_key_status"]; prevSpare: string | null; prevPhys: string | null }[];
}

function UploadPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);
  // Roster check (VLOOKUP-style)
  const [checkFile, setCheckFile] = useState<File | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<RosterCheckResult | null>(null);
  // Spare Key sync
  const [spareFile, setSpareFile] = useState<File | null>(null);
  const [spareBusy, setSpareBusy] = useState(false);
  const [spareResult, setSpareResult] = useState<SpareSyncResult | null>(null);

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
      const rows = await parseFile(f);
      if (rows.length === 0) {
        toast.error("File is empty.");
        setParsing(false);
        return;
      }

      const detected = detectColumns(Object.keys(rows[0]));
      if (!detected.locker_number) {
        toast.error("Couldn't find a locker column. Expected something like 'Combine Locker' or 'Locker Number'.");
        setParsing(false);
        return;
      }

      const parsed: LockerRow[] = [];
      for (const r of rows) {
        const row = mapRow(r, detected);
        if (row) parsed.push(row);
      }

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
        detectedColumns: detected,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
    setParsing(false);
  };

  const handleApply = async () => {
    if (!preview || !file || !user) return;
    setApplying(true);
    try {
      // Upsert rows in chunks
      const CHUNK = 200;
      for (let i = 0; i < preview.parsed.length; i += CHUNK) {
        const slice = preview.parsed.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lockers")
          .upsert(slice, { onConflict: "locker_number" });
        if (error) throw error;
      }

      // Mark resigned lockers (active in DB but missing from upload) as empty
      const resignedKeys = preview.newlyResigned.map((r) => r.locker_number);
      for (let i = 0; i < resignedKeys.length; i += CHUNK) {
        const slice = resignedKeys.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("lockers")
          .update({ status: "empty", employee_name: null, badge_number: null, remark: "Auto-resigned via upload" })
          .in("locker_number", slice);
        if (error) throw error;
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
  };

  const exportLockers = async (fmt: "xlsx" | "csv") => {
    try {
      toast.info("Preparing export…");
      const all: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("locker_number, location, row_label, unit_type, key_lock, badge_number, employee_name, status, physical_key_status, spare_key_status, remark, batch_intake, deleted_at, created_at, updated_at")
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

      const incoming = new Map<string, { spare: LockerRow["spare_key_status"]; phys: LockerRow["physical_key_status"] }>();
      for (const r of allRows) {
        const ln = getStr(r, lockerKey);
        if (!ln) continue;
        const spareRaw = spareKey ? getStr(r, spareKey) : null;
        const physRaw = physKey ? getStr(r, physKey) : null;
        // Sheet "Status" col = "Spare Key" (presence). The "Physicial Key" col carries the live state (Yes/Taken/Taken For Cleaning).
        const phys: LockerRow["physical_key_status"] = mapKeyStatus(physRaw);
        const hasSpareMarker = !!spareRaw && spareRaw.toLowerCase().includes("spare");
        const spare: LockerRow["spare_key_status"] = hasSpareMarker ? phys : mapKeyStatus(spareRaw);
        incoming.set(ln.trim().toUpperCase(), { spare, phys });
      }

      const dbLockers: { locker_number: string; spare_key_status: string | null; physical_key_status: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("lockers")
          .select("locker_number, spare_key_status, physical_key_status")
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
          physical_key_status: v.phys,
          prevSpare: db.spare_key_status,
          prevPhys: db.physical_key_status,
        });
      }

      if (apply) {
        for (const u of updates) {
          const { error } = await supabase.from("lockers")
            .update({ spare_key_status: u.spare_key_status, physical_key_status: u.physical_key_status })
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
      const rows = await parseFile(f);
      if (rows.length === 0) { toast.error("Roster file is empty."); setCheckBusy(false); return; }
      const detected = detectColumns(Object.keys(rows[0]));
      const badgeKey = detected.badge_number;
      const nameKey = detected.employee_name;
      if (!badgeKey && !nameKey) {
        toast.error("Couldn't find a badge or name column in the file.");
        setCheckBusy(false);
        return;
      }

      const peopleInFile: RosterPerson[] = [];
      const fileBadges = new Set<string>();
      const fileNames = new Set<string>();
      for (const r of rows) {
        const badge = badgeKey ? (getStr(r, badgeKey) ?? null) : null;
        const name = nameKey ? (getStr(r, nameKey) ?? null) : null;
        if (!badge && !name) continue;
        peopleInFile.push({ badge, name });
        if (badge) fileBadges.add(badge.toLowerCase().trim());
        if (name) fileNames.add(name.toLowerCase().trim());
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
        if (p.badge_number) dbByBadge.set(p.badge_number.toLowerCase().trim(), p);
        if (p.employee_name) dbByName.set(p.employee_name.toLowerCase().trim(), p);
      }

      const inFileNotInDb: RosterPerson[] = [];
      const badgeMatchedNameDiffers: RosterCheckResult["badgeMatchedNameDiffers"] = [];
      for (const p of peopleInFile) {
        const bMatch = p.badge ? dbByBadge.get(p.badge.toLowerCase().trim()) : undefined;
        const nMatch = p.name ? dbByName.get(p.name.toLowerCase().trim()) : undefined;
        if (!bMatch && !nMatch) inFileNotInDb.push(p);
        if (bMatch && p.name && bMatch.employee_name &&
            bMatch.employee_name.toLowerCase().trim() !== p.name.toLowerCase().trim()) {
          badgeMatchedNameDiffers.push({
            badge: p.badge!,
            fileName: p.name,
            dbName: bMatch.employee_name,
            locker_number: bMatch.locker_number,
          });
        }
      }

      const inDbNotInFile = dbPeople.filter((p) => {
        const badgeIn = p.badge_number && fileBadges.has(p.badge_number.toLowerCase().trim());
        const nameIn = p.employee_name && fileNames.has(p.employee_name.toLowerCase().trim());
        return !badgeIn && !nameIn;
      });

      setCheckResult({
        filename: f.name,
        fileCount: peopleInFile.length,
        dbCount: dbPeople.length,
        inFileNotInDb,
        inDbNotInFile,
        badgeMatchedNameDiffers,
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

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setPreview(null); setFile(null); }}>Cancel</Button>
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
            people in the file but missing from the DB, people assigned to lockers but missing from the file, and badges where the name doesn't match.
            Nothing is changed — this is a report.
          </p>
          <div className="flex gap-3 items-center flex-wrap">
            <Input type="file" accept=".csv,.xlsx,.xls" className="cursor-pointer max-w-sm"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCheckFile(f); runRosterCheck(f); } }} />
            {checkBusy && <Badge variant="secondary">Comparing…</Badge>}
            {checkFile && !checkBusy && <span className="text-xs text-muted-foreground">{checkFile.name}</span>}
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
              Upload your <code className="bg-muted px-1 rounded">Spare_Key_Physical.xlsx</code> (multiple sheets supported). The system matches by <code className="bg-muted px-1 rounded">Combine Locker</code> and updates each locker's <strong>Spare Key Status</strong> and <strong>Physical Key Status</strong>. Lockers not listed are marked spare-key <em>missing</em>.
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
                    <thead className="bg-muted/50 sticky top-0"><tr><Th>Locker</Th><Th>Spare key</Th><Th>Physical key</Th><Th>Was</Th></tr></thead>
                    <tbody>
                      {spareResult.updates.slice(0, 200).map((u) => (
                        <tr key={u.locker_number} className="border-t">
                          <td className="px-3 py-1.5 font-medium">{u.locker_number}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline">{u.spare_key_status}</Badge></td>
                          <td className="px-3 py-1.5"><Badge variant="outline">{u.physical_key_status}</Badge></td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{u.prevSpare ?? "—"} / {u.prevPhys ?? "—"}</td>
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

// ---------- helpers ----------
async function parseFile(f: File): Promise<Record<string, unknown>[]> {
  const ext = f.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data as Record<string, unknown>[]),
        error: (err) => reject(err),
      });
    });
  }
  const buf = await f.arrayBuffer();
  // raw:true keeps Excel date serials as numbers so we can parse them as dd/mm/yyyy aware.
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
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
  return normalizeLockerStatus(raw, hasBadge);
}

function mapKeyStatus(raw: string | null): LockerRow["physical_key_status"] {
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
  const physRaw = getStr(row, cols.physical_key_status);

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
    physical_key_status: mapKeyStatus(physRaw),
    spare_key_status: mapKeyStatus(getStr(row, cols.spare_key_status)),
    remark: getStr(row, cols.remark),
    batch_intake: cols.batch_intake ? parseBatchIntake(row[cols.batch_intake]) : null,
  };
}
