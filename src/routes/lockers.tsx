import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useMemo, useState, memo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, Download, FilterX } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { List, type RowComponentProps } from "react-window";
import { compareLockerNumbers, parseBatchIntake, formatBatchIntake } from "@/lib/locker-utils";
import { downloadCsv } from "@/lib/csv-export";
import { DeleteLocationDialog } from "@/components/DeleteLocationDialog";
import { DeleteLockerByNumberDialog } from "@/components/DeleteLockerByNumberDialog";
import { LOCKER_STATUSES, STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import { useBatchIntakeWarningSet } from "@/lib/batch-intake-warnings";
import { AlertTriangle } from "lucide-react";
import { ColumnFilter, passesColumnFilter } from "@/components/ColumnFilter";
import { SortHeader, type SortState } from "@/components/SortHeader";
import {
  encodeFilterState, decodeFilterState, writeFilterParam, readFilterParam,
  colFiltersToObj, objToColFilters, cycleSort,
} from "@/lib/url-filter-state";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 640;
const COLS = [
  { key: "num", w: 110 },
  { key: "loc", w: 160 },
  { key: "row", w: 110 },
  { key: "key_lock", w: 160 },
  { key: "badge", w: 110 },
  { key: "nid", w: 140 },
  { key: "emp", w: 200 },
  { key: "work", w: 160 },
  { key: "status", w: 130 },
  { key: "batch", w: 130 },
];
const GRID_TEMPLATE = COLS.map((c) => `${c.w}px`).join(" ");
const GRID_TOTAL_WIDTH = COLS.reduce((s, c) => s + c.w, 0);
const LOCKERS_FILTER_STORAGE_KEY = "lockerops.lockers.filters";

type LockerFilterState = {
  search: string;
  statusFilter: string;
  locFilter: string;
  keyLockFilter: string;
  missingNidFilter: boolean;
  missingBadgeFilter: boolean;
};

const DEFAULT_LOCKER_FILTERS: LockerFilterState = {
  search: "",
  statusFilter: "all",
  locFilter: "all",
  keyLockFilter: "all",
  missingNidFilter: false,
  missingBadgeFilter: false,
};

function readLockerFilters(): LockerFilterState {
  if (typeof window === "undefined") return DEFAULT_LOCKER_FILTERS;
  try {
    const stored = window.localStorage.getItem(LOCKERS_FILTER_STORAGE_KEY);
    if (!stored) return DEFAULT_LOCKER_FILTERS;
    const parsed = JSON.parse(stored) as Partial<LockerFilterState>;
    return { ...DEFAULT_LOCKER_FILTERS, ...parsed };
  } catch {
    return DEFAULT_LOCKER_FILTERS;
  }
}

function writeLockerFilters(filters: LockerFilterState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCKERS_FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage failures so filters still work normally for the current session.
  }
}

export const Route = createFileRoute("/lockers")({
  head: () => ({
    meta: [
      { title: "Lockers — LockerOps" },
      { name: "description", content: "Searchable, filterable table of every locker and assigned employee." },
    ],
  }),
  component: () => (<PageGuard permission="page_lockers"><LockersPage /></PageGuard>),
});

function LockersPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const { lockers: rawLockers } = useLockers();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [statusFilter, setStatusFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [keyLockFilter, setKeyLockFilter] = useState("all");
  const [missingNidFilter, setMissingNidFilter] = useState(false);
  const [missingBadgeFilter, setMissingBadgeFilter] = useState(false);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { set: batchWarnings, store: batchWarningStore } = useBatchIntakeWarningSet();

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    // URL takes precedence over localStorage so shared links work.
    const urlState = decodeFilterState(readFilterParam());
    if (urlState) {
      if (urlState.q !== undefined) setSearch(urlState.q);
      const x = urlState.x ?? {};
      setStatusFilter(x.status ?? "all");
      setLocFilter(x.loc ?? "all");
      setKeyLockFilter(x.keyLock ?? "all");
      setMissingNidFilter(x.missingNid === "true");
      setMissingBadgeFilter(x.missingBadge === "true");
      setColFilters(objToColFilters(urlState.cf));
      setSort(urlState.sort ?? null);
    } else {
      const stored = readLockerFilters();
      setSearch(stored.search);
      setStatusFilter(stored.statusFilter);
      setLocFilter(stored.locFilter);
      setKeyLockFilter(stored.keyLockFilter);
      setMissingNidFilter(stored.missingNidFilter);
      setMissingBadgeFilter(stored.missingBadgeFilter);
    }
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    writeLockerFilters({ search, statusFilter, locFilter, keyLockFilter, missingNidFilter, missingBadgeFilter });
  }, [filtersHydrated, search, statusFilter, locFilter, keyLockFilter, missingNidFilter, missingBadgeFilter]);

  // Sort once when underlying data changes (avoid re-sorting on every render)
  const lockers = useMemo(() => {
    if (!rawLockers) return null;
    return [...rawLockers].sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
  }, [rawLockers]);

  const locations = useMemo(() => {
    if (!lockers) return [];
    return Array.from(new Set(lockers.map((l) => l.location))).sort();
  }, [lockers]);

  const keyLocks = useMemo(() => {
    if (!lockers) return [];
    return Array.from(new Set(lockers.map((l) => (l.key_lock ?? "").trim()).filter(Boolean))).sort();
  }, [lockers]);

  // Excel-style per-column checkbox filters (keyed by column id in COLS).
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (k: string) => (next: Set<string>) =>
    setColFilters((cur) => ({ ...cur, [k]: next }));

  // Click-to-sort state (single column at a time, cycles asc → desc → none).
  const [sort, setSort] = useState<SortState>(null);
  const onCycleSort = (col: string) => setSort((cur) => cycleSort(cur, col));

  // Mirror current filter/sort state into the URL ?f= param for sharing.
  useEffect(() => {
    if (!filtersHydrated) return;
    const x: Record<string, string> = { status: statusFilter, loc: locFilter, keyLock: keyLockFilter };
    if (missingNidFilter) x.missingNid = "true";
    if (missingBadgeFilter) x.missingBadge = "true";
    const encoded = encodeFilterState({
      cf: colFiltersToObj(colFilters),
      q: search,
      sort,
      x,
    });
    writeFilterParam(encoded);
  }, [filtersHydrated, colFilters, search, sort, statusFilter, locFilter, keyLockFilter, missingNidFilter, missingBadgeFilter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const hasAnyFilter =
    !!search ||
    statusFilter !== "all" ||
    locFilter !== "all" ||
    keyLockFilter !== "all" ||
    sort !== null ||
    Object.values(colFilters).some((s) => s.size > 0);

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setLocFilter("all");
    setKeyLockFilter("all");
    setColFilters({});
    setSort(null);
  };

  const filtered = useMemo(() => {
    if (!lockers) return [];
    const q = debouncedSearch.toLowerCase().trim();
    const base = lockers.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (locFilter !== "all" && l.location !== locFilter) return false;
      if (keyLockFilter !== "all") {
        const k = (l.key_lock ?? "").trim();
        if (keyLockFilter === "__none__" ? k !== "" : k !== keyLockFilter) return false;
      }
      if (!passesColumnFilter(l.locker_number, colFilters.num ?? new Set())) return false;
      if (!passesColumnFilter(l.location, colFilters.loc ?? new Set())) return false;
      if (!passesColumnFilter(l.row_label, colFilters.row ?? new Set())) return false;
      if (!passesColumnFilter(l.key_lock, colFilters.key_lock ?? new Set())) return false;
      if (!passesColumnFilter(l.badge_number, colFilters.badge ?? new Set())) return false;
      if (!passesColumnFilter(l.national_id, colFilters.nid ?? new Set())) return false;
      if (!passesColumnFilter(l.employee_name, colFilters.emp ?? new Set())) return false;
      if (!passesColumnFilter(l.work_location, colFilters.work ?? new Set())) return false;
      if (!passesColumnFilter(l.status, colFilters.status ?? new Set())) return false;
      if (!passesColumnFilter(formatBatchIntake(l.batch_intake), colFilters.batch ?? new Set())) return false;
      if (!q) return true;
      return (
        l.locker_number.toLowerCase().includes(q) ||
        l.employee_name?.toLowerCase().includes(q) ||
        l.badge_number?.toLowerCase().includes(q) ||
        l.key_lock?.toLowerCase().includes(q)
      );
    });
    if (!sort) return base;
    // Map column key → accessor. Locker # uses natural locker-number ordering.
    const accessors: Record<string, (l: Locker) => string | number | null | undefined> = {
      num: (l) => l.locker_number,
      loc: (l) => l.location,
      row: (l) => l.row_label,
      key_lock: (l) => l.key_lock,
      badge: (l) => l.badge_number,
      nid: (l) => l.national_id,
      emp: (l) => l.employee_name,
      work: (l) => l.work_location,
      status: (l) => l.status,
      batch: (l) => l.batch_intake, // ISO; lexical compare == chronological
    };
    const get = accessors[sort.col] ?? accessors.num;
    const dir = sort.dir === "asc" ? 1 : -1;
    const sorted = [...base].sort((a, b) => {
      if (sort.col === "num") return compareLockerNumbers(a.locker_number, b.locker_number) * dir;
      const av = get(a), bv = get(b);
      const ae = av == null || av === "";
      const be = bv == null || bv === "";
      if (ae && be) return 0;
      if (ae) return 1;   // blanks last regardless of direction
      if (be) return -1;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
    return sorted;
  }, [lockers, debouncedSearch, statusFilter, locFilter, keyLockFilter, colFilters, sort]);


  const buildExportRows = () => filtered.map((l) => ({
    "Locker Number": l.locker_number,
    "Location": l.location,
    "Row": l.row_label ?? "",
    "Unit Type": l.unit_type ?? "",
    "Key Lock": l.key_lock ?? "",
    "Badge Number": l.badge_number ?? "",
    "National ID": l.national_id ?? "",
    "Employee Name": l.employee_name ?? "",
    "Work Location": l.work_location ?? "",
    "Status": STATUS_LABEL[l.status as LockerStatus] ?? l.status,
    "Batch Intake": formatBatchIntake(l.batch_intake),
    "Remark": l.remark ?? "",
  }));

  const filterTag = () => {
    const parts: string[] = [];
    if (statusFilter !== "all") parts.push(statusFilter);
    if (locFilter !== "all") parts.push(locFilter.replace(/\s+/g, "_"));
    if (keyLockFilter !== "all") parts.push((keyLockFilter === "__none__" ? "no-key-lock" : keyLockFilter).replace(/\s+/g, "_"));
    return parts.length ? `_${parts.join("-")}` : "";
  };

  const exportCsv = () => {
    const rows = buildExportRows();
    if (rows.length === 0) { toast.error("Nothing to export with the current filters"); return; }
    downloadCsv(`lockers${filterTag()}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`Exported ${rows.length.toLocaleString()} rows`);
  };

  const exportXlsx = () => {
    const rows = buildExportRows();
    if (rows.length === 0) { toast.error("Nothing to export with the current filters"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lockers");

    // Auto-width columns
    const headers = Object.keys(rows[0] ?? {});
    ws["!cols"] = headers.map((h) => {
      const maxLen = Math.max(
        h.length,
        ...rows.map((r) => String(r[h as keyof typeof rows[0]] ?? "").length)
      );
      return { wch: maxLen + 2 };
    });

    // Bold header with dark background and white text
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

    XLSX.writeFile(wb, `LockerOps_lockers${filterTag()}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exported ${rows.length.toLocaleString()} rows`);
  };

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold">Lockers</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {lockers?.length.toLocaleString() ?? "…"} total · {filtered.length.toLocaleString()} match
            </p>
          </div>
          {role === "admin" && (
            <div className="flex gap-2 flex-wrap">
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4 mr-1" /> Add Locker</Button>
                </DialogTrigger>
                <AddLockerDialog
                  onClose={() => setAddOpen(false)}
                  onCreated={() => { setAddOpen(false); invalidateLockersCache(); }}
                  existingLocations={locations}
                />
              </Dialog>
              <DeleteLockerByNumberDialog onDeleted={() => invalidateLockersCache()} />
              <DeleteLocationDialog
                locations={locations}
                onDeleted={() => invalidateLockersCache()}
              />
            </div>
          )}
        </div>

        <Card className="p-4 mt-6 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input ref={searchInputRef} placeholder="Search locker, employee, badge, key lock…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            {!search && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none hidden sm:inline">
                Press / to search
              </span>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LOCKER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locFilter} onValueChange={setLocFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={keyLockFilter} onValueChange={setKeyLockFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Key lock" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All key locks</SelectItem>
              <SelectItem value="__none__">No key lock</SelectItem>
              {keyLocks.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={filtered.length === 0}>
                <Download className="h-4 w-4 mr-1.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportXlsx}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}>CSV (.csv)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={clearAllFilters}
            disabled={!hasAnyFilter}
            title="Clear all filters, search, and sorting"
          >
            <FilterX className="h-4 w-4 mr-1.5" /> Clear filters
          </Button>
        </Card>

        {batchWarnings.size > 0 && (
          <div className="mt-4 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">
                {batchWarnings.size.toLocaleString()} locker{batchWarnings.size === 1 ? "" : "s"} are missing a batch intake date
              </div>
              <div className="text-xs text-muted-foreground">
                From the most recent upload{batchWarningStore?.filename ? ` (${batchWarningStore.filename})` : ""} — affected rows are highlighted in amber.
              </div>
            </div>
          </div>
        )}

        <Card className="mt-4 overflow-hidden">
          {!lockers ? (
            <div className="p-6 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: GRID_TOTAL_WIDTH }}>
                <div className="bg-muted/50 grid text-left text-xs uppercase font-semibold tracking-wide text-muted-foreground" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
                  <Th><SortHeader label="Locker #" col="num" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Locker #" values={lockers.map((l) => l.locker_number)} selected={colFilters.num ?? new Set()} onChange={setColFilter("num")} /></Th>
                  <Th><SortHeader label="Location" col="loc" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Location" values={lockers.map((l) => l.location)} selected={colFilters.loc ?? new Set()} onChange={setColFilter("loc")} /></Th>
                  <Th><SortHeader label="Row" col="row" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Row" values={lockers.map((l) => l.row_label)} selected={colFilters.row ?? new Set()} onChange={setColFilter("row")} /></Th>
                  <Th><SortHeader label="Key Lock" col="key_lock" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Key Lock" values={lockers.map((l) => l.key_lock)} selected={colFilters.key_lock ?? new Set()} onChange={setColFilter("key_lock")} /></Th>
                  <Th><SortHeader label="Badge" col="badge" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Badge" values={lockers.map((l) => l.badge_number)} selected={colFilters.badge ?? new Set()} onChange={setColFilter("badge")} /></Th>
                  <Th><SortHeader label="National ID" col="nid" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="National ID" values={lockers.map((l) => l.national_id)} selected={colFilters.nid ?? new Set()} onChange={setColFilter("nid")} /></Th>
                  <Th><SortHeader label="Employee" col="emp" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Employee" values={lockers.map((l) => l.employee_name)} selected={colFilters.emp ?? new Set()} onChange={setColFilter("emp")} /></Th>
                  <Th><SortHeader label="Work Location" col="work" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Work Location" values={lockers.map((l) => l.work_location)} selected={colFilters.work ?? new Set()} onChange={setColFilter("work")} /></Th>
                  <Th><SortHeader label="Status" col="status" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Status" values={lockers.map((l) => l.status)} selected={colFilters.status ?? new Set()} onChange={setColFilter("status")} /></Th>
                  <Th><SortHeader label="Batch" col="batch" sort={sort} onCycle={onCycleSort} /> <ColumnFilter label="Batch" values={lockers.map((l) => formatBatchIntake(l.batch_intake))} selected={colFilters.batch ?? new Set()} onChange={setColFilter("batch")} /></Th>
                </div>
                {filtered.length === 0 ? (
                  <div className="px-3 py-12 text-center text-muted-foreground text-sm">No lockers match these filters.</div>
                ) : (
                  <List
                    rowComponent={LockerRow as any}
                    rowCount={filtered.length}
                    rowHeight={ROW_HEIGHT}
                    rowProps={{ rows: filtered, onPick: setSelected, warnings: batchWarnings }}
                    style={{ height: Math.min(VIEWPORT_HEIGHT, filtered.length * ROW_HEIGHT + 4) }}
                  />
                )}
              </div>
              <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
                Showing {filtered.length.toLocaleString()} locker{filtered.length === 1 ? "" : "s"}
              </div>
            </div>
          )}
        </Card>
      </main>
      <LockerDetail lockerId={selected} open={!!selected} onClose={() => setSelected(null)} onUpdated={() => invalidateLockersCache()} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2.5">{children}</div>;
}

function StatusBadge({ status }: { status: string }) {
  const swatch = STATUS_SWATCH[status as LockerStatus] ?? "bg-muted-foreground";
  const label = STATUS_LABEL[status as LockerStatus] ?? status;
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </Badge>
  );
}

type LockerRowProps = { rows: Locker[]; onPick: (id: string) => void; warnings: Set<string> };
const LockerRow = memo(function LockerRow({ index, style, rows, onPick, warnings }: RowComponentProps<LockerRowProps>) {
  const l = rows[index];
  const flagged = warnings.has(l.locker_number.trim().toUpperCase());
  return (
    <div
      style={{ ...style, gridTemplateColumns: GRID_TEMPLATE }}
      onClick={() => onPick(l.id)}
      className={`grid items-center border-t hover:bg-muted/40 cursor-pointer text-sm ${flagged ? "bg-warning/10 hover:bg-warning/15" : ""}`}
      title={flagged ? "Batch intake date could not be parsed in the most recent upload" : undefined}
    >
      <div className="px-3 truncate font-medium flex items-center gap-1.5">
        {flagged && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden />}
        <span className="truncate">{l.locker_number}</span>
      </div>
      <div className="px-3 truncate">{l.location}</div>
      <div className="px-3 truncate text-muted-foreground">{l.row_label}</div>
      <div className="px-3 truncate text-xs text-muted-foreground">{l.key_lock ?? "—"}</div>
      <div className="px-3 truncate text-muted-foreground">{l.badge_number ?? "—"}</div>
      <div className="px-3 truncate text-xs text-muted-foreground">{l.national_id ?? "—"}</div>
      <div className="px-3 truncate">{l.employee_name ?? <span className="text-muted-foreground italic">{STATUS_LABEL[l.status as LockerStatus] ?? "—"}</span>}</div>
      <div className="px-3 truncate text-muted-foreground">{l.work_location ?? "—"}</div>
      <div className="px-3"><StatusBadge status={l.status} /></div>
      <div className={`px-3 truncate text-xs ${flagged ? "text-warning font-medium" : "text-muted-foreground"}`}>
        {formatBatchIntake(l.batch_intake) || (flagged ? "missing" : "")}
      </div>
    </div>
  );
});

// ---------- Add Locker Dialog (manual entry) ----------
function AddLockerDialog({
  onClose,
  onCreated,
  existingLocations,
}: {
  onClose: () => void;
  onCreated: () => void;
  existingLocations: string[];
}) {
  const [form, setForm] = useState({
    locker_number: "",
    location: existingLocations[0] ?? "",
    row_label: "",
    unit_type: "",
    key_lock: "",
    badge_number: "",
    employee_name: "",
    status: "empty" as Database["public"]["Enums"]["locker_status"],
    batch_intake: "",
    remark: "",
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.locker_number.trim()) {
      toast.error("Locker number is required");
      return;
    }
    if (!form.location.trim()) {
      toast.error("Location is required");
      return;
    }
    setSaving(true);
    const hasBadge = !!form.badge_number.trim();
    const finalStatus = hasBadge && form.status === "empty" ? "active" : form.status;
    const { data: inserted, error } = await supabase.from("lockers").insert({
      locker_number: form.locker_number.trim(),
      location: form.location.trim(),
      row_label: form.row_label.trim() || null,
      unit_type: form.unit_type.trim() || null,
      key_lock: form.key_lock.trim() || null,
      badge_number: form.badge_number.trim() || null,
      employee_name: form.employee_name.trim() || null,
      status: finalStatus,
      batch_intake: parseBatchIntake(form.batch_intake),
      remark: form.remark.trim() || null,
    }).select("*").single();
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That locker number already exists" : error.message);
      return;
    }
    if (inserted && finalStatus === "active" && (inserted.employee_name || inserted.badge_number)) {
      const { syncActivationToOccupancy } = await import("@/lib/occupancy-sync");
      await syncActivationToOccupancy(inserted);
    }
    toast.success(`Locker ${form.locker_number} added`);
    onCreated();
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display">Add new locker</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4 py-2">
        <div>
          <Label>Locker Number *</Label>
          <Input value={form.locker_number} onChange={(e) => set("locker_number", e.target.value)} placeholder="e.g. 1A, A01, LK01, AA01" />
        </div>
        <div>
          <Label>Location *</Label>
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Building A" list="loc-list" />
          <datalist id="loc-list">
            {existingLocations.map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>
        <div>
          <Label>Row</Label>
          <Input value={form.row_label} onChange={(e) => set("row_label", e.target.value)} placeholder="e.g. Nine Row" />
        </div>
        <div>
          <Label>Unit Type</Label>
          <Input value={form.unit_type} onChange={(e) => set("unit_type", e.target.value)} placeholder="e.g. Horizontal" />
        </div>
        <div>
          <Label>Key Lock</Label>
          <Input value={form.key_lock} onChange={(e) => set("key_lock", e.target.value)} placeholder="e.g. Round Lock Key" />
        </div>
        <div>
          <Label>Badge Number</Label>
          <Input value={form.badge_number} onChange={(e) => set("badge_number", e.target.value)} />
        </div>
        <div>
          <Label>Employee Name</Label>
          <Input value={form.employee_name} onChange={(e) => set("employee_name", e.target.value)} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v as typeof form.status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOCKER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Batch Intake (dd/mm/yyyy)</Label>
          <Input value={form.batch_intake} onChange={(e) => set("batch_intake", e.target.value)} placeholder="16/01/2026" />
        </div>
        <div className="col-span-2">
          <Label>Remark</Label>
          <Input value={form.remark} onChange={(e) => set("remark", e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add Locker"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

