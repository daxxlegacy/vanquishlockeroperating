import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { CompartmentPopover } from "@/components/CompartmentPopover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, ClipboardCheck, Upload as UploadIcon, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  getLayout,
  saveLayout,
  clearLayoutOverride,
  hasLayoutOverride,
  parseLayoutFromFile,
  onLayoutChange,
  type MapLayout,
  type SheetLayout,
} from "@/lib/map-layout";
import { useBatchIntakeWarningSet } from "@/lib/batch-intake-warnings";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Locker Map — LockerOps" },
      { name: "description", content: "Interactive locker map mirroring the physical layout of each area." },
    ],
  }),
  component: () => (<PageGuard permission="page_map"><MapPage /></PageGuard>),
});

import { STATUS_CELL, STATUS_SWATCH, STATUS_LABEL, LOCKER_STATUSES, type LockerStatus } from "@/lib/locker-status";

const STATUS_COLORS: Record<string, string> = {
  ...STATUS_CELL,
  mixed: "bg-gradient-to-br from-destructive via-warning to-success border-border text-foreground shadow-sm",
};
const NOT_IN_DB = "bg-background border-dashed border-border text-muted-foreground/70";

/** Group key for a locker code.
 *  - Numeric series with trailing letters: "1A" -> "1", "6075B" -> "6075", "6114WX" -> "6114"
 *  - Letter-prefixed series: "W01" -> "W", "AA18" -> "AA", "LK05" -> "LK"
 *  - Bare letter labels on the map ("W", "AA") map to themselves. */
function prefixOf(n: string): string {
  const u = n.trim().toUpperCase();
  const numWithLetter = u.match(/^(\d+)[A-Z]*$/);
  if (numWithLetter) return numWithLetter[1];
  const letterPrefixed = u.match(/^([A-Z]{1,3})\d+$/);
  if (letterPrefixed) return letterPrefixed[1];
  const bareLetters = u.match(/^([A-Z]{1,3})$/);
  if (bareLetters) return bareLetters[1];
  return u;
}

/** Aggregate status across compartments: active > repair > empty. Returns "mixed" when both occupied + empty exist. */
function aggregateStatus(group: Locker[]): string {
  if (group.length === 0) return "unknown";
  const set = new Set(group.map((l) => l.status));
  if (set.size === 1) return [...set][0];
  // Mixed: prefer to show that some are filled, some are not
  if (set.has("active") && set.has("empty")) return "mixed";
  if (set.has("active")) return "active";
  if (set.has("repair")) return "repair";
  if (set.has("empty")) return "empty";
  return "unknown";
}

function MapPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compartmentNumber, setCompartmentNumber] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSheet, setActiveSheet] = useState<string | undefined>(undefined);
  const [showValidation, setShowValidation] = useState(false);
  const [LAYOUT, setLAYOUT] = useState<MapLayout>(() => getLayout());
  const [hasOverride, setHasOverride] = useState<boolean>(() => hasLayoutOverride());
  const { set: batchIntakeWarnings, store: batchWarningStore } = useBatchIntakeWarningSet();

  useEffect(() => {
    const off = onLayoutChange(() => {
      setLAYOUT(getLayout());
      setHasOverride(hasLayoutOverride());
    });
    return off;
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const all: Locker[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("*")
          .is("deleted_at", null)
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (!cancelled) setLockers(all);
    })();

    // Live sync: any change to a locker (status, employee, etc.) reflects on the map immediately.
    const channel = supabase
      .channel("lockers-map-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "lockers" }, (payload) => {
        setLockers((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          if (payload.eventType === "INSERT") {
            const row = payload.new as Locker;
            if (!row.deleted_at) next.push(row);
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Locker;
            const idx = next.findIndex((l) => l.id === row.id);
            if (row.deleted_at) {
              if (idx >= 0) next.splice(idx, 1);
            } else if (idx >= 0) next[idx] = row;
            else next.push(row);
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<Locker>;
            const idx = next.findIndex((l) => l.id === old.id);
            if (idx >= 0) next.splice(idx, 1);
          }
          return next;
        });
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user, refreshKey]);

  // Group lockers by their number prefix so map cell "1" finds 1A..1F
  const byPrefix = useMemo(() => {
    const m = new Map<string, Locker[]>();
    if (lockers) {
      for (const l of lockers) {
        const p = prefixOf(l.locker_number);
        if (!m.has(p)) m.set(p, []);
        m.get(p)!.push(l);
      }
    }
    return m;
  }, [lockers]);

  const summary = useMemo(() => {
    if (!lockers) return null;
    const counts: Record<string, number> = { total: lockers.length };
    for (const s of LOCKER_STATUSES) counts[s] = 0;
    for (const l of lockers) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  }, [lockers]);

  const categorySummary = useMemo(() => {
    if (!lockers) return null;
    const cats = ["Full", "Staff", "Shoe", "HR"] as const;
    type Cat = (typeof cats)[number];
    const empty = () => {
      const o: Record<string, number> = { total: 0 };
      for (const s of LOCKER_STATUSES) o[s] = 0;
      return o;
    };
    const out: Record<Cat, Record<string, number>> = {
      Full: empty(), Staff: empty(), Shoe: empty(), HR: empty(),
    };
    const classify = (n: string): Cat => {
      const s = (n ?? "").toUpperCase().trim();
      if (s.startsWith("LK")) return "HR";
      if (/^\d/.test(s)) return "Full";
      // alpha prefix
      const m = s.match(/^([A-Z]+)/);
      const alpha = m ? m[1] : "";
      if (alpha.length >= 2) return "Staff";
      return "Shoe";
    };
    for (const l of lockers) {
      const c = classify(l.locker_number);
      out[c].total++;
      out[c][l.status] = (out[c][l.status] ?? 0) + 1;
    }
    return out;
  }, [lockers]);

  if (loading || !user) return <FullPageLoader />;

  const sheetNames = Object.keys(LAYOUT);
  const compartments = compartmentNumber ? byPrefix.get(prefixOf(compartmentNumber)) ?? [] : [];

  const handleUploadLayout = async (file: File) => {
    try {
      const layout = await parseLayoutFromFile(file);
      saveLayout(layout);
      toast.success(`Map layout updated — ${Object.keys(layout).length} sheet(s) imported.`);
      setActiveSheet(Object.keys(layout)[0]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to read layout file");
    }
  };

  const handleResetLayout = () => {
    clearLayoutOverride();
    toast.success("Restored default map layout.");
    setActiveSheet(undefined);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Locker Map</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Click any locker number to see its A–F compartments.
            </p>
          </div>
          <Legend />
        </div>

        {role === "admin" && (
          <MapLayoutUploader
            hasOverride={hasOverride}
            onUpload={handleUploadLayout}
            onReset={handleResetLayout}
          />
        )}

        {batchIntakeWarnings.size > 0 && (
          <div className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">
                {batchIntakeWarnings.size.toLocaleString()} locker{batchIntakeWarnings.size === 1 ? "" : "s"} are missing a batch intake date
              </div>
              <div className="text-xs text-muted-foreground">
                From the most recent upload{batchWarningStore?.filename ? ` (${batchWarningStore.filename})` : ""} — these cells are outlined in amber on the map.
              </div>
            </div>
          </div>
        )}

        <LockerSearchBar
          lockers={lockers}
          onJump={(locker) => {
            // find which sheet contains this prefix
            const prefix = prefixOf(locker.locker_number);
            const sheet = sheetNames.find((n) =>
              LAYOUT[n].cells.some((c) => prefixOf(c.n) === prefix),
            );
            if (sheet) setActiveSheet(sheet);
            // Open compartments popover so user picks the right slot, then detail
            setCompartmentNumber(prefix);
          }}
          onValidate={() => setShowValidation(true)}
        />


        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-3 mb-6">
            <SummaryCard label="Total" value={summary.total} accent="bg-primary" />
            {LOCKER_STATUSES.map((s) => (
              <SummaryCard key={s} label={STATUS_LABEL[s]} value={summary[s] ?? 0} accent={STATUS_SWATCH[s]} />
            ))}
          </div>
        )}

        {categorySummary && (
          <Card className="p-4 mb-6 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg font-semibold">Status by Locker Category</h2>
              <span className="text-xs text-muted-foreground">Derived from locker number prefix</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Category</th>
                  {LOCKER_STATUSES.map((s) => (
                    <th key={s} className="py-2 px-2 font-medium text-center whitespace-nowrap">
                      <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${STATUS_SWATCH[s]}`} />
                      {STATUS_LABEL[s]}
                    </th>
                  ))}
                  <th className="py-2 pl-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(["Full", "Staff", "Shoe", "HR"] as const).map((cat) => (
                  <tr key={cat} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{cat} Locker</td>
                    {LOCKER_STATUSES.map((s) => (
                      <td key={s} className="py-2 px-2 text-center tabular-nums">
                        {categorySummary[cat][s] || <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    <td className="py-2 pl-3 text-right font-semibold tabular-nums">{categorySummary[cat].total}</td>
                  </tr>
                ))}
                <tr className="bg-muted/50 font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  {LOCKER_STATUSES.map((s) => (
                    <td key={s} className="py-2 px-2 text-center tabular-nums">{summary?.[s] || 0}</td>
                  ))}
                  <td className="py-2 pl-3 text-right tabular-nums">{summary?.total ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        )}



        {!lockers ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <Tabs value={activeSheet ?? sheetNames[0]} onValueChange={setActiveSheet}>
            <TabsList className="flex-wrap h-auto">
              {sheetNames.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {name} ({LAYOUT[name].cells.length})
                </TabsTrigger>
              ))}
            </TabsList>
            {sheetNames.map((name) => (
              <TabsContent key={name} value={name} className="mt-4">
                <Card className="p-4 overflow-auto">
                  <SheetGrid
                    layout={LAYOUT[name]}
                    byPrefix={byPrefix}
                    warnings={batchIntakeWarnings}
                    onPick={(n) => setCompartmentNumber(n)}
                  />
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>

      <CompartmentPopover
        open={!!compartmentNumber}
        onOpenChange={(v) => { if (!v) setCompartmentNumber(null); }}
        number={compartmentNumber ?? ""}
        compartments={compartments}
        onSelectLocker={(id) => { setCompartmentNumber(null); setSelected(id); }}
      />

      <LockerDetail
        lockerId={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onUpdated={() => setRefreshKey((k) => k + 1)}
      />

      <ValidationReportDialog
        open={showValidation}
        onOpenChange={setShowValidation}
        lockers={lockers}
        layout={LAYOUT}
      />
    </div>
  );
}

const SheetGrid = memo(function SheetGrid({
  layout,
  byPrefix,
  warnings,
  onPick,
}: {
  layout: SheetLayout;
  byPrefix: Map<string, Locker[]>;
  warnings: Set<string>;
  onPick: (n: string) => void;
}) {
  const CELL = 48;
  const GAP = 3;
  const width = layout.cols * (CELL + GAP);
  const height = layout.rows * (CELL + GAP);

  return (
    <div className="relative mx-auto" style={{ width, height, minWidth: width }}>
      {layout.cells.map((cell) => {
        const group = byPrefix.get(prefixOf(cell.n)) ?? [];
        const status = group.length > 0 ? aggregateStatus(group) : "notdb";
        const colorClass = group.length > 0
          ? STATUS_COLORS[status] ?? STATUS_COLORS.unknown
          : NOT_IN_DB;
        const left = (cell.c - 1) * (CELL + GAP);
        const top = (cell.r - 1) * (CELL + GAP);
        const occupied = group.filter((l) => l.status === "active").length;
        const flaggedCount = warnings.size > 0
          ? group.filter((l) => warnings.has(l.locker_number.trim().toUpperCase())).length
          : 0;
        const flagged = flaggedCount > 0;
        const title = group.length > 0
          ? `Locker ${cell.n} — ${group.length} compartment${group.length === 1 ? "" : "s"}, ${occupied} occupied${flagged ? ` · ${flaggedCount} missing batch intake` : ""}`
          : `Locker ${cell.n} — not in database`;

        return (
          <button
            key={`${cell.r}-${cell.c}`}
            onClick={() => group.length > 0 && onPick(cell.n)}
            disabled={group.length === 0}
            aria-label={`Locker ${cell.n}`}
            title={title}
            style={{ left, top, width: CELL, height: CELL }}
            className={`absolute rounded border-2 ${colorClass} ${
              group.length > 0 ? "cursor-pointer hover:ring-2 hover:ring-ring hover:z-10" : "cursor-not-allowed"
            } ${flagged ? "ring-2 ring-warning ring-offset-1 ring-offset-background" : ""} font-bold flex flex-col items-center justify-center leading-none transition-colors`}
          >
            <span className="text-[11px] tracking-tight">{cell.n}</span>
            {group.length > 0 && (
              <span className="text-[9px] opacity-80 mt-0.5">{occupied}/{group.length}</span>
            )}
            {flagged && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-warning border border-background" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
});

function MapLayoutUploader({
  hasOverride,
  onUpload,
  onReset,
}: {
  hasOverride: boolean;
  onUpload: (file: File) => void;
  onReset: () => void;
}) {
  const inputId = "map-layout-upload-input";
  return (
    <Card className="mb-4 p-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[240px]">
        <div className="text-sm font-medium">Map layout source</div>
        <div className="text-xs text-muted-foreground">
          {hasOverride
            ? "Using a custom layout uploaded for this browser."
            : "Using the built-in default layout. Upload an Excel/CSV file to auto-generate a new layout from its sheet cells."}
        </div>
      </div>
      <input
        id={inputId}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.currentTarget.value = "";
        }}
      />
      <Button variant="outline" size="sm" asChild>
        <label htmlFor={inputId} className="cursor-pointer">
          <UploadIcon className="h-4 w-4 mr-1.5" /> Upload map data
        </label>
      </Button>
      {hasOverride && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-4 w-4 mr-1.5" /> Restore default
        </Button>
      )}
    </Card>
  );
}

function Legend() {
  const items: { c: string; l: string }[] = [
    ...LOCKER_STATUSES.map((s) => ({ c: STATUS_SWATCH[s as LockerStatus], l: STATUS_LABEL[s as LockerStatus] })),
    { c: "bg-gradient-to-br from-destructive via-warning to-success", l: "Mixed" },
    { c: "bg-background border border-dashed border-border", l: "Not in DB" },
  ];
  return (
    <div className="flex items-center gap-3 text-xs flex-wrap">
      {items.map((i) => (
        <div key={i.l} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded ${i.c}`} />
          <span className="text-muted-foreground">{i.l}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <span className={`h-10 w-1.5 rounded-full ${accent}`} />
      <div>
        <div className="text-2xl font-bold font-display">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      </div>
    </Card>
  );
}

function FullPageLoader() {
  return <div className="min-h-screen grid place-items-center"><Skeleton className="h-12 w-12 rounded-full" /></div>;
}

function LockerSearchBar({
  lockers,
  onJump,
  onValidate,
}: {
  lockers: Locker[] | null;
  onJump: (l: Locker) => void;
  onValidate: () => void;
}) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    if (!lockers || !q.trim()) return [] as Locker[];
    const needle = q.trim().toUpperCase();
    return lockers
      .filter((l) => l.locker_number.toUpperCase().includes(needle))
      .slice(0, 8);
  }, [lockers, q]);

  function jump(l: Locker) {
    onJump(l);
    setQ("");
  }

  return (
    <div className="mb-6 flex flex-wrap items-start gap-3">
      <div className="relative flex-1 min-w-[260px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) jump(matches[0]);
          }}
          placeholder="Jump to locker (e.g. AA01, W12, 6075B)"
          className="pl-9"
        />
        {q && matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => jump(m)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between gap-2"
              >
                <span className="font-medium font-display">{m.locker_number}</span>
                <span className="text-muted-foreground truncate">
                  {m.employee_name ?? "—"} · {STATUS_LABEL[m.status as LockerStatus] ?? m.status}
                </span>
              </button>
            ))}
          </div>
        )}
        {q && matches.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md p-3 text-sm text-muted-foreground">
            No locker matches "{q}".
          </div>
        )}
      </div>
      <Button variant="outline" onClick={onValidate}>
        <ClipboardCheck className="h-4 w-4 mr-2" /> Validation report
      </Button>
    </div>
  );
}

function ValidationReportDialog({
  open,
  onOpenChange,
  lockers,
  layout,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lockers: Locker[] | null;
  layout: MapLayout;
}) {
  const { role } = useAuth();
  const report = useMemo(() => {
    if (!lockers) return null;
    // All prefixes present in any sheet
    const mappedPrefixes = new Set<string>();
    for (const sheet of Object.values(layout)) {
      for (const cell of sheet.cells) mappedPrefixes.add(prefixOf(cell.n));
    }
    const missing: Locker[] = [];
    const missingPrefixes = new Map<string, number>();
    for (const l of lockers) {
      const p = prefixOf(l.locker_number);
      if (!mappedPrefixes.has(p)) {
        missing.push(l);
        missingPrefixes.set(p, (missingPrefixes.get(p) ?? 0) + 1);
      }
    }
    return { missing, missingPrefixes, totalDb: lockers.length, totalMapped: mappedPrefixes.size };
  }, [lockers]);

  function exportCsv() {
    if (!report) return;
    const rows = [["locker_number", "prefix", "location", "status", "employee_name", "badge_id"]];
    for (const l of report.missing) {
      rows.push([
        l.locker_number,
        prefixOf(l.locker_number),
        l.location ?? "",
        l.status,
        l.employee_name ?? "",
        (l as { badge_id?: string | null }).badge_id ?? "",
      ]);
    }
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `locker-map-validation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${report.missing.length} missing lockers`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Locker map validation</DialogTitle>
          <DialogDescription>
            Lockers in the database that are not represented on any map sheet.
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Card className="p-3">
                <div className="text-2xl font-bold font-display">{report.totalDb.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground uppercase">Lockers in DB</div>
              </Card>
              <Card className="p-3">
                <div className="text-2xl font-bold font-display">{report.totalMapped.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground uppercase">Mapped prefixes</div>
              </Card>
              <Card className="p-3">
                <div className="text-2xl font-bold font-display text-destructive">
                  {report.missing.length.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground uppercase">Missing from map</div>
              </Card>
            </div>

            {report.missing.length === 0 ? (
              <Card className="p-4 text-sm text-success">
                ✓ Every locker in the database is represented on the map.
              </Card>
            ) : (
              <>
                <div>
                  <div className="text-xs uppercase text-muted-foreground mb-2">
                    Missing prefixes ({report.missingPrefixes.size})
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                    {[...report.missingPrefixes.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([p, n]) => (
                        <span
                          key={p}
                          className="px-2 py-0.5 rounded bg-muted text-xs font-mono"
                        >
                          {p} ({n})
                        </span>
                      ))}
                  </div>
                </div>
                {role === "admin" && (
                  <div className="flex justify-end">
                    <Button onClick={exportCsv}>Export CSV</Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
