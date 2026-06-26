import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { StatusBadge } from "@/components/StatusBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, Upload as UploadIcon, History, ChevronLeft, ChevronRight, Trash2, Eye, Download, FilterX } from "lucide-react";
import { toast } from "sonner";
import { compareLockerNumbers, parseBatchIntake, NATIONAL_ID_HEADERS } from "@/lib/locker-utils";
import { downloadCsv } from "@/lib/csv-export";
import { ColumnFilter, passesColumnFilter } from "@/components/ColumnFilter";
import { SortHeader, type SortState } from "@/components/SortHeader";
import {
  encodeFilterState, decodeFilterState, writeFilterParam, readFilterParam,
  colFiltersToObj, objToColFilters, cycleSort,
} from "@/lib/url-filter-state";
import { useOccupancy, invalidateOccupancyCache, type OccupancyRow } from "@/lib/occupancy-cache";


type Category = "main" | "staff" | "shoe";

type Row = OccupancyRow;


const CATEGORY_LABEL: Record<Category, string> = {
  main: "Full Locker (Occupied + Vacant)",
  staff: "Staff Locker (Occupied + Staff)",
  shoe: "Shoe Locker (Occupied + Shoe)",
};

const PAGE_SIZE = 50;

export const Route = createFileRoute("/occupancy")({
  head: () => ({
    meta: [
      { title: "Occupancy History — LockerOps" },
      { name: "description", content: "Current and historical locker occupancy across Main, Staff, and Shoe lockers, including previous owners and terminations." },
    ],
  }),
  component: () => (<PageGuard permission="page_occupancy"><OccupancyPage /></PageGuard>),
});

function OccupancyPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<Category>("main");

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <History className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-bold">Occupancy History</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-5">
          Current holders and previous owners (including terminations) for every locker, sourced from the Occupied + Vacant sheets.
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Category)}>
          <TabsList>
            <TabsTrigger value="main">Full Lockers</TabsTrigger>
            <TabsTrigger value="staff">Staff Lockers</TabsTrigger>
            <TabsTrigger value="shoe">Shoe Lockers</TabsTrigger>
          </TabsList>
          {(["main", "staff", "shoe"] as Category[]).map((c) => (
            <TabsContent key={c} value={c}>
              <CategoryView category={c} isAdmin={isAdmin} />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}

function CategoryView({ category, isAdmin }: { category: Category; isAdmin: boolean }) {
  const { rows } = useOccupancy(category);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rowFilter, setRowFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);

  const [reasons, setReasons] = useState<Map<string, string>>(new Map());

  // Latest termination reason per locker (for Reason column on Full Lockers)
  useEffect(() => {
    if (category !== "main") { setReasons(new Map()); return; }
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
  }, [category]);


  useEffect(() => { setPage(1); }, [search, statusFilter, rowFilter, locFilter]);

  // Build filter option lists from data
  const { rowOpts, locOpts } = useMemo(() => {
    const r = new Set<string>(), l = new Set<string>();
    for (const x of rows ?? []) {
      if (x.locker_row) r.add(x.locker_row);
      if (x.locker_location_by_row) l.add(x.locker_location_by_row);
    }
    return { rowOpts: [...r].sort(), locOpts: [...l].sort() };
  }, [rows]);

  // Pre-extract column values once per data change so ColumnFilter props are
  // stable across keystrokes (avoids O(N) re-mapping on every search input).
  const columnValues = useMemo(() => {
    const rs = rows ?? [];
    return {
      locker: rs.map((r) => r.locker_number),
      status: rs.map((r) => r.status),
      badge: rs.map((r) => r.badge_number),
      emp: rs.map((r) => r.employee_name),
      nid: rs.map((r) => r.national_id),
      intake: rs.map((r) => fmtDate(r.batch_intake_date)),
      term: rs.map((r) => fmtDate(r.termination_date)),
      work: rs.map((r) => r.work_location),
    };
  }, [rows]);

  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (k: string) => (next: Set<string>) =>
    setColFilters((cur) => ({ ...cur, [k]: next }));

  // Click-to-sort (single column, cycle asc → desc → off).
  const [sort, setSort] = useState<SortState>(null);
  const onCycleSort = (col: string) => setSort((cur) => cycleSort(cur, col));

  // Per-category URL param so each tab keeps its own shareable state.
  const urlKey = `f_${category}`;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const s = decodeFilterState(readFilterParam(urlKey));
    if (s) {
      setSearch(s.q ?? "");
      const x = s.x ?? {};
      setStatusFilter(x.status ?? "all");
      setRowFilter(x.row ?? "all");
      setLocFilter(x.loc ?? "all");
      setColFilters(objToColFilters(s.cf));
      setSort(s.sort ?? null);
    } else {
      setSearch(""); setStatusFilter("all"); setRowFilter("all"); setLocFilter("all");
      setColFilters({}); setSort(null);
    }
    setHydrated(true);
     
  }, [category]);

  useEffect(() => {
    if (!hydrated) return;
    const encoded = encodeFilterState({
      cf: colFiltersToObj(colFilters),
      q: search,
      sort,
      x: { status: statusFilter, row: rowFilter, loc: locFilter },
    });
    writeFilterParam(encoded, urlKey);
  }, [hydrated, colFilters, search, sort, statusFilter, rowFilter, locFilter, urlKey]);

  const hasAnyFilter =
    !!search ||
    statusFilter !== "all" ||
    rowFilter !== "all" ||
    locFilter !== "all" ||
    sort !== null ||
    Object.values(colFilters).some((s) => s.size > 0);

  const clearAllFilters = () => {
    setSearch(""); setStatusFilter("all"); setRowFilter("all"); setLocFilter("all");
    setColFilters({}); setSort(null);
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.toLowerCase().trim();
    const f = rows.filter((r) => {
      const st = (r.status ?? "").toLowerCase();
      if (statusFilter === "active" && st !== "active") return false;
      if (statusFilter === "terminate" && st !== "terminate" && st !== "terminated") return false;
      if (rowFilter !== "all" && (r.locker_row ?? "") !== rowFilter) return false;
      if (locFilter !== "all" && (r.locker_location_by_row ?? "") !== locFilter) return false;
      if (!passesColumnFilter(r.locker_number, colFilters.locker ?? new Set())) return false;
      if (!passesColumnFilter(r.status, colFilters.status ?? new Set())) return false;
      if (!passesColumnFilter(r.badge_number, colFilters.badge ?? new Set())) return false;
      if (!passesColumnFilter(r.employee_name, colFilters.emp ?? new Set())) return false;
      if (!passesColumnFilter(r.national_id, colFilters.nid ?? new Set())) return false;
      if (!passesColumnFilter(fmtDate(r.batch_intake_date), colFilters.intake ?? new Set())) return false;
      if (!passesColumnFilter(fmtDate(r.termination_date), colFilters.term ?? new Set())) return false;
      if (!passesColumnFilter(r.work_location, colFilters.work ?? new Set())) return false;
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
  }, [rows, search, statusFilter, rowFilter, locFilter, colFilters, sort]);

  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("Nothing to export with the current filters"); return; }
    const rowsOut = filtered.map((r) => ({
      "Locker Number": r.locker_number,
      "Category": r.category,
      "Status": r.status ?? "",
      "Badge Number": r.badge_number ?? "",
      "Employee Name": r.employee_name ?? "",
      "National ID": r.national_id ?? "",
      "Work Location": r.work_location ?? "",
      "Locker Row": r.locker_row ?? "",
      "Locker Location": r.locker_location_by_row ?? "",
      "Key Lock": r.key_lock_type ?? "",
      "Batch Intake": fmtDate(r.batch_intake_date),
      "Termination Date": fmtDate(r.termination_date),
      "Department": r.department ?? "",
      "Gradeset": r.gradeset ?? "",
      "Remarks": r.remarks ?? "",
      "Source File": r.source_filename ?? "",
    }));
    downloadCsv(`occupancy_${category}_${new Date().toISOString().slice(0, 10)}.csv`, rowsOut);
    toast.success(`Exported ${rowsOut.length.toLocaleString()} rows`);
  };

  // Group by locker number — limit to 1 active + 1 most-recent terminate
  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const arr = m.get(r.locker_number) ?? [];
      arr.push(r);
      m.set(r.locker_number, arr);
    }
    // Trim each group: keep first Active + first Terminate (already sorted)
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
      // Fallback if neither matched (e.g. unknown status)
      if (out.length === 0) out.push(arr[0]);
      trimmed.push([k, out]);
    }
    return trimmed;
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const visible = grouped.slice(startIdx, startIdx + PAGE_SIZE);

  const stats = useMemo(() => {
    const s = { total: 0, active: 0, terminated: 0, lockers: new Set<string>() };
    for (const r of rows ?? []) {
      s.total++;
      const st = (r.status ?? "").toLowerCase();
      if (st === "active") s.active++;
      else if (st === "terminate" || st === "terminated") s.terminated++;
      s.lockers.add(r.locker_number);
    }
    return { ...s, uniqueLockers: s.lockers.size };
  }, [rows]);

  const handleImport = async (file: File) => {
    setImporting(true);
    importingRef.current = true;
    try {
      const buf = await file.arrayBuffer();
      // cellDates: true → real Date objects; raw: true keeps Date/number values
      // intact so parseBatchIntake handles every format consistently.
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const targetSheet =
        category === "main" ? "Occupied + Vacant" :
        category === "staff" ? "Occupied + Staff" : "Occupied + Shoe";
      const sheet = wb.Sheets[targetSheet];
      if (!sheet) {
        toast.error(`Sheet "${targetSheet}" not found in this workbook`);
        return;
      }
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

      if (records.length === 0) {
        toast.error("No rows found in the sheet");
        return;
      }

      // Replace existing rows for this category
      const { error: delErr } = await supabase.from("locker_occupancy").delete().eq("category", category);
      if (delErr) { toast.error(`Replace failed: ${delErr.message}`); return; }

      // Insert in chunks
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
      importingRef.current = false;
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleClear = async () => {
    if (!confirm(`Clear all ${CATEGORY_LABEL[category]} occupancy rows? This cannot be undone.`)) return;
    const { error } = await supabase.from("locker_occupancy").delete().eq("category", category);
    if (error) { toast.error(error.message); return; }
    toast.success("Cleared");
    invalidateOccupancyCache(category);
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
          </SelectContent>
        </Select>
        <Select value={rowFilter} onValueChange={setRowFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Row" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All rows</SelectItem>
            {rowOpts.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
              <UploadIcon className="h-4 w-4 mr-1.5" />
              {importing ? "Importing…" : "Import Excel"}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleClear} title="Clear category" disabled={importing}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        )}
        {isAdmin && (
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        )}
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
        {!rows ? (
          <div className="p-6 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : grouped.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {(rows.length === 0)
              ? "No data yet. Click \"Import Excel\" and upload your master listing workbook."
              : "No rows match these filters."}
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <Th><SortHeader label="Locker" col="locker" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Locker" values={columnValues.locker} selected={colFilters.locker ?? new Set()} onChange={setColFilter("locker")} /></Th>
                    <Th><SortHeader label="Status" col="status" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Status" values={columnValues.status} selected={colFilters.status ?? new Set()} onChange={setColFilter("status")} /></Th>
                    <Th><SortHeader label="Badge" col="badge" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Badge" values={columnValues.badge} selected={colFilters.badge ?? new Set()} onChange={setColFilter("badge")} /></Th>
                    <Th><SortHeader label="Employee" col="emp" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Employee" values={columnValues.emp} selected={colFilters.emp ?? new Set()} onChange={setColFilter("emp")} /></Th>
                    <Th><SortHeader label="National ID" col="nid" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="National ID" values={columnValues.nid} selected={colFilters.nid ?? new Set()} onChange={setColFilter("nid")} /></Th>
                    <Th><SortHeader label="Intake" col="intake" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Intake" values={columnValues.intake} selected={colFilters.intake ?? new Set()} onChange={setColFilter("intake")} /></Th>
                    <Th><SortHeader label="Terminated" col="term" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Terminated" values={columnValues.term} selected={colFilters.term ?? new Set()} onChange={setColFilter("term")} /></Th>
                    <Th>Reason</Th>
                    <Th><SortHeader label="Work Location" col="work" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Work Location" values={columnValues.work} selected={colFilters.work ?? new Set()} onChange={setColFilter("work")} /></Th>
                    <Th>History</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(([lockerNumber, group]) => (
                    <LockerGroup key={lockerNumber} lockerNumber={lockerNumber} group={group} reason={reasons.get(lockerNumber) ?? null} onViewHistory={() => setHistoryFor(lockerNumber)} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y">
              {visible.map(([lockerNumber, group]) => (
                <MobileLockerGroup key={lockerNumber} lockerNumber={lockerNumber} group={group} reason={reasons.get(lockerNumber) ?? null} onViewHistory={() => setHistoryFor(lockerNumber)} />
              ))}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-4 py-3 border-t bg-muted/20">
              <div className="text-xs text-muted-foreground">
                Showing lockers {startIdx + 1}–{startIdx + visible.length} of {grouped.length.toLocaleString()} ({filtered.length.toLocaleString()} rows)
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <span className="text-sm font-medium px-2">Page {safePage} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>

          </>
        )}
      </Card>

      <HistoryDialog lockerNumber={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

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
            <td className="px-3 py-2">
              <StatusBadge status={r.status} />
            </td>
            <td className="px-3 py-2 font-mono text-xs">{r.badge_number ?? "—"}</td>
            <td className="px-3 py-2">{r.employee_name ?? <span className="text-muted-foreground italic">vacant</span>}</td>
            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.national_id ?? "—"}</td>
            <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(r.batch_intake_date)}</td>
            <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(r.termination_date)}</td>
            <td className="px-3 py-2 text-muted-foreground text-xs max-w-[220px] truncate" title={(!isActive ? (r.remarks || reason || "") : "") || undefined}>
              {!isActive ? (r.remarks || reason || "—") : "—"}
            </td>
            <td className="px-3 py-2 text-muted-foreground text-xs">
              {r.work_location ?? "—"}
            </td>
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
  const rest = group.slice(1);
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-semibold text-base truncate">{lockerNumber}</div>
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
              <MField label="National ID" value={r.national_id} mono />
              <MField label="Intake" value={fmtDate(r.batch_intake_date)} />
              <MField label="Terminated" value={fmtDate(r.termination_date)} />
              <MField label="Work" value={r.work_location} wide />
              {!isActive && <MField label="Reason" value={r.remarks || reason || "—"} wide />}
            </div>
          </div>
        );
      })}
      {rest.length === 0 && null}
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
  return <th className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</th>;
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
