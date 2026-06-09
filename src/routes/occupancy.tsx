import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
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

type Category = "main" | "staff" | "shoe";

type Row = {
  id: string;
  category: Category;
  locker_number: string;
  locker_row: string | null;
  locker_unit: string | null;
  locker_location_by_row: string | null;
  key_lock_type: string | null;
  badge_number: string | null;
  employee_name: string | null;
  national_id: string | null;
  work_location: string | null;
  contact: string | null;
  status: string | null;
  batch_intake_date: string | null;
  termination_date: string | null;
  gradeset: string | null;
  department: string | null;
  remarks: string | null;
  source_filename: string | null;
};

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
      <main className="max-w-[1500px] mx-auto px-6 py-8">
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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rowFilter, setRowFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [importing, setImporting] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [reasons, setReasons] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      setRows(null);
      const all: Row[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("locker_occupancy")
          .select("*")
          .eq("category", category)
          .range(from, from + 999);
        if (error) { toast.error(error.message); break; }
        if (!data) break;
        all.push(...(data as Row[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      setRows(all);

      // Latest termination reason per locker (for Reason column)
      if (category === "main") {
        const { data: terms } = await supabase
          .from("terminations")
          .select("locker_number,reason,termination_date")
          .order("termination_date", { ascending: false });
        const map = new Map<string, string>();
        for (const t of terms ?? []) {
          if (!t.locker_number || !t.reason) continue;
          if (!map.has(t.locker_number)) map.set(t.locker_number, t.reason);
        }
        setReasons(map);
      } else {
        setReasons(new Map());
      }
    })();
  }, [category, refresh]);

  // Auto-refresh when occupancy or terminations change elsewhere (e.g. after
  // saving a locker, marking active/terminated, or running automation).
  useEffect(() => {
    const schedule = () => {
      // Skip realtime refreshes while a bulk import is running — the chunked
      // inserts fire dozens of events and would cause the table to flash.
      if (importingRef.current) return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => setRefresh((k) => k + 1), 600);
    };
    const ch = supabase
      .channel(`occupancy-${category}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "locker_occupancy" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "lockers" }, schedule)
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(ch);
    };
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

  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (k: string) => (next: Set<string>) =>
    setColFilters((cur) => ({ ...cur, [k]: next }));

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
    f.sort((a, b) => {
      const c = compareLockerNumbers(a.locker_number, b.locker_number);
      if (c !== 0) return c;
      const aActive = (a.status ?? "").toLowerCase() === "active" ? 0 : 1;
      const bActive = (b.status ?? "").toLowerCase() === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.termination_date ?? "").localeCompare(a.termination_date ?? "");
    });
    return f;
  }, [rows, search, statusFilter, rowFilter, locFilter, colFilters]);

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
      setRefresh((k) => k + 1);
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
    setRefresh((k) => k + 1);
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
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search locker, employee, badge, dept…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="terminate">Terminated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={rowFilter} onValueChange={setRowFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Row" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All rows</SelectItem>
            {rowOpts.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={locFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Location" /></SelectTrigger>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <Th>Locker <ColumnFilter label="Locker" values={(rows ?? []).map((r) => r.locker_number)} selected={colFilters.locker ?? new Set()} onChange={setColFilter("locker")} /></Th>
                    <Th>Status <ColumnFilter label="Status" values={(rows ?? []).map((r) => r.status)} selected={colFilters.status ?? new Set()} onChange={setColFilter("status")} /></Th>
                    <Th>Badge <ColumnFilter label="Badge" values={(rows ?? []).map((r) => r.badge_number)} selected={colFilters.badge ?? new Set()} onChange={setColFilter("badge")} /></Th>
                    <Th>Employee <ColumnFilter label="Employee" values={(rows ?? []).map((r) => r.employee_name)} selected={colFilters.emp ?? new Set()} onChange={setColFilter("emp")} /></Th>
                    <Th>National ID <ColumnFilter label="National ID" values={(rows ?? []).map((r) => r.national_id)} selected={colFilters.nid ?? new Set()} onChange={setColFilter("nid")} /></Th>
                    <Th>Intake <ColumnFilter label="Intake" values={(rows ?? []).map((r) => fmtDate(r.batch_intake_date))} selected={colFilters.intake ?? new Set()} onChange={setColFilter("intake")} /></Th>
                    <Th>Terminated <ColumnFilter label="Terminated" values={(rows ?? []).map((r) => fmtDate(r.termination_date))} selected={colFilters.term ?? new Set()} onChange={setColFilter("term")} /></Th>
                    <Th>Reason</Th>
                    <Th>Work Location <ColumnFilter label="Work Location" values={(rows ?? []).map((r) => r.work_location)} selected={colFilters.work ?? new Set()} onChange={setColFilter("work")} /></Th>
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
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20">
              <div className="text-xs text-muted-foreground">
                Showing lockers {startIdx + 1}–{startIdx + visible.length} of {grouped.length.toLocaleString()} ({filtered.length.toLocaleString()} rows)
              </div>
              <div className="flex items-center gap-2">
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
              <Badge variant={isActive ? "default" : "secondary"} className={isActive ? "" : "text-muted-foreground"}>
                {r.status ?? "—"}
              </Badge>
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
              {events.map((e) => {
                const active = e.status.toLowerCase() === "active";
                return (
                  <li key={e.id} className="border rounded-md p-3 bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={active ? "default" : "secondary"}>{e.status}</Badge>
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
                );
              })}
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
