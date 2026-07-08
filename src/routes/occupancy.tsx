import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { StatusBadge } from "@/components/StatusBadge";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import * as XLSX from "xlsx";
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
import { Search, Upload as UploadIcon, History, Trash2, Eye, Download, FilterX, RefreshCw } from "lucide-react";
import { SyncOccupancyDialog } from "@/components/SyncOccupancyDialog";
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
import { useOccupancy, invalidateOccupancyCache, type OccupancyRow, type OccCategory } from "@/lib/occupancy-cache";
import { useLockers } from "@/lib/lockers-cache";
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
};

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 640;
const COLS = [
  { key: "locker", w: 100 },
  { key: "cat", w: 110 },
  { key: "status", w: 110 },
  { key: "badge", w: 120 },
  { key: "emp", w: 180 },
  { key: "nid", w: 140 },
  { key: "intake", w: 110 },
  { key: "term", w: 110 },
  { key: "reason", w: 180 },
  { key: "work", w: 140 },
  { key: "history", w: 90 },
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
  const { rows: mainRows } = useOccupancy("main");
  const { rows: staffRows } = useOccupancy("staff");
  const { rows: shoeRows } = useOccupancy("shoe");
  const { lockers } = useLockers();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | OccCategory>("all");
  const [locFilter, setLocFilter] = useState("all");
  
  const [importing, setImporting] = useState(false);
  const [importCat, setImportCat] = useState<OccCategory | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: terms } = await supabase
        .from("terminations")
        .select("locker_number,reason,termination_date")
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
  }, []);

  

  // ---------- Merge data ----------
  // Combine occupancy rows from all three categories, then overlay the lockers
  // table so every locker number appears even when it has no occupancy record.
  const allRows: Row[] = useMemo(() => {
    const occ: Row[] = [];
    for (const r of mainRows ?? []) occ.push(r);
    for (const r of staffRows ?? []) occ.push(r);
    for (const r of shoeRows ?? []) occ.push(r);

    const seenLockers = new Set(occ.map((r) => r.locker_number));
    const synth: Row[] = [];
    for (const l of lockers ?? []) {
      if (seenLockers.has(l.locker_number)) continue;
      synth.push(syntheticRowFromLocker(l));
    }
    return [...occ, ...synth];
  }, [mainRows, staffRows, shoeRows, lockers]);

  const loadingData = !mainRows || !staffRows || !shoeRows || !lockers;

  // Distinct locations from merged dataset
  const locOpts = useMemo(() => {
    const l = new Set<string>();
    for (const x of allRows) {
      if (x.locker_location_by_row) l.add(x.locker_location_by_row);
    }
    return [...l].sort();
  }, [allRows]);

  const columnValues = useMemo(() => {
    return {
      locker: allRows.map((r) => r.locker_number),
      status: allRows.map((r) => r.status),
      badge: allRows.map((r) => r.badge_number),
      emp: allRows.map((r) => r.employee_name),
      nid: allRows.map((r) => r.national_id),
      intake: allRows.map((r) => fmtDate(r.batch_intake_date)),
      term: allRows.map((r) => fmtDate(r.termination_date)),
      work: allRows.map((r) => r.work_location),
      cat: allRows.map((r) => r.category),
    };
  }, [allRows]);

  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (k: string) => (next: Set<string>) =>
    setColFilters((cur) => ({ ...cur, [k]: next }));

  const [sort, setSort] = useState<SortState>(null);
  const onCycleSort = (col: string) => setSort((cur) => cycleSort(cur, col));

  const urlKey = "f_occupancy";
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const s = decodeFilterState(readFilterParam(urlKey));
    if (s) {
      setSearch(s.q ?? "");
      const x = s.x ?? {};
      setStatusFilter(x.status ?? "all");
      setCategoryFilter((x.cat as "all" | OccCategory) ?? "all");
      setLocFilter(x.loc ?? "all");
      setColFilters(objToColFilters(s.cf));
      setSort(s.sort ?? null);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const encoded = encodeFilterState({
      cf: colFiltersToObj(colFilters),
      q: search,
      sort,
      x: { status: statusFilter, cat: categoryFilter, loc: locFilter },
    });
    writeFilterParam(encoded, urlKey);
  }, [hydrated, colFilters, search, sort, statusFilter, categoryFilter, locFilter]);

  const hasAnyFilter =
    !!search ||
    statusFilter !== "all" ||
    categoryFilter !== "all" ||
    locFilter !== "all" ||
    sort !== null ||
    Object.values(colFilters).some((s) => s.size > 0);

  const clearAllFilters = () => {
    setSearch(""); setStatusFilter("all"); setCategoryFilter("all"); setLocFilter("all");
    setColFilters({}); setSort(null);
  };

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    const f = allRows.filter((r) => {
      const st = (r.status ?? "").toLowerCase();
      if (statusFilter === "active" && st !== "active") return false;
      if (statusFilter === "terminate" && st !== "terminate" && st !== "terminated") return false;
      if (statusFilter === "vacant" && st !== "" && st !== "vacant" && st !== "empty") return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (locFilter !== "all" && (r.locker_location_by_row ?? "") !== locFilter) return false;
      if (!passesColumnFilter(r.locker_number, colFilters.locker ?? new Set())) return false;
      if (!passesColumnFilter(r.status, colFilters.status ?? new Set())) return false;
      if (!passesColumnFilter(r.badge_number, colFilters.badge ?? new Set())) return false;
      if (!passesColumnFilter(r.employee_name, colFilters.emp ?? new Set())) return false;
      if (!passesColumnFilter(r.national_id, colFilters.nid ?? new Set())) return false;
      if (!passesColumnFilter(fmtDate(r.batch_intake_date), colFilters.intake ?? new Set())) return false;
      if (!passesColumnFilter(fmtDate(r.termination_date), colFilters.term ?? new Set())) return false;
      if (!passesColumnFilter(r.work_location, colFilters.work ?? new Set())) return false;
      if (!passesColumnFilter(r.category, colFilters.cat ?? new Set())) return false;
      if (!q) return true;
      return (
        r.locker_number.toLowerCase().includes(q) ||
        (r.employee_name ?? "").toLowerCase().includes(q) ||
        (r.badge_number ?? "").toLowerCase().includes(q) ||
        (r.national_id ?? "").toLowerCase().includes(q) ||
        (r.work_location ?? "").toLowerCase().includes(q) ||
        (r.locker_row ?? "").toLowerCase().includes(q) ||
        (r.locker_location_by_row ?? "").toLowerCase().includes(q)
      );
    });
    if (sort) {
      const accessors: Record<string, (r: Row) => string | null | undefined> = {
        locker: (r) => r.locker_number,
        status: (r) => r.status,
        badge: (r) => r.badge_number,
        emp: (r) => r.employee_name,
        nid: (r) => r.national_id,
        intake: (r) => r.batch_intake_date,
        term: (r) => r.termination_date,
        work: (r) => r.work_location,
        cat: (r) => r.category,
      };
      const get = accessors[sort.col] ?? accessors.locker;
      const dir = sort.dir === "asc" ? 1 : -1;
      f.sort((a, b) => {
        if (sort.col === "locker") return compareLockerNumbers(a.locker_number, b.locker_number) * dir;
        const av = get(a), bv = get(b);
        const ae = av == null || av === "";
        const be = bv == null || bv === "";
        if (ae && be) return 0;
        if (ae) return 1;
        if (be) return -1;
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
      });
    } else {
      f.sort((a, b) => {
        const c = compareLockerNumbers(a.locker_number, b.locker_number);
        if (c !== 0) return c;
        const aActive = (a.status ?? "").toLowerCase() === "active" ? 0 : 1;
        const bActive = (b.status ?? "").toLowerCase() === "active" ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (b.termination_date ?? "").localeCompare(a.termination_date ?? "");
      });
    }
    return f;
  }, [allRows, debouncedSearch, statusFilter, categoryFilter, locFilter, colFilters, sort]);

  // Group by locker number — limit to 1 active + 1 most-recent terminate
  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const arr = m.get(r.locker_number) ?? [];
      arr.push(r);
      m.set(r.locker_number, arr);
    }
    const trimmed: [string, Row[]][] = [];
    for (const [k, arr] of m.entries()) {
      const active = arr.find((r) => (r.status ?? "").toLowerCase() === "active");
      const terminate = arr.find((r) => {
        const s = (r.status ?? "").toLowerCase();
        return s === "terminate" || s === "terminated";
      });
      const out: Row[] = [];
      if (active) out.push(active);
      if (terminate) out.push(terminate);
      if (out.length === 0) out.push(arr[0]);
      trimmed.push([k, out]);
    }
    return trimmed;
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

  const stats = useMemo(() => {
    const lockerNos = new Set<string>();
    let active = 0, terminated = 0;
    for (const r of allRows) {
      lockerNos.add(r.locker_number);
      const s = (r.status ?? "").toLowerCase();
      if (s === "active") active++;
      else if (s === "terminate" || s === "terminated") terminated++;
    }
    return { total: allRows.length, uniqueLockers: lockerNos.size, active, terminated };
  }, [allRows]);

  // ---------- Exports ----------
  const canRevealNid = useCanRevealNationalId();
  const buildExportRows = async () => {
    // Only rows that map to a real occupancy record (not synthetic locker rows) have valid ids for reveal.
    const realIds = filtered.filter((r) => !r.__synthetic).map((r) => r.id);
    const nidMap = canRevealNid ? await fetchFullNationalIds("locker_occupancy", realIds) : new Map<string, string>();
    return filtered.map((r) => ({
      "Locker Number": r.locker_number,
      "Category": r.category,
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
    if (filtered.length === 0) { toast.error("Nothing to export with the current filters"); return; }
    if (!confirmNidExport()) return;
    const rows = await buildExportRows();
    downloadCsv(`occupancy${filterTag()}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`Exported ${rows.length.toLocaleString()} rows`);
  };

  const exportXlsx = async () => {
    if (filtered.length === 0) { toast.error("Nothing to export with the current filters"); return; }
    if (!confirmNidExport()) return;
    const rows = await buildExportRows();
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
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const targetSheet =
        category === "main" ? "Occupied + Vacant" :
        category === "staff" ? "Occupied + Staff" : "Occupied + Shoe";
      const sheet = wb.Sheets[targetSheet];
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
        .map((r) => ({
          category,
          locker_number: String(pick(r, "Combine Locker", "Locker Number") ?? "").trim(),
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
        }))
        .filter((r) => r.locker_number);

      if (records.length === 0) { toast.error("No rows found in the sheet"); return; }
      const { error: delErr } = await supabase.from("locker_occupancy").delete().eq("category", category);
      if (delErr) { toast.error(`Replace failed: ${delErr.message}`); return; }
      const CHUNK = 500;
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK);
        const { error } = await supabase.from("locker_occupancy").insert(slice);
        if (error) { toast.error(`Insert failed: ${error.message}`); return; }
      }
      toast.success(`Imported ${records.length.toLocaleString()} rows for ${CATEGORY_LABEL[category]}`);
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
        <StatCard label="Unique Lockers" value={stats.uniqueLockers} />
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
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setSyncOpen(true)} title="Reconcile occupancy with the Lockers page">
              <RefreshCw className="h-4 w-4 mr-1.5" /> Sync with Lockers page
            </Button>
          </>
        )}
        <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> Export CSV
        </Button>
        <Button variant="outline" onClick={exportXlsx} disabled={filtered.length === 0}>
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
            {allRows.length === 0
              ? "No data yet. Click \"Import Excel\" and upload your master listing workbook."
              : "No rows match these filters."}
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <div style={{ minWidth: GRID_TOTAL_WIDTH }}>
                <div className="bg-muted/50 grid text-left text-xs uppercase font-semibold tracking-wide text-muted-foreground" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
                  <Th><SortHeader label="Locker" col="locker" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Locker" values={columnValues.locker} selected={colFilters.locker ?? new Set()} onChange={setColFilter("locker")} /></Th>
                  <Th><SortHeader label="Category" col="cat" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Category" values={columnValues.cat} selected={colFilters.cat ?? new Set()} onChange={setColFilter("cat")} /></Th>
                  <Th><SortHeader label="Status" col="status" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Status" values={columnValues.status} selected={colFilters.status ?? new Set()} onChange={setColFilter("status")} /></Th>
                  <Th><SortHeader label="Badge" col="badge" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Badge" values={columnValues.badge} selected={colFilters.badge ?? new Set()} onChange={setColFilter("badge")} /></Th>
                  <Th><SortHeader label="Employee" col="emp" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Employee" values={columnValues.emp} selected={colFilters.emp ?? new Set()} onChange={setColFilter("emp")} /></Th>
                  <Th><SortHeader label="National ID" col="nid" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="National ID" values={columnValues.nid} selected={colFilters.nid ?? new Set()} onChange={setColFilter("nid")} /></Th>
                  <Th><SortHeader label="Intake" col="intake" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Intake" values={columnValues.intake} selected={colFilters.intake ?? new Set()} onChange={setColFilter("intake")} /></Th>
                  <Th><SortHeader label="Terminated" col="term" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Terminated" values={columnValues.term} selected={colFilters.term ?? new Set()} onChange={setColFilter("term")} /></Th>
                  <Th>Reason</Th>
                  <Th><SortHeader label="Work Location" col="work" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Work Location" values={columnValues.work} selected={colFilters.work ?? new Set()} onChange={setColFilter("work")} /></Th>
                  <Th>History</Th>
                </div>
                {flattened.length === 0 ? (
                  <div className="px-3 py-12 text-center text-muted-foreground text-sm">No rows match these filters.</div>
                ) : (
                  <List
                    rowComponent={OccupancyRow as any}
                    rowCount={flattened.length}
                    rowHeight={ROW_HEIGHT}
                    rowProps={{ rows: flattened, onViewHistory: setHistoryFor }}
                    style={{ height: Math.min(VIEWPORT_HEIGHT, flattened.length * ROW_HEIGHT + 4) }}
                  />
                )}
              </div>
            </div>
            <div className="sm:hidden divide-y">
              {(() => {
                const MOBILE_CAP = 150;
                const shown = visible.slice(0, MOBILE_CAP);
                return (
                  <>
                    {shown.map(([lockerNumber, group]) => (
                      <MobileLockerGroup key={lockerNumber} lockerNumber={lockerNumber} group={group} reason={reasons.get(lockerNumber) ?? null} onViewHistory={() => setHistoryFor(lockerNumber)} />
                    ))}
                    {visible.length > MOBILE_CAP && (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        Showing first {MOBILE_CAP} of {visible.length.toLocaleString()} lockers. Narrow the filters to see more.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="px-4 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
              Showing {grouped.length.toLocaleString()} locker{grouped.length === 1 ? "" : "s"} ({filtered.length.toLocaleString()} rows)
            </div>
          </>
        )}
      </Card>

      <HistoryDialog lockerNumber={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function syntheticRowFromLocker(l: Locker): Row {
  const st = (l.status ?? "").toLowerCase();
  const isActive = st === "active";
  return {
    id: `synthetic-${l.id}`,
    category: "main",
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
type OccupancyRowProps = { rows: FlatRow[]; onViewHistory: (lockerNumber: string) => void };
const OccupancyRow = memo(function OccupancyRow({ index, style, rows, onViewHistory }: RowComponentProps<OccupancyRowProps>) {
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
      <div className="px-3 truncate text-xs uppercase text-muted-foreground">{row.category}</div>
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
            <td className="px-3 py-2 text-xs uppercase text-muted-foreground">{r.category}</td>
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
  date: string | null;
  date_label: string;
  remarks: string | null;
  by: string | null;
};

function HistoryDialog({ lockerNumber, onClose }: { lockerNumber: string | null; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!lockerNumber) return;
    const ch = supabase
      .channel(`history-${lockerNumber}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "locker_occupancy", filter: `locker_number=eq.${lockerNumber}` }, () => setTick((t) => t + 1))
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
        supabase.from("terminations").select("*").eq("locker_number", lockerNumber).order("termination_date", { ascending: false }),
      ]);
      const out: HistoryEvent[] = [];
      for (const r of occ ?? []) {
        out.push({
          id: `o-${r.id}`,
          source: "occupancy",
          status: r.status ?? "—",
          employee_name: r.employee_name,
          badge_number: r.badge_number,
          date: (r.status ?? "").toLowerCase() === "active" ? r.batch_intake_date : r.termination_date,
          date_label: (r.status ?? "").toLowerCase() === "active" ? "Intake" : "Terminated",
          remarks: r.remarks,
          by: r.source_filename,
        });
      }
      for (const t of term ?? []) {
        out.push({
          id: `t-${t.id}`,
          source: "termination",
          status: "Terminate",
          employee_name: t.employee_name,
          badge_number: t.badge_number,
          date: t.termination_date,
          date_label: "Terminated",
          remarks: t.reason,
          by: t.terminated_by_email,
        });
      }
      out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      setEvents(out);
    })();
  }, [lockerNumber, tick]);

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
                    <Badge variant="outline" className="text-[10px] uppercase">{e.source}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.date_label}: {fmtDate(e.date)}
                    {e.by && <span> · {e.by}</span>}
                  </div>
                  {e.remarks && <div className="mt-1 text-xs italic text-muted-foreground">"{e.remarks}"</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
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
