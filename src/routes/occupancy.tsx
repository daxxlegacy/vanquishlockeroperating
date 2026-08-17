import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { StatusBadge } from "@/components/StatusBadge";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { getXLSX } from "@/lib/xlsx-lazy";
import { List, type RowComponentProps } from "react-window";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Upload as UploadIcon, History, Trash2, Eye, Download, FilterX, RefreshCw, Pencil, MoreVertical, PlayCircle, StopCircle, CheckCircle2, Users2 } from "lucide-react";
import { SyncOccupancyDialog } from "@/components/SyncOccupancyDialog";
import { EditOccupancyRowDialog, DeleteOccupancyRowDialog } from "@/components/EditOccupancyRowDialog";
import { ForceTerminateDialog, ForceActivateDialog } from "@/components/ForceOccupancyDialogs";
import { DuplicateOccupantsDialog } from "@/components/DuplicateOccupantsDialog";
import { toast } from "sonner";
import { compareLockerNumbers, parseBatchIntake, NATIONAL_ID_HEADERS } from "@/lib/locker-utils";
import { downloadCsv } from "@/lib/csv-export";
import { NationalIdCell } from "@/components/NationalIdCell";
import { maskNationalId, fullyMaskNationalId, confirmNidExport, fetchFullNationalIds, useCanRevealNationalId } from "@/lib/national-id";
import { ColumnFilter, passesColumnFilter } from "@/components/ColumnFilter";
import { SortHeader, type SortState } from "@/components/SortHeader";
import {
  encodeFilterState, decodeFilterState, writeFilterParam, readFilterParam,
  colFiltersToObj, objToColFilters, cycleSort,
} from "@/lib/url-filter-state";
import { deriveOccCategoryOr } from "@/lib/locker-category";
import { invalidateOccupancyCache, type OccupancyRow, type OccCategory } from "@/lib/occupancy-cache";
import {
  useOccupancyPage, useOccupancyLocations, fetchAllMatchingOccupancy,
  OCC_PAGE_SIZE, type OccupancyQuery, type OccPageRow,
} from "@/lib/occupancy-page";
import { TablePagination } from "@/components/TablePagination";
import { useDebounced } from "@/hooks/use-debounced";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

// A unified row used by the combined Occupancy table. It carries either an
// existing occupancy record OR a synthesised stand-in built from the lockers
// table so every locker number from /lockers also appears here.
type Row = OccupancyRow & { __synthetic?: boolean };

const CATEGORY_LABEL: Record<OccCategory, string> = {
  main: "Full Locker (Occupied + Vacant)",
  staff: "Staff Locker (Occupied + Staff)",
  shoe: "Shoe Locker (Occupied + Shoe)",
  hr: "HR Locker (LK01–LK40)",
};

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 640;
const COLS = [
  { key: "locker", w: 100 },
  { key: "status", w: 110 },
  { key: "badge", w: 120 },
  { key: "emp", w: 180 },
  { key: "nid", w: 140 },
  { key: "intake", w: 110 },
  { key: "term", w: 110 },
  { key: "reason", w: 180 },
  { key: "work", w: 140 },
  { key: "history", w: 90 },
  { key: "actions", w: 130 },
];
const GRID_TEMPLATE = COLS.map((c) => `${c.w}px`).join(" ");
const GRID_TOTAL_WIDTH = COLS.reduce((s, c) => s + c.w, 0);



export const Route = createFileRoute("/occupancy")({
  head: () => ({
    meta: [
      { title: "Occupancy History — LockerOps" },
      { name: "description", content: "Combined occupancy history for every locker (Full, Staff, Shoe), including current holders, previous owners and terminations." },
    ],
  }),
  component: () => (<PageGuard permission="page_occupancy"><OccupancyPage /></PageGuard>),
});

function OccupancyPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <History className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-bold">Occupancy History</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-5">
          Combined view of every locker (Full, Staff, Shoe). Shows current holders, previous owners and terminations.
        </p>
        <CombinedView isAdmin={isAdmin} />
      </main>
    </div>
  );
}

function CombinedView({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | OccCategory>("all");
  const [locFilter, setLocFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [importing, setImporting] = useState(false);
  const [importCat, setImportCat] = useState<OccCategory | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  
  const [syncOpen, setSyncOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [editRow, setEditRow] = useState<OccupancyRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<OccupancyRow | null>(null);
  const [forceTerminateRow, setForceTerminateRow] = useState<OccupancyRow | null>(null);
  const [forceActivateRow, setForceActivateRow] = useState<OccupancyRow | null>(null);
  const [drift, setDrift] = useState<{ terminate_needed: number; activate_needed: number; duplicates: number } | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);

  const refreshDrift = useMemo(() => async () => {
    if (!isAdmin) return;
    setDriftLoading(true);
    try {
      const { data, error } = await supabase.rpc("count_occupancy_drift");
      if (error) throw error;
      const d = data as { terminate_needed: number; activate_needed: number; duplicates: number } | null;
      if (d) setDrift(d);
    } catch {
      // silent — indicator is a nice-to-have
    } finally {
      setDriftLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshDrift();
    const id = window.setInterval(() => { void refreshDrift(); }, 3 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [isAdmin, refreshDrift]);

  // Refresh drift after any dialog closes (they may have mutated occupancy)
  const prevDialogsOpen = useRef(false);
  const anyDialogOpen = syncOpen || !!editRow || !!deleteRow || !!forceTerminateRow || !!forceActivateRow;
  useEffect(() => {
    if (prevDialogsOpen.current && !anyDialogOpen) void refreshDrift();
    prevDialogsOpen.current = anyDialogOpen;
  }, [anyDialogOpen, refreshDrift]);

  // Refresh after imports complete
  const prevImporting = useRef(false);
  useEffect(() => {
    if (prevImporting.current && !importing) void refreshDrift();
    prevImporting.current = importing;
  }, [importing, refreshDrift]);

  const driftTotal = drift ? drift.terminate_needed + drift.activate_needed + drift.duplicates : 0;
  const fileRef = useRef<HTMLInputElement>(null);

  const [reasons, setReasons] = useState<Map<string, string>>(new Map());

  

  // ---------- Server-side paged data ----------
  const locOpts = useOccupancyLocations();

  const query: OccupancyQuery = useMemo(() => ({
    page,
    search: debouncedSearch,
    statusFilter,
    categoryFilter,
    locFilter,
    sortCol: sort?.col ?? "locker",
    sortDir: sort?.dir ?? "asc",
  }), [page, debouncedSearch, statusFilter, categoryFilter, locFilter, sort]);

  const {
    rows: pageRows, total, stats, loading: loadingData, refreshing, stale, refresh,
  } = useOccupancyPage(query, OCC_PAGE_SIZE);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, categoryFilter, locFilter, sort]);

  const filtered: Row[] = useMemo(() => (pageRows ?? []) as unknown as Row[], [pageRows]);

  // Termination reasons only for the lockers visible on this page.
  useEffect(() => {
    const nums = [...new Set(filtered.map((r) => r.locker_number))];
    if (nums.length === 0) { setReasons(new Map()); return; }
    let cancelled = false;
    (async () => {
      const { data: terms } = await supabase
        .from("terminations")
        .select("locker_number,reason,termination_date")
        .in("locker_number", nums)
        .order("termination_date", { ascending: false });
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const t of terms ?? []) {
        if (!t.locker_number || !t.reason) continue;
        if (!map.has(t.locker_number)) map.set(t.locker_number, t.reason);
      }
      setReasons(map);
    })();
    return () => { cancelled = true; };
  }, [filtered]);

  // The server already returns at most 1 active + 1 most-recent terminate per
  // locker, ordered by locker; just group consecutive rows for rendering.
  const grouped = useMemo(() => {
    const out: [string, Row[]][] = [];
    const seen = new Map<string, Row[]>();
    for (const r of filtered) {
      const arr = seen.get(r.locker_number);
      if (arr) { arr.push(r); continue; }
      const fresh = [r];
      seen.set(r.locker_number, fresh);
      out.push([r.locker_number, fresh]);
    }
    return out;
  }, [filtered]);

  const visible = grouped;

  const flattened = useMemo(() => {
    const out: { row: Row; lockerNumber: string; groupIndex: number; groupLength: number; reason: string | null }[] = [];
    for (const [lockerNumber, group] of visible) {
      const reason = reasons.get(lockerNumber) ?? null;
      for (let i = 0; i < group.length; i++) {
        out.push({ row: group[i], lockerNumber, groupIndex: i, groupLength: group.length, reason });
      }
    }
    return out;
  }, [visible, reasons]);

  // ---------- Exports ----------
  const canRevealNid = useCanRevealNationalId();
  const buildExportRows = async () => {
    // Exports cover every matching locker, streamed from the server in chunks.
    const all = (await fetchAllMatchingOccupancy(query)) as unknown as Row[];
    // Only rows that map to a real occupancy record (not synthetic locker rows) have valid ids for reveal.
    const realIds = all.filter((r) => !r.__synthetic).map((r) => r.id);
    const nidMap = canRevealNid ? await fetchFullNationalIds("locker_occupancy", realIds) : new Map<string, string>();
    return all.map((r) => ({
      "Locker Number": r.locker_number,
      "Status": r.status ?? "",
      "Badge Number": r.badge_number ?? "",
      "Employee Name": r.employee_name ?? "",
      "National ID": canRevealNid ? (nidMap.get(r.id) ?? maskNationalId(r.national_id)) : fullyMaskNationalId(r.national_id),
      "Work Location": r.work_location ?? "",
      "Locker Location": r.locker_location_by_row ?? "",
      "Key Lock": r.key_lock_type ?? "",
      "Batch Intake": fmtDate(r.batch_intake_date),
      "Termination Date": fmtDate(r.termination_date),
      "Terminated Reason": reasons.get(r.locker_number) ?? "",
      "Remarks": r.remarks ?? "",
      "Source File": r.source_filename ?? "",
    }));
  };

  const filterTag = () => {
    const parts: string[] = [];
    if (categoryFilter !== "all") parts.push(categoryFilter);
    if (statusFilter !== "all") parts.push(statusFilter);
    if (locFilter !== "all") parts.push(locFilter.replace(/\s+/g, "_"));
    return parts.length ? `_${parts.join("-")}` : "";
  };

  const exportCsv = async () => {
    if (total === 0) { toast.error("Nothing to export with the current filters"); return; }
    if (!confirmNidExport()) return;
    const rows = await buildExportRows();
    downloadCsv(`occupancy${filterTag()}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`Exported ${rows.length.toLocaleString()} rows`);
  };

  const exportXlsx = async () => {
    if (total === 0) { toast.error("Nothing to export with the current filters"); return; }
    if (!confirmNidExport()) return;
    const rows = await buildExportRows();
    const XLSX = await getXLSX();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Occupancy");
    const headers = Object.keys(rows[0] ?? {});
    ws["!cols"] = headers.map((h) => {
      const maxLen = Math.max(
        h.length,
        ...rows.map((r) => String(r[h as keyof typeof rows[0]] ?? "").length)
      );
      return { wch: maxLen + 2 };
    });
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const headerColor = "1E293B";
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      const cell = ws[addr];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: headerColor } },
        };
      }
    }
    XLSX.writeFile(wb, `LockerOps_occupancy${filterTag()}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exported ${rows.length.toLocaleString()} rows`);
  };

  // ---------- Import (per-category) ----------
  const triggerImport = (cat: OccCategory) => {
    setImportCat(cat);
    setTimeout(() => fileRef.current?.click(), 0);
  };

  const handleImport = async (file: File) => {
    const category = importCat;
    if (!category) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await getXLSX();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const targetSheet =
        category === "main" ? "Occupied + Vacant" :
        category === "staff" ? "Occupied + Staff" :
        category === "shoe" ? "Occupied + Shoe" : "Occupied + HR";
      const sheet = wb.Sheets[targetSheet]
        ?? (category === "hr" ? wb.Sheets[wb.SheetNames[0]] : undefined);
      if (!sheet) { toast.error(`Sheet "${targetSheet}" not found in this workbook`); return; }
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
      const norm = (v: unknown) => {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v ?? "").trim();
        return s === "" ? null : s;
      };
      const dateOnly = (v: unknown) => parseBatchIntake(v);
      const pick = (row: Record<string, unknown>, ...keys: string[]) => {
        const want = keys.map((k) => k.toLowerCase().replace(/\s+/g, ""));
        for (const real of Object.keys(row)) {
          const r = real.toLowerCase().replace(/\s+/g, "");
          if (want.includes(r)) return row[real];
        }
        return "";
      };
      const records = json
        .map((r) => {
          const lockerNumber = String(pick(r, "Combine Locker", "Locker Number") ?? "").trim();
          return ({
          // Category is always derived from the locker number pattern; the
          // chosen import sheet is only the fallback for odd numbers.
          category: deriveOccCategoryOr(lockerNumber, category),
          locker_number: lockerNumber,
          locker_row: norm(pick(r, "Locker Row")),
          locker_unit: norm(pick(r, "Locker Unit")),
          locker_location_by_row: norm(pick(r, "Locker Location by Row")),
          key_lock_type: norm(pick(r, "Types of Key Lock")),
          badge_number: norm(pick(r, "Employee Number", "Badge Number")),
          employee_name: norm(pick(r, "Employee Name")),
          national_id: norm(pick(r, ...NATIONAL_ID_HEADERS)),
          work_location: norm(pick(r, "Work Location", "Worksite", "Site", "Worksite Location", "Work Location Site", "Dept Location")),
          contact: norm(pick(r, "Contact")),
          status: norm(pick(r, "Terminate", "Status")),
          batch_intake_date: dateOnly(pick(r, "Batch Intake Date")),
          termination_date: dateOnly(pick(r, "Termination Date")),
          gradeset: norm(pick(r, "Gradeset")),
          department: norm(pick(r, "Department")),
          remarks: norm(pick(r, "Remarks", "Remark")),
          source_filename: file.name,
          });
        })
        .filter((r) => r.locker_number);

      // Guard: never import rows that carry no occupant AND no status —
      // these produced blank "ghost" cards in the History dialog.
      const blankRows = records.filter(
        (r) => !(r.employee_name ?? "").trim() && !(r.badge_number ?? "").trim() && !(r.status ?? "").trim(),
      );
      const usableRecords = records.filter((r) => !blankRows.includes(r));
      if (blankRows.length > 0) {
        console.warn(
          `[occupancy import] skipped ${blankRows.length} blank row(s) with no employee name, badge number or status:`,
          blankRows.map((r) => r.locker_number).slice(0, 50),
        );
      }
      records.length = 0;
      records.push(...usableRecords);

      if (records.length === 0) { toast.error("No usable rows found in the sheet"); return; }


      // De-duplicate Active rows within the uploaded file itself: if the same
      // locker_number appears more than once as Active, keep only the LAST
      // occurrence (later rows typically reflect the latest state).
      const isActiveStatus = (s: string | null) => !!s && /active/i.test(s);
      const activeSeen = new Map<string, number>(); // locker_number -> last index
      records.forEach((r, i) => {
        if (isActiveStatus(r.status)) activeSeen.set(r.locker_number, i);
      });
      const dedupedRecords: typeof records = [];
      let inFileDupSkipped = 0;
      records.forEach((r, i) => {
        if (isActiveStatus(r.status) && activeSeen.get(r.locker_number) !== i) {
          inFileDupSkipped++;
          return;
        }
        dedupedRecords.push(r);
      });

      const { error: delErr } = await supabase.from("locker_occupancy").delete().eq("category", category);
      if (delErr) { toast.error(`Replace failed: ${delErr.message}`); return; }

      // Rows whose derived category differs from the imported sheet may still
      // have stale copies filed under another category — clear those first.
      const crossNums = [...new Set(dedupedRecords.filter((r) => r.category !== category).map((r) => r.locker_number))];
      for (let i = 0; i < crossNums.length; i += 200) {
        const { error: xErr } = await supabase.from("locker_occupancy").delete().in("locker_number", crossNums.slice(i, i + 200));
        if (xErr) { toast.error(`Replace failed: ${xErr.message}`); return; }
      }

      const CHUNK = 500;
      const crossCategoryConflicts: string[] = [];
      for (let i = 0; i < dedupedRecords.length; i += CHUNK) {
        const slice = dedupedRecords.slice(i, i + CHUNK);
        const { error } = await supabase.from("locker_occupancy").insert(slice);
        if (error) {
          if ((error as { code?: string }).code === "23505") {
            // A locker in this chunk conflicts with an Active row in another
            // category. Fall back to per-row inserts to isolate the offenders.
            for (const row of slice) {
              const { error: rowErr } = await supabase.from("locker_occupancy").insert(row);
              if (rowErr) {
                if ((rowErr as { code?: string }).code === "23505") {
                  crossCategoryConflicts.push(row.locker_number);
                } else {
                  toast.error(`Insert failed for ${row.locker_number}: ${rowErr.message}`);
                  return;
                }
              }
            }
          } else {
            toast.error(`Insert failed: ${error.message}`);
            return;
          }
        }
      }

      const inserted = dedupedRecords.length - crossCategoryConflicts.length;
      const parts: string[] = [`Imported ${inserted.toLocaleString()} rows for ${CATEGORY_LABEL[category]}`];
      if (inFileDupSkipped > 0) parts.push(`${inFileDupSkipped} duplicate Active row${inFileDupSkipped === 1 ? "" : "s"} in the file were skipped`);
      if (blankRows.length > 0) parts.push(`${blankRows.length} blank row${blankRows.length === 1 ? "" : "s"} (no name, badge or status) skipped`);
      if (crossCategoryConflicts.length > 0) {
        parts.push(`${crossCategoryConflicts.length} locker${crossCategoryConflicts.length === 1 ? "" : "s"} skipped — already Active in another category: ${crossCategoryConflicts.slice(0, 10).join(", ")}${crossCategoryConflicts.length > 10 ? "…" : ""}`);
        toast.warning(parts.join(" · "), { duration: 12000 });
      } else {
        toast.success(parts.join(" · "));
      }
      invalidateOccupancyCache(category);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      setImportCat(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleClear = async (cat: OccCategory) => {
    if (!confirm(`Clear all ${CATEGORY_LABEL[cat]} occupancy rows? This cannot be undone.`)) return;
    const { error } = await supabase.from("locker_occupancy").delete().eq("category", cat);
    if (error) { toast.error(error.message); return; }
    toast.success("Cleared");
    invalidateOccupancyCache(cat);
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="Total Rows" value={stats.total} />
        <StatCard label="Unique Lockers" value={stats.unique_lockers} />
        <StatCard label="Active" value={stats.active} tone="success" />
        <StatCard label="Terminated" value={stats.terminated} tone="muted" />
      </div>

      <Card className="p-4 flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-0 sm:min-w-[240px] w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search locker, employee, badge, dept…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="terminate">Terminated</SelectItem>
            <SelectItem value="vacant">Vacant / Empty</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as "all" | OccCategory)}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="main">Full Lockers</SelectItem>
            <SelectItem value="staff">Staff Lockers</SelectItem>
            <SelectItem value="shoe">Shoe Lockers</SelectItem>
            <SelectItem value="hr">HR Lockers</SelectItem>
          </SelectContent>
        </Select>
        <Select value={locFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locOpts.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        {isAdmin && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={importing}>
                  <UploadIcon className="h-4 w-4 mr-1.5" />
                  {importing ? "Importing…" : "Import Excel"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => triggerImport("main")}>Import Full Lockers (Occupied + Vacant)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => triggerImport("staff")}>Import Staff Lockers (Occupied + Staff)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => triggerImport("shoe")}>Import Shoe Lockers (Occupied + Shoe)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => triggerImport("hr")}>Import HR Lockers (LK01–LK40)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="Clear a category" disabled={importing}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleClear("main")}>Clear Full Lockers</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleClear("staff")}>Clear Staff Lockers</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleClear("shoe")}>Clear Shoe Lockers</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleClear("hr")}>Clear HR Lockers</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              onClick={() => setSyncOpen(true)}
              className="relative"
              title={
                drift == null
                  ? "Reconcile occupancy with the Lockers page"
                  : driftTotal > 0
                    ? `${driftTotal} record${driftTotal === 1 ? "" : "s"} out of sync with Lockers page — click to review.`
                    : "In sync with Lockers page"
              }
            >
              <RefreshCw className="h-4 w-4 mr-1.5" /> Sync with Lockers page
              {drift != null && driftTotal > 0 && (
                <span
                  className="ml-2 inline-flex min-w-[1.25rem] h-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground"
                  aria-label={`${driftTotal} records out of sync`}
                >
                  {driftTotal > 99 ? "99+" : driftTotal}
                </span>
              )}
              {drift != null && driftTotal === 0 && !driftLoading && (
                <CheckCircle2 className="ml-2 h-4 w-4 text-emerald-500" aria-label="In sync" />
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDupOpen(true)}
              title="Find employees active in more than one locker"
            >
              <Users2 className="h-4 w-4 mr-1.5" /> Check Duplicates
            </Button>
          </>
        )}
        <Button variant="outline" onClick={exportCsv} disabled={total === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Export CSV
        </Button>
        <Button variant="outline" onClick={exportXlsx} disabled={total === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Export Excel
        </Button>
        <Button
          variant="outline"
          onClick={clearAllFilters}
          disabled={!hasAnyFilter}
          title="Clear all filters, search, and sorting"
        >
          <FilterX className="h-4 w-4 mr-1.5" /> Clear filters
        </Button>
      </Card>

      <Card className="overflow-hidden">
        {loadingData ? (
          <div className="p-6 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : grouped.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {total === 0 && !hasAnyFilter
              ? "No data yet. Click \"Import Excel\" and upload your master listing workbook."
              : "No rows match these filters."}
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <div style={{ minWidth: GRID_TOTAL_WIDTH }}>
                <div className="bg-muted/50 grid text-left text-xs uppercase font-semibold tracking-wide text-muted-foreground" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
                  <Th><SortHeader label="Locker" col="locker" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th><SortHeader label="Status" col="status" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th><SortHeader label="Badge" col="badge" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th><SortHeader label="Employee" col="emp" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th><SortHeader label="National ID" col="nid" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th><SortHeader label="Intake" col="intake" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th><SortHeader label="Terminated" col="term" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th>Reason</Th>
                  <Th><SortHeader label="Work Location" col="work" sort={sort} onCycle={onCycleSort} /></Th>
                  <Th>History</Th>
                  <Th>{isAdmin ? "Actions" : ""}</Th>
                </div>
                {flattened.length === 0 ? (
                  <div className="px-3 py-12 text-center text-muted-foreground text-sm">No rows match these filters.</div>
                ) : (
                  <List
                    rowComponent={OccupancyRow as any}
                    rowCount={flattened.length}
                    rowHeight={ROW_HEIGHT}
                    rowProps={{ rows: flattened, onViewHistory: setHistoryFor, isAdmin, onEdit: setEditRow, onDelete: setDeleteRow, onForceTerminate: setForceTerminateRow, onForceActivate: setForceActivateRow }}
                    style={{ height: Math.min(VIEWPORT_HEIGHT, flattened.length * ROW_HEIGHT + 4) }}
                  />
                )}
              </div>
            </div>
            <div className="sm:hidden divide-y">
              {visible.map(([lockerNumber, group]) => (
                <MobileLockerGroup key={lockerNumber} lockerNumber={lockerNumber} group={group} reason={reasons.get(lockerNumber) ?? null} onViewHistory={() => setHistoryFor(lockerNumber)} />
              ))}
            </div>

            <TablePagination page={page} pageSize={OCC_PAGE_SIZE} total={total} loading={refreshing} onPageChange={setPage} label="lockers" />
          </>
        )}
      </Card>

      <HistoryDialog lockerNumber={historyFor} isAdmin={isAdmin} onClose={() => setHistoryFor(null)} />
      <SyncOccupancyDialog
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onRequestForceTerminate={isAdmin ? (row) => setForceTerminateRow(row) : undefined}
      />
      {isAdmin && <EditOccupancyRowDialog row={editRow} onClose={() => setEditRow(null)} />}
      {isAdmin && <DeleteOccupancyRowDialog row={deleteRow} onClose={() => setDeleteRow(null)} />}
      {isAdmin && <ForceTerminateDialog row={forceTerminateRow} onClose={() => setForceTerminateRow(null)} />}
      {isAdmin && <ForceActivateDialog row={forceActivateRow} onClose={() => setForceActivateRow(null)} />}
      {isAdmin && (
        <DuplicateOccupantsDialog
          open={dupOpen}
          onClose={() => setDupOpen(false)}
          isAdmin={isAdmin}
          onViewHistory={(n) => setHistoryFor(n)}
        />

      )}
    </div>
  );
}

function syntheticRowFromLocker(l: Locker): Row {
  const st = (l.status ?? "").toLowerCase();
  const isActive = st === "active";
  return {
    id: `synthetic-${l.id}`,
    category: deriveOccCategoryOr(l.locker_number, "main"),
    locker_number: l.locker_number,
    locker_row: l.row_label,
    locker_unit: null,
    locker_location_by_row: l.location,
    key_lock_type: l.key_lock,
    badge_number: isActive ? l.badge_number : null,
    employee_name: isActive ? l.employee_name : null,
    national_id: isActive ? l.national_id : null,
    work_location: isActive ? l.work_location : null,
    contact: null,
    status: isActive ? "Active" : (l.status ?? "vacant"),
    batch_intake_date: l.batch_intake ?? null,
    termination_date: null,
    gradeset: null,
    department: null,
    remarks: l.remark,
    source_filename: null,
    __synthetic: true,
  };
}

type FlatRow = { row: Row; lockerNumber: string; groupIndex: number; groupLength: number; reason: string | null };
type OccupancyRowProps = {
  rows: FlatRow[];
  onViewHistory: (lockerNumber: string) => void;
  isAdmin: boolean;
  onEdit: (row: OccupancyRow) => void;
  onDelete: (row: OccupancyRow) => void;
  onForceTerminate: (row: OccupancyRow) => void;
  onForceActivate: (row: OccupancyRow) => void;
};
const OccupancyRow = memo(function OccupancyRow({ index, style, rows, onViewHistory, isAdmin, onEdit, onDelete, onForceTerminate, onForceActivate }: RowComponentProps<OccupancyRowProps>) {
  const { row, lockerNumber, groupIndex, reason } = rows[index];
  const isFirst = groupIndex === 0;
  const isActive = (row.status ?? "").toLowerCase() === "active";
  return (
    <div
      style={{ ...style, gridTemplateColumns: GRID_TEMPLATE }}
      className={`grid items-center border-t hover:bg-muted/40 text-sm ${groupIndex > 0 ? "bg-muted/20" : ""}`}
    >
      <div className="px-3 truncate font-medium font-mono">
        {isFirst ? lockerNumber : <span className="text-muted-foreground/60 text-xs pl-3">↳</span>}
      </div>
      
      <div className="px-3"><StatusBadge status={row.status} /></div>
      <div className="px-3 truncate font-mono text-xs">{row.badge_number ?? "—"}</div>
      <div className="px-3 truncate">{row.employee_name ?? <span className="text-muted-foreground italic">vacant</span>}</div>
      <div className="px-3 truncate font-mono text-xs text-muted-foreground"><NationalIdCell value={row.national_id} recordId={row.__synthetic ? null : row.id} table="locker_occupancy" /></div>
      <div className="px-3 truncate text-muted-foreground text-xs">{fmtDate(row.batch_intake_date)}</div>
      <div className="px-3 truncate text-muted-foreground text-xs">{fmtDate(row.termination_date)}</div>
      <div className="px-3 truncate text-muted-foreground text-xs" title={(!isActive ? (row.remarks || reason || "") : "") || undefined}>
        {!isActive ? (row.remarks || reason || "—") : "—"}
      </div>
      <div className="px-3 truncate text-muted-foreground text-xs">{row.work_location ?? "—"}</div>
      <div className="px-3">
        {isFirst && (
          <Button variant="ghost" size="sm" onClick={() => onViewHistory(lockerNumber)} className="h-7 px-2">
            <Eye className="h-3.5 w-3.5 mr-1" /> View
          </Button>
        )}
      </div>
      <div className="px-2 flex items-center gap-1">
        {isAdmin && !row.__synthetic && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit occupancy record" onClick={() => onEdit(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete occupancy record" onClick={() => onDelete(row)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="More actions">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isActive ? (
                  <DropdownMenuItem onClick={() => onForceTerminate(row)} className="text-destructive focus:text-destructive">
                    <StopCircle className="h-4 w-4 mr-2" /> Force Terminate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onForceActivate(row)}>
                    <PlayCircle className="h-4 w-4 mr-2" /> Force Activate
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
});

function LockerGroup({ lockerNumber, group, reason, onViewHistory }: { lockerNumber: string; group: Row[]; reason?: string | null; onViewHistory: () => void }) {
  return (
    <>
      {group.map((r, i) => {
        const isActive = (r.status ?? "").toLowerCase() === "active";
        const isFirst = i === 0;
        return (
          <tr
            key={r.id}
            className={`border-t ${isFirst ? "" : "bg-muted/20"} hover:bg-muted/40`}
          >
            <td className="px-3 py-2 font-medium font-mono">{isFirst ? lockerNumber : <span className="text-muted-foreground/60 text-xs pl-3">↳</span>}</td>
            
            <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
            <td className="px-3 py-2 font-mono text-xs">{r.badge_number ?? "—"}</td>
            <td className="px-3 py-2">{r.employee_name ?? <span className="text-muted-foreground italic">vacant</span>}</td>
            <td className="px-3 py-2 font-mono text-xs text-muted-foreground"><NationalIdCell value={r.national_id} recordId={r.__synthetic ? null : r.id} table="locker_occupancy" /></td>
            <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(r.batch_intake_date)}</td>
            <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(r.termination_date)}</td>
            <td className="px-3 py-2 text-muted-foreground text-xs max-w-[220px] truncate" title={(!isActive ? (r.remarks || reason || "") : "") || undefined}>
              {!isActive ? (r.remarks || reason || "—") : "—"}
            </td>
            <td className="px-3 py-2 text-muted-foreground text-xs">{r.work_location ?? "—"}</td>
            <td className="px-3 py-2">
              {isFirst && (
                <Button variant="ghost" size="sm" onClick={onViewHistory} className="h-7 px-2">
                  <Eye className="h-3.5 w-3.5 mr-1" /> View
                </Button>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function MobileLockerGroup({ lockerNumber, group, reason, onViewHistory }: { lockerNumber: string; group: Row[]; reason?: string | null; onViewHistory: () => void }) {
  const first = group[0];
  const canRevealNid = useCanRevealNationalId();
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-semibold text-base truncate">{lockerNumber}</div>
          <div className="text-[10px] uppercase text-muted-foreground">{first?.category}</div>
          <div className="mt-0.5"><StatusBadge status={first?.status ?? null} /></div>
        </div>
        <Button variant="ghost" size="sm" onClick={onViewHistory} className="h-7 px-2 shrink-0">
          <Eye className="h-3.5 w-3.5 mr-1" /> History
        </Button>
      </div>
      {group.map((r, i) => {
        const isActive = (r.status ?? "").toLowerCase() === "active";
        return (
          <div key={r.id} className={`rounded-md border px-2.5 py-2 text-xs space-y-1 ${i === 0 ? "bg-card" : "bg-muted/30"}`}>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              <MField label="Employee" value={r.employee_name ?? (i === 0 ? "vacant" : "—")} wide />
              <MField label="Badge" value={r.badge_number} mono />
              <MField label="National ID" value={canRevealNid ? maskNationalId(r.national_id) : fullyMaskNationalId(r.national_id)} mono />
              <MField label="Intake" value={fmtDate(r.batch_intake_date)} />
              <MField label="Terminated" value={fmtDate(r.termination_date)} />
              <MField label="Work" value={r.work_location} wide />
              {!isActive && <MField label="Reason" value={r.remarks || reason || "—"} wide />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MField({ label, value, wide, mono }: { label: string; value: string | null | undefined; wide?: boolean; mono?: boolean }) {
  const v = value && String(value).trim() !== "" ? value : "—";
  return (
    <div className={wide ? "col-span-2" : ""}>
      <span className="text-muted-foreground">{label}: </span>
      <span className={`font-medium break-words ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}

type HistoryEvent = {
  id: string;
  source: "occupancy" | "termination";
  status: string;
  employee_name: string | null;
  badge_number: string | null;
  national_id: string | null;
  nid_record_id: string | null;
  date: string | null;
  date_label: string;
  remarks: string | null;
  by: string | null;
};


function HistoryDialog({ lockerNumber, isAdmin, onClose }: { lockerNumber: string | null; isAdmin: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [tick, setTick] = useState(0);
  const [confirmEvent, setConfirmEvent] = useState<HistoryEvent | null>(null);
  const [confirmStage, setConfirmStage] = useState<1 | 2>(1);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!lockerNumber) return;
    const ch = supabase
      .channel(`history-${lockerNumber}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "locker_occupancy", filter: `locker_number=eq.${lockerNumber}` }, () => setTick((t) => t + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "terminations", filter: `locker_number=eq.${lockerNumber}` }, () => setTick((t) => t + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "lockers", filter: `locker_number=eq.${lockerNumber}` }, () => setTick((t) => t + 1))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [lockerNumber]);

  useEffect(() => {
    if (!lockerNumber) { setEvents(null); return; }
    (async () => {
      setEvents(null);
      const [{ data: occ }, { data: term }] = await Promise.all([
        supabase.from("locker_occupancy").select("*").eq("locker_number", lockerNumber).order("updated_at", { ascending: false }),
        supabase.from("terminations").select("*").eq("locker_number", lockerNumber).is("undone_at", null).order("termination_date", { ascending: false }),
      ]);
      const out: HistoryEvent[] = [];
      // Map badge → occupancy row so termination events can show a masked
      // National ID (terminations table doesn't store one).
      const nidByBadge = new Map<string, { id: string; nid: string | null }>();
      for (const r of occ ?? []) {
        const b = (r.badge_number ?? "").trim().toLowerCase();
        if (b && r.national_id && !nidByBadge.has(b)) nidByBadge.set(b, { id: r.id, nid: r.national_id });
      }
      for (const r of occ ?? []) {
        out.push({
          id: `o-${r.id}`,
          source: "occupancy",
          status: r.status ?? "—",
          employee_name: r.employee_name,
          badge_number: r.badge_number,
          national_id: r.national_id ?? null,
          nid_record_id: r.id,
          date: (r.status ?? "").toLowerCase() === "active" ? r.batch_intake_date : r.termination_date,
          date_label: (r.status ?? "").toLowerCase() === "active" ? "Intake" : "Terminated",
          remarks: r.remarks,
          by: r.source_filename,
        });
      }
      for (const t of term ?? []) {
        const match = nidByBadge.get((t.badge_number ?? "").trim().toLowerCase());
        out.push({
          id: `t-${t.id}`,
          source: "termination",
          status: "Terminate",
          employee_name: t.employee_name,
          badge_number: t.badge_number,
          national_id: match?.nid ?? null,
          nid_record_id: match?.id ?? null,
          date: t.termination_date,
          date_label: "Terminated",
          remarks: t.reason,
          by: t.terminated_by_email,
        });
      }

      out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      // Defensive: never render an empty shell card (no name, badge, status or date).
      const meaningful = out.filter(
        (e) =>
          (e.employee_name ?? "").trim() !== "" ||
          (e.badge_number ?? "").trim() !== "" ||
          ((e.status ?? "").trim() !== "" && (e.status ?? "").trim() !== "—") ||
          (e.date ?? "").trim() !== "",
      );
      setEvents(meaningful);
    })();
  }, [lockerNumber, tick]);

  const openConfirm = (ev: HistoryEvent) => {
    setConfirmEvent(ev);
    setConfirmStage(1);
  };

  const isCurrentActive = confirmEvent?.source === "occupancy"
    && (confirmEvent.status ?? "").toLowerCase() === "active";

  const doDelete = async () => {
    if (!confirmEvent || !lockerNumber) return;
    if (isCurrentActive && confirmStage === 1) {
      setConfirmStage(2);
      return;
    }
    setDeleting(true);
    try {
      const rawId = confirmEvent.id.slice(2);
      const { data: u } = await supabase.auth.getUser();
      if (confirmEvent.source === "occupancy") {
        const { error } = await supabase.from("locker_occupancy").delete().eq("id", rawId);
        if (error) throw error;
      } else {
        // Termination history is immutable for audit purposes. Hide a removed
        // event by marking it undone, matching duplicate-history cleanup.
        const { data, error } = await supabase
          .from("terminations")
          .update({ undone_at: new Date().toISOString(), undone_by: u.user?.id ?? null })
          .eq("id", rawId)
          .is("undone_at", null)
          .select("id");
        if (error) throw error;
        if ((data?.length ?? 0) !== 1) throw new Error("Termination history entry could not be removed.");
      }
      await supabase.from("status_change_log").insert({
        locker_number: lockerNumber,
        previous_status: confirmEvent.status,
        new_status: "(deleted)",
        source: confirmEvent.source === "occupancy" ? "history_delete_occupancy" : "history_delete_termination",
        changed_by: u.user?.id ?? "",
        changed_by_email: u.user?.email ?? null,
      });
      toast.success("History entry deleted");
      setConfirmEvent(null);
      setConfirmStage(1);
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!lockerNumber} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <History className="h-5 w-5" /> Locker {lockerNumber} — Full history
          </DialogTitle>
          <DialogDescription>All occupancy and termination events recorded for this locker.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {!events ? (
            <div className="space-y-2 p-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : events.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">No history recorded.</div>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="border rounded-md p-3 bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={e.status} />
                      <span className="font-medium">{e.employee_name ?? "—"}</span>
                      {e.badge_number && <span className="font-mono text-xs text-muted-foreground">#{e.badge_number}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {/^\s*terminate/i.test(e.status ?? "") ? "termination" : e.source}
                      </Badge>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Delete this history entry"
                          onClick={() => openConfirm(e)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      NID:
                      <NationalIdCell value={e.national_id} recordId={e.nid_record_id} table="locker_occupancy" />
                    </span>
                    <span>{e.date_label}: {fmtDate(e.date)}</span>
                  </div>

                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>

      <Dialog open={!!confirmEvent} onOpenChange={(v) => { if (!v) { setConfirmEvent(null); setConfirmStage(1); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              {isCurrentActive && confirmStage === 2 ? "Delete current active record?" : "Delete history entry?"}
            </DialogTitle>
            <DialogDescription>
              {isCurrentActive && confirmStage === 2
                ? "This is the current occupancy record, not just history — deleting it will remove the active occupant record entirely. Are you sure?"
                : "This permanently deletes this history entry. It will not affect the current Lockers page or Occupancy status — only this historical record."}
            </DialogDescription>
          </DialogHeader>
          {confirmEvent && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{confirmEvent.status}</span></div>
              <div><span className="text-muted-foreground">Employee:</span> <span className="font-medium">{confirmEvent.employee_name ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Badge:</span> <span className="font-mono">{confirmEvent.badge_number ?? "—"}</span></div>
              <div><span className="text-muted-foreground">{confirmEvent.date_label}:</span> <span>{fmtDate(confirmEvent.date)}</span></div>
              <div><span className="text-muted-foreground">Source table:</span> <span className="font-mono">{confirmEvent.source === "occupancy" ? "locker_occupancy" : "terminations"}</span></div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setConfirmEvent(null); setConfirmStage(1); }} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={doDelete} disabled={deleting}>
              {deleting ? "Deleting…" : isCurrentActive && confirmStage === 1 ? "Continue" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "success" | "muted" }) {
  const color = tone === "success" ? "text-success" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <Card className="p-3">
      <div className={`text-2xl font-bold font-display ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
