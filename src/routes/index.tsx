import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

const STATUS_COLORS: Record<string, string> = {
  active: "bg-destructive border-destructive/60 text-destructive-foreground",
  empty: "bg-success border-success/60 text-success-foreground",
  repair: "bg-warning border-warning/60 text-warning-foreground",
  unknown: "bg-muted-foreground/40 border-muted-foreground/30 text-foreground",
};

function MapPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        all.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (!cancelled) setLockers(all);
    })();
    return () => { cancelled = true; };
  }, [user, refreshKey]);

  // Index lockers by locker_number for fast lookup
  const byNumber = useMemo(() => {
    const m = new Map<string, Locker>();
    if (lockers) for (const l of lockers) m.set(l.locker_number.toUpperCase(), l);
    return m;
  }, [lockers]);

  const summary = useMemo(() => {
    if (!lockers) return null;
    const s = { total: lockers.length, active: 0, empty: 0, repair: 0, unknown: 0 };
    for (const l of lockers) s[l.status as keyof typeof s]++;
    return s;
  }, [lockers]);

  if (loading || !user) return <FullPageLoader />;

  const sheetNames = Object.keys(LAYOUT);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Locker Map</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Layout mirrors the physical floor plan. Click any locker for details.
            </p>
          </div>
          <Legend />
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <SummaryCard label="Total" value={summary.total} accent="bg-primary" />
            <SummaryCard label="Occupied" value={summary.active} accent="bg-destructive" />
            <SummaryCard label="Empty" value={summary.empty} accent="bg-success" />
            <SummaryCard label="Repair" value={summary.repair} accent="bg-warning" />
            <SummaryCard label="Unknown" value={summary.unknown} accent="bg-muted-foreground" />
          </div>
        )}

        {!lockers ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <Tabs defaultValue={sheetNames[0]}>
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
                    byNumber={byNumber}
                    onSelect={(id) => setSelected(id)}
                  />
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>

      <LockerDetail
        lockerId={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onUpdated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

function SheetGrid({
  layout,
  byNumber,
  onSelect,
}: {
  layout: SheetLayout;
  byNumber: Map<string, Locker>;
  onSelect: (id: string) => void;
}) {
  const CELL = 36; // px
  const GAP = 3;
  const width = layout.cols * (CELL + GAP);
  const height = layout.rows * (CELL + GAP);

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="relative mx-auto"
        style={{ width, height, minWidth: width }}
      >
        {layout.cells.map((cell) => {
          const locker = byNumber.get(cell.n.toUpperCase());
          const status = locker?.status ?? "unknown";
          const colorClass = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
          const left = (cell.c - 1) * (CELL + GAP);
          const top = (cell.r - 1) * (CELL + GAP);
          return (
            <Tooltip key={`${cell.r}-${cell.c}`}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => locker && onSelect(locker.id)}
                  disabled={!locker}
                  aria-label={`Locker ${cell.n}`}
                  style={{ left, top, width: CELL, height: CELL }}
                  className={`absolute rounded border ${colorClass} ${
                    locker ? "cursor-pointer hover:ring-2 hover:ring-ring" : "cursor-not-allowed opacity-60"
                  } text-[10px] font-semibold leading-none flex items-center justify-center transition-all`}
                >
                  {cell.n}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold">Locker {cell.n}</div>
                  {locker ? (
                    <>
                      <div className="capitalize">Status: {locker.status}</div>
                      {locker.employee_name && <div>{locker.employee_name}</div>}
                      {locker.badge_number && <div className="text-muted-foreground">{locker.badge_number}</div>}
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
  return (
    <div className="flex items-center gap-4 text-sm flex-wrap">
      {[
        { c: "bg-destructive", l: "Occupied" },
        { c: "bg-success", l: "Empty" },
        { c: "bg-warning", l: "Repair" },
        { c: "bg-muted-foreground", l: "Unknown / not in DB" },
      ].map((i) => (
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
