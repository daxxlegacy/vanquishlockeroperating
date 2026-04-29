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
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Locker Map — LockerOps" },
      { name: "description", content: "Live interactive map of all lockers grouped by location and row." },
    ],
  }),
  component: MapPage,
});

const STATUS_COLORS: Record<string, string> = {
  active: "bg-destructive border-destructive/60",      // occupied = red
  empty: "bg-success border-success/60",                // empty = green
  repair: "bg-warning border-warning/60",
  unknown: "bg-muted-foreground/40 border-muted-foreground/30",
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
      // Fetch all (paginated to bypass 1000 row limit)
      const all: Locker[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("lockers")
          .select("*")
          .order("location")
          .order("row_label")
          .order("locker_number")
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

  const grouped = useMemo(() => {
    if (!lockers) return null;
    const byLoc = new Map<string, Map<string, Locker[]>>();
    for (const l of lockers) {
      if (!byLoc.has(l.location)) byLoc.set(l.location, new Map());
      const rowMap = byLoc.get(l.location)!;
      const row = l.row_label || "—";
      if (!rowMap.has(row)) rowMap.set(row, []);
      rowMap.get(row)!.push(l);
    }
    // Sort each row's lockers in natural order (1A, 2A, ... 10A, AA01, ...)
    for (const rowMap of byLoc.values()) {
      for (const items of rowMap.values()) {
        items.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
      }
    }
    return byLoc;
  }, [lockers]);

  const summary = useMemo(() => {
    if (!lockers) return null;
    const s = { total: lockers.length, active: 0, empty: 0, repair: 0, unknown: 0 };
    for (const l of lockers) s[l.status as keyof typeof s]++;
    return s;
  }, [lockers]);

  if (loading || !user) return <FullPageLoader />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="font-display text-3xl font-bold">Locker Map</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Click any locker to view or edit details. Red = occupied, Green = empty.
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

        {!grouped ? (
          <Skeleton className="h-96 w-full" />
        ) : grouped.size === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">No lockers yet. Upload a file to get started.</Card>
        ) : (
          <Tabs defaultValue={Array.from(grouped.keys())[0]}>
            <TabsList className="flex-wrap h-auto">
              {Array.from(grouped.keys()).map((loc) => (
                <TabsTrigger key={loc} value={loc}>{loc} ({Array.from(grouped.get(loc)!.values()).flat().length})</TabsTrigger>
              ))}
            </TabsList>
            {Array.from(grouped.entries()).map(([loc, rows]) => (
              <TabsContent key={loc} value={loc} className="mt-4">
                <Card className="p-6">
                  <TooltipProvider delayDuration={150}>
                    <div className="space-y-5">
                      {Array.from(rows.entries()).map(([row, items]) => (
                        <div key={row} className="flex items-start gap-4">
                          <div className="w-20 shrink-0 text-sm font-medium text-muted-foreground pt-1.5">{row}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {items.map((l) => (
                              <Tooltip key={l.id}>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setSelected(l.id)}
                                    aria-label={`Locker ${l.locker_number}`}
                                    className={`locker-cell h-8 w-8 rounded border ${STATUS_COLORS[l.status]} cursor-pointer`}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-xs space-y-0.5">
                                    <div className="font-semibold">{l.locker_number}</div>
                                    <div className="capitalize">Status: {l.status}</div>
                                    {l.employee_name && <div>{l.employee_name}</div>}
                                    {l.badge_number && <div className="text-muted-foreground">{l.badge_number}</div>}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TooltipProvider>
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

function Legend() {
  return (
    <div className="flex items-center gap-4 text-sm">
      {[
        { c: "bg-destructive", l: "Occupied" },
        { c: "bg-success", l: "Empty" },
        { c: "bg-warning", l: "Repair" },
        { c: "bg-muted-foreground", l: "Unknown" },
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
