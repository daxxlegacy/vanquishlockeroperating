import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { CompartmentPopover } from "@/components/CompartmentPopover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import layoutData from "@/data/locker-map-layout.json";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

type SheetLayout = {
  rows: number;
  cols: number;
  cells: { r: number; c: number; n: string }[];
};
const LAYOUT = layoutData as Record<string, SheetLayout>;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Locker Map — LockerOps" },
      { name: "description", content: "Interactive locker map mirroring the physical layout of each area." },
    ],
  }),
  component: MapPage,
});

import { STATUS_CELL, STATUS_SWATCH, STATUS_LABEL, LOCKER_STATUSES, type LockerStatus } from "@/lib/locker-status";

const STATUS_COLORS: Record<string, string> = {
  ...STATUS_CELL,
  mixed: "bg-gradient-to-br from-destructive via-warning to-success border-border text-foreground shadow-sm",
};
const NOT_IN_DB = "bg-background border-dashed border-border text-muted-foreground/70";

/** Strip trailing letter to get the number prefix (e.g. "1A" -> "1", "6075B" -> "6075"). */
function prefixOf(n: string): string {
  const m = n.toUpperCase().match(/^(\d+|[A-Z]{1,3}\d+|LK\d+)/);
  return (m?.[1] ?? n).toUpperCase();
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
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compartmentNumber, setCompartmentNumber] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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

  if (loading || !user) return <FullPageLoader />;

  const sheetNames = Object.keys(LAYOUT);
  const compartments = compartmentNumber ? byPrefix.get(prefixOf(compartmentNumber)) ?? [] : [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Locker Map</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Click any locker number to see its A–F compartments.
            </p>
          </div>
          <Legend />
        </div>

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
      />
    </div>
  );
}

function SheetGrid({
  layout,
  byPrefix,
  onPick,
}: {
  layout: SheetLayout;
  byPrefix: Map<string, Locker[]>;
  onPick: (n: string) => void;
}) {
  const CELL = 48;
  const GAP = 3;
  const width = layout.cols * (CELL + GAP);
  const height = layout.rows * (CELL + GAP);

  return (
    <TooltipProvider delayDuration={150}>
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

          return (
            <Tooltip key={`${cell.r}-${cell.c}`}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => group.length > 0 && onPick(cell.n)}
                  disabled={group.length === 0}
                  aria-label={`Locker ${cell.n}`}
                  style={{ left, top, width: CELL, height: CELL }}
                  className={`absolute rounded border-2 ${colorClass} ${
                    group.length > 0 ? "cursor-pointer hover:ring-2 hover:ring-ring hover:z-10" : "cursor-not-allowed"
                  } font-bold flex flex-col items-center justify-center leading-none transition-all`}
                >
                  <span className="text-[11px] tracking-tight">{cell.n}</span>
                  {group.length > 0 && (
                    <span className="text-[9px] opacity-80 mt-0.5">{occupied}/{group.length}</span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold">Locker {cell.n}</div>
                  {group.length > 0 ? (
                    <>
                      <div>{group.length} compartment{group.length === 1 ? "" : "s"} · {occupied} occupied</div>
                      <div className="text-muted-foreground">Click to view A–F</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">Not in database</div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
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
