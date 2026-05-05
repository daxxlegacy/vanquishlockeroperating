import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, BadgeAlert } from "lucide-react";
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const Route = createFileRoute("/duplicates")({
  head: () => ({
    meta: [
      { title: "Duplicate Employees — LockerOps" },
      { name: "description", content: "Employee names assigned to more than one locker." },
    ],
  }),
  component: DuplicatesPage,
});

function normName(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function DuplicatesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const all: Locker[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("lockers").select("*").not("employee_name", "is", null).range(from, from + 999);
        if (!data) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      setLockers(all);
    })();
  }, [user, refresh]);

  const groups = useMemo(() => {
    if (!lockers) return [];
    const map = new Map<string, Locker[]>();
    for (const l of lockers) {
      const k = normName(l.employee_name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return Array.from(map.values())
      .filter((g) => g.length > 1)
      .map((g) => g.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number)))
      .sort((a, b) => b.length - a.length || (a[0].employee_name ?? "").localeCompare(b[0].employee_name ?? ""));
  }, [lockers]);

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Users className="h-6 w-6" />
          <div>
            <h1 className="font-display text-3xl font-bold">Duplicate Employees</h1>
            <p className="text-muted-foreground text-sm">
              Same employee name assigned to more than one locker. Click a locker to review or fix.
            </p>
          </div>
        </div>

        {!lockers ? (
          <Skeleton className="h-96 w-full" />
        ) : groups.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">No duplicates found. 🎉</Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <Card key={g[0].id} className="p-4">
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <span className="font-display font-bold text-lg">{g[0].employee_name}</span>
                  <Badge variant="destructive">{g.length} lockers</Badge>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setSelected(l.id)}
                      className="text-left rounded border p-2.5 hover:border-primary hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono font-semibold">{l.locker_number}</span>
                        <span className="text-xs text-muted-foreground">{l.location}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Badge: {l.badge_number ?? "—"} · {l.row_label ?? "—"}
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
      <LockerDetail
        lockerId={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onUpdated={() => { setRefresh((k) => k + 1); }}
      />
    </div>
  );
}
