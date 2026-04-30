import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMinus, Search } from "lucide-react";
import { formatBatchIntake } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Term = Database["public"]["Tables"]["terminations"]["Row"];

export const Route = createFileRoute("/terminations")({
  head: () => ({
    meta: [
      { title: "Terminations — LockerOps" },
      { name: "description", content: "Log of users freed from lockers, with termination dates and reasons." },
    ],
  }),
  component: TerminationsPage,
});

function TerminationsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("terminations").select("*").order("termination_date", { ascending: false }).limit(1000)
      .then(({ data }) => setItems(data ?? []));
  }, [user]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((t) =>
      t.employee_name?.toLowerCase().includes(s) ||
      t.badge_number?.toLowerCase().includes(s) ||
      t.locker_number.toLowerCase().includes(s) ||
      t.location?.toLowerCase().includes(s),
    );
  }, [items, q]);

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <UserMinus className="h-6 w-6" />
          <div>
            <h1 className="font-display text-3xl font-bold">Terminations</h1>
            <p className="text-muted-foreground text-sm">{items?.length.toLocaleString() ?? "…"} records</p>
          </div>
        </div>

        <Card className="p-3 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, badge, locker, location…" className="pl-9" />
          </div>
        </Card>

        <Card className="overflow-hidden">
          {!items ? (
            <div className="p-6 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No terminations match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <Th>Termination Date</Th><Th>Employee</Th><Th>Badge</Th>
                    <Th>Locker #</Th><Th>Location</Th><Th>Row</Th><Th>Reason</Th><Th>By</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-2 font-medium">{formatBatchIntake(t.termination_date)}</td>
                      <td className="px-3 py-2">{t.employee_name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.badge_number ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{t.locker_number}</td>
                      <td className="px-3 py-2">{t.location ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{t.row_label ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate" title={t.reason ?? ""}>{t.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.terminated_by_email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</th>;
}
