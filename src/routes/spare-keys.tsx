import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { LockerDetail } from "@/components/LockerDetail";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Key, ChevronLeft, ChevronRight } from "lucide-react";
import { compareLockerNumbers } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

const PAGE_SIZE = 500;
const SPARE_OPTIONS = ["available", "missing", "with_employee", "damaged", "unknown"] as const;
const SWATCH: Record<string, string> = {
  available: "bg-success",
  missing: "bg-destructive",
  with_employee: "bg-primary",
  damaged: "bg-warning",
  unknown: "bg-muted-foreground",
};

export const Route = createFileRoute("/spare-keys")({
  head: () => ({
    meta: [
      { title: "Spare Keys — LockerOps" },
      { name: "description", content: "Listing of every locker's spare key status, synced from the spare key sheet." },
    ],
  }),
  component: SpareKeysPage,
});

function SpareKeysPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [search, setSearch] = useState("");
  const [spareFilter, setSpareFilter] = useState("all");
  const [physFilter, setPhysFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [onlyWithSpare, setOnlyWithSpare] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const all: Locker[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase.from("lockers").select("*").is("deleted_at", null).range(from, from + 999);
        if (!data) break;
        all.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      all.sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
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
      if (onlyWithSpare && l.spare_key_status !== "available" && l.spare_key_status !== "with_employee" && l.spare_key_status !== "damaged") return false;
      if (spareFilter !== "all" && l.spare_key_status !== spareFilter) return false;
      if (physFilter !== "all" && l.physical_key_status !== physFilter) return false;
      if (locFilter !== "all" && l.location !== locFilter) return false;
      if (!q) return true;
      return (
        l.locker_number.toLowerCase().includes(q) ||
        l.employee_name?.toLowerCase().includes(q) ||
        l.badge_number?.toLowerCase().includes(q)
      );
    });
  }, [lockers, search, spareFilter, physFilter, locFilter, onlyWithSpare]);

  useEffect(() => { setPage(1); }, [search, spareFilter, physFilter, locFilter, onlyWithSpare]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  if (loading || !user) return <div className="min-h-screen" />;

  const counts = {
    available: lockers?.filter((l) => l.spare_key_status === "available").length ?? 0,
    missing: lockers?.filter((l) => l.spare_key_status === "missing").length ?? 0,
    with_employee: lockers?.filter((l) => l.spare_key_status === "with_employee").length ?? 0,
    damaged: lockers?.filter((l) => l.spare_key_status === "damaged").length ?? 0,
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <Key className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-bold">Spare Keys</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          {lockers?.length.toLocaleString() ?? "…"} total · {filtered.length.toLocaleString()} match · page {safePage} of {totalPages}
        </p>

        <div className="grid sm:grid-cols-4 gap-3 mt-4">
          {(["available", "with_employee", "damaged", "missing"] as const).map((k) => (
            <Card key={k} className="p-3 flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${SWATCH[k]}`} />
              <div>
                <div className="text-xl font-bold font-display">{counts[k].toLocaleString()}</div>
                <div className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-4 mt-6 flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search locker, employee, badge…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={spareFilter} onValueChange={setSpareFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Spare key" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All spare statuses</SelectItem>
              {SPARE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={physFilter} onValueChange={setPhysFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Physical key" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All physical statuses</SelectItem>
              {SPARE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={locFilter} onValueChange={setLocFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant={onlyWithSpare ? "default" : "outline"} size="sm" onClick={() => setOnlyWithSpare((v) => !v)}>
            {onlyWithSpare ? "Showing only with spare" : "Showing all"}
          </Button>
        </Card>

        <Card className="mt-4 overflow-hidden">
          {!lockers ? (
            <div className="p-6 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <Th>Locker #</Th><Th>Location</Th><Th>Row</Th>
                    <Th>Employee</Th><Th>Badge</Th>
                    <Th>Spare Key</Th><Th>Physical Key</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <tr key={l.id} onClick={() => setSelected(l.id)} className="border-t hover:bg-muted/40 cursor-pointer">
                      <td className="px-3 py-2 font-medium">{l.locker_number}</td>
                      <td className="px-3 py-2">{l.location}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.row_label}</td>
                      <td className="px-3 py-2">{l.employee_name ?? <span className="text-muted-foreground italic">—</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.badge_number ?? "—"}</td>
                      <td className="px-3 py-2"><KeyBadge status={l.spare_key_status} /></td>
                      <td className="px-3 py-2"><KeyBadge status={l.physical_key_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20">
                <div className="text-xs text-muted-foreground">
                  Showing {filtered.length === 0 ? 0 : (startIdx + 1).toLocaleString()}–{(startIdx + visible.length).toLocaleString()} of {filtered.length.toLocaleString()}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <span className="text-sm font-medium px-2">Page {safePage} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
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

function KeyBadge({ status }: { status: string | null }) {
  const s = status ?? "unknown";
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${SWATCH[s] ?? "bg-muted-foreground"}`} />
      {s.replace(/_/g, " ")}
    </Badge>
  );
}
