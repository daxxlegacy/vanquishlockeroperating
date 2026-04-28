import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const Route = createFileRoute("/lockers")({
  head: () => ({
    meta: [
      { title: "Lockers — LockerOps" },
      { name: "description", content: "Searchable, filterable table of every locker and assigned employee." },
    ],
  }),
  component: LockersPage,
});

function LockersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const all: Locker[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("lockers").select("*").order("locker_number").range(from, from + 999);
        if (!data) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      setLockers(all);
    })();
  }, [user, refresh]);

  const locations = useMemo(() => {
    if (!lockers) return [];
    return Array.from(new Set(lockers.map((l) => l.location))).sort();
  }, [lockers]);

  const filtered = useMemo(() => {
    if (!lockers) return [];
    const q = search.toLowerCase();
    return lockers.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (locFilter !== "all" && l.location !== locFilter) return false;
      if (!q) return true;
      return (
        l.locker_number.toLowerCase().includes(q) ||
        l.employee_name?.toLowerCase().includes(q) ||
        l.badge_number?.toLowerCase().includes(q)
      );
    });
  }, [lockers, search, statusFilter, locFilter]);

  const visible = filtered.slice(0, 500);

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <h1 className="font-display text-3xl font-bold">Lockers</h1>
        <p className="text-muted-foreground text-sm mt-1">{lockers?.length.toLocaleString() ?? "…"} total · showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()}</p>

        <Card className="p-4 mt-6 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search locker, employee, badge…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="empty">Empty</SelectItem>
              <SelectItem value="repair">Repair</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Select value={locFilter} onValueChange={setLocFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>

        <Card className="mt-4 overflow-hidden">
          {!lockers ? (
            <div className="p-6 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <Th>Locker #</Th><Th>Location</Th><Th>Row</Th><Th>Badge</Th><Th>Employee</Th>
                    <Th>Status</Th><Th>Phys. Key</Th><Th>Spare Key</Th><Th>Batch</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <tr key={l.id} onClick={() => setSelected(l.id)} className="border-t hover:bg-muted/40 cursor-pointer">
                      <td className="px-3 py-2 font-medium">{l.locker_number}</td>
                      <td className="px-3 py-2">{l.location}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.row_label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.badge_number ?? "—"}</td>
                      <td className="px-3 py-2">{l.employee_name ?? "—"}</td>
                      <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                      <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{l.physical_key_status?.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{l.spare_key_status?.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.batch_intake}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 500 && (
                <div className="p-3 text-center text-xs text-muted-foreground border-t">
                  Showing first 500 results. Refine your search to narrow down.
                </div>
              )}
            </div>
          )}
        </Card>
      </main>
      <LockerDetail lockerId={selected} open={!!selected} onClose={() => setSelected(null)} onUpdated={() => setRefresh((k) => k + 1)} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-destructive/15 text-destructive border-destructive/30",
    empty: "bg-success/15 text-success border-success/30",
    repair: "bg-warning/20 text-warning-foreground border-warning/40",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={`capitalize ${map[status]}`}>{status}</Badge>;
}
