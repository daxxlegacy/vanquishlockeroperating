import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageGuard } from "@/components/PageGuard";
import { useEffect, useMemo, useState, memo } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Search, Key, Plus } from "lucide-react";
import { toast } from "sonner";
import { List, type RowComponentProps } from "react-window";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];
type KeyStatus = Database["public"]["Enums"]["key_status"];

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 600;
const COLS = [
  { key: "num", w: 140 },
  { key: "loc", w: 200 },
  { key: "row", w: 160 },
  { key: "spare", w: 220 },
];
const GRID_TEMPLATE = COLS.map((c) => `${c.w}px`).join(" ");
const GRID_TOTAL_WIDTH = COLS.reduce((s, c) => s + c.w, 0);
const SPARE_OPTIONS = [
  "missing",
  "available",
  "taken",
  "taken_for_cleaning",
] as const;
const SWATCH: Record<string, string> = {
  missing: "bg-destructive",
  available: "bg-success",
  taken: "bg-primary",
  taken_for_cleaning: "bg-accent",
};

export const Route = createFileRoute("/spare-keys")({
  head: () => ({
    meta: [
      { title: "Spare Keys — LockerOps" },
      { name: "description", content: "Listing of every locker's spare key status, synced from the spare key sheet." },
    ],
  }),
  component: () => (<PageGuard permission="page_spare_keys"><SpareKeysPage /></PageGuard>),
});

function SpareKeysPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [addOpen, setAddOpen] = useState(false);
  const { lockers: rawLockers } = useLockers();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [spareFilter, setSpareFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const lockers = useMemo(() => {
    if (!rawLockers) return null;
    return [...rawLockers].sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number));
  }, [rawLockers]);

  const locations = useMemo(() => {
    if (!lockers) return [];
    return Array.from(new Set(lockers.map((l) => l.location))).sort();
  }, [lockers]);

  const filtered = useMemo(() => {
    if (!lockers) return [];
    const q = debouncedSearch.toLowerCase().trim();
    return lockers.filter((l) => {
      const s = l.spare_key_status ?? "unknown";
      if (spareFilter !== "all" && s !== spareFilter) return false;
      if (locFilter !== "all" && l.location !== locFilter) return false;
      if (!q) return true;
      return (
        l.locker_number.toLowerCase().includes(q) ||
        (l.row_label ?? "").toLowerCase().includes(q) ||
        l.location.toLowerCase().includes(q)
      );
    });
  }, [lockers, debouncedSearch, spareFilter, locFilter]);


  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of SPARE_OPTIONS) c[k] = 0;
    for (const l of lockers ?? []) {
      const s = l.spare_key_status ?? "unknown";
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [lockers]);

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Key className="h-6 w-6 text-primary" />
              <h1 className="font-display text-3xl font-bold">Spare Keys</h1>
            </div>
            <p className="text-muted-foreground text-sm">
              {lockers?.length.toLocaleString() ?? "…"} lockers · {filtered.length.toLocaleString()} match
            </p>
          </div>
          {isAdmin && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Add Spare Key Locker</Button>
              </DialogTrigger>
              <AddSpareKeyLockerDialog
                existingNumbers={new Set((lockers ?? []).map((l) => l.locker_number.toUpperCase()))}
                existingLocations={locations}
                onClose={() => setAddOpen(false)}
                onCreated={() => { setAddOpen(false); invalidateLockersCache(); }}
              />
            </Dialog>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-4">
          {SPARE_OPTIONS.map((k) => (
            <Card key={k} className="p-3 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${SWATCH[k]}`} />
              <div>
                <div className="text-lg font-bold font-display leading-tight">{counts[k].toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground capitalize leading-tight">{k.replace(/_/g, " ")}</div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-4 mt-6 flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-0 sm:min-w-[240px] w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search locker number, row, location…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={spareFilter} onValueChange={setSpareFilter}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Spare key" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All spare statuses</SelectItem>
              {SPARE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={locFilter} onValueChange={setLocFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
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
            <>
              {/* Mobile: stacked card list */}
              <div className="sm:hidden divide-y">
                {filtered.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No lockers match these filters.</div>
                ) : (
                  <>
                    {filtered.slice(0, 200).map((l) => (
                      <button
                        type="button"
                        key={l.id}
                        onClick={() => setSelected(l.id)}
                        className="w-full text-left px-4 py-3 active:bg-muted/60 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-base truncate">{l.locker_number}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {l.location}{l.row_label ? ` · ${l.row_label}` : ""}
                            </div>
                          </div>
                          <KeyBadge status={l.spare_key_status} />
                        </div>
                      </button>
                    ))}
                    {filtered.length > 200 && (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        Showing first 200 of {filtered.length.toLocaleString()}. Narrow the filters to see more.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Desktop / tablet: virtualized table */}
              <div className="hidden sm:block overflow-x-auto">
                <div style={{ minWidth: GRID_TOTAL_WIDTH }}>
                  <div className="bg-muted/50 grid text-left text-xs uppercase font-semibold tracking-wide text-muted-foreground" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
                    <Th>Locker #</Th>
                    <Th>Location</Th>
                    <Th>Row</Th>
                    <Th>Spare Key Status</Th>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="px-3 py-12 text-center text-muted-foreground text-sm">No lockers match these filters.</div>
                  ) : (
                    <List
                      rowComponent={SpareRow as any}
                      rowCount={filtered.length}
                      rowHeight={ROW_HEIGHT}
                      rowProps={{ rows: filtered, onPick: setSelected }}
                      style={{ height: Math.min(VIEWPORT_HEIGHT, filtered.length * ROW_HEIGHT + 4) }}
                    />
                  )}
                </div>
                <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
                  Showing {filtered.length.toLocaleString()} locker{filtered.length === 1 ? "" : "s"}
                </div>
              </div>
            </>
          )}
        </Card>

      </main>
      <LockerDetail lockerId={selected} open={!!selected} onClose={() => setSelected(null)} onUpdated={() => invalidateLockersCache()} mode="spare" />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2.5">{children}</div>;
}

type SpareRowProps = { rows: Locker[]; onPick: (id: string) => void };
const SpareRow = memo(function SpareRow({ index, style, rows, onPick }: RowComponentProps<SpareRowProps>) {
  const l = rows[index];
  return (
    <div
      style={{ ...style, gridTemplateColumns: GRID_TEMPLATE }}
      onClick={() => onPick(l.id)}
      className="grid items-center border-t hover:bg-muted/40 cursor-pointer text-sm"
    >
      <div className="px-3 truncate font-medium">{l.locker_number}</div>
      <div className="px-3 truncate">{l.location}</div>
      <div className="px-3 truncate text-muted-foreground">{l.row_label ?? "—"}</div>
      <div className="px-3"><KeyBadge status={l.spare_key_status} /></div>
    </div>
  );
});


function KeyBadge({ status }: { status: string | null }) {
  const s = status ?? "unknown";
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${SWATCH[s] ?? "bg-muted-foreground"}`} />
      {s.replace(/_/g, " ")}
    </Badge>
  );
}

function AddSpareKeyLockerDialog({
  existingNumbers,
  existingLocations,
  onClose,
  onCreated,
}: {
  existingNumbers: Set<string>;
  existingLocations: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    locker_number: "",
    location: existingLocations[0] ?? "",
    row_label: "",
    spare_key_status: "available" as KeyStatus,
  });
  const [saving, setSaving] = useState(false);

  const trimmedNumber = form.locker_number.trim();
  const duplicate = trimmedNumber && existingNumbers.has(trimmedNumber.toUpperCase());

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!trimmedNumber) { toast.error("Locker number is required"); return; }
    if (!form.location.trim()) { toast.error("Location is required"); return; }
    if (duplicate) { toast.error(`Locker "${trimmedNumber}" already exists in the listing`); return; }
    setSaving(true);
    const { data: inserted, error } = await supabase.from("lockers").insert({
      locker_number: trimmedNumber,
      location: form.location.trim(),
      row_label: form.row_label.trim() || null,
      status: "empty",
      spare_key_status: form.spare_key_status,
    }).select().single();
    setSaving(false);
    if (error) {
      toast.error(error.message.toLowerCase().includes("duplicate")
        ? `Locker "${trimmedNumber}" already exists in the listing`
        : error.message);
      return;
    }
    if (inserted) {
      try {
        const { syncMetadataToOccupancy } = await import("@/lib/occupancy-sync");
        await syncMetadataToOccupancy(inserted);
      } catch { /* non-fatal */ }
    }
    toast.success(`Spare key locker ${trimmedNumber} added`);
    onCreated();
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="font-display flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" /> Add spare key locker
        </DialogTitle>
        <DialogDescription>
          New entries appear in the listing immediately and are auto-sorted by locker number.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div>
          <Label>Locker Number *</Label>
          <Input
            value={form.locker_number}
            onChange={(e) => set("locker_number", e.target.value)}
            placeholder="e.g. 1A, M16, LK01"
            className={`font-mono ${duplicate ? "border-destructive" : ""}`}
            autoFocus
          />
          {duplicate && (
            <p className="text-xs text-destructive mt-1">
              "{trimmedNumber}" already exists in the listing.
            </p>
          )}
        </div>
        <div>
          <Label>Location *</Label>
          <Input
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
            list="spare-loc-list"
            placeholder="e.g. Building A"
          />
          <datalist id="spare-loc-list">
            {existingLocations.map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>
        <div>
          <Label>Row</Label>
          <Input value={form.row_label} onChange={(e) => set("row_label", e.target.value)} placeholder="optional" />
        </div>
        <div>
          <Label>Spare Key Status</Label>
          <Select value={form.spare_key_status} onValueChange={(v) => set("spare_key_status", v as KeyStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SPARE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !!duplicate || !trimmedNumber}>
          {saving ? "Adding…" : "Add Locker"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
