import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Search, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { compareLockerNumbers, parseBatchIntake, formatBatchIntake } from "@/lib/locker-utils";
import { DeleteLocationDialog } from "@/components/DeleteLocationDialog";
import { DeleteLockerByNumberDialog } from "@/components/DeleteLockerByNumberDialog";
import { LOCKER_STATUSES, STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

const PAGE_SIZE = 500;

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
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locFilter, setLocFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);

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
      // Natural sort across all formats (1A → 6378F → A01 → Y40 → LK01 → AA01 → KKK18)
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

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, statusFilter, locFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-3xl font-bold">Lockers</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {lockers?.length.toLocaleString() ?? "…"} total · {filtered.length.toLocaleString()} match · page {safePage} of {totalPages}
            </p>
          </div>
          {role === "admin" && (
            <div className="flex gap-2 flex-wrap">
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4 mr-1" /> Add Locker</Button>
                </DialogTrigger>
                <AddLockerDialog
                  onClose={() => setAddOpen(false)}
                  onCreated={() => { setAddOpen(false); setRefresh((k) => k + 1); }}
                  existingLocations={locations}
                />
              </Dialog>
              <DeleteLockerByNumberDialog onDeleted={() => setRefresh((k) => k + 1)} />
              <DeleteLocationDialog
                locations={locations}
                onDeleted={() => setRefresh((k) => k + 1)}
              />
            </div>
          )}
        </div>

        <Card className="p-4 mt-6 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search locker, employee, badge…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LOCKER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
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
                    <Th>Locker #</Th><Th>Location</Th><Th>Row</Th><Th>Key Lock</Th><Th>Badge</Th><Th>Employee</Th>
                    <Th>Status</Th><Th>Phys. Key</Th><Th>Spare Key</Th><Th>Batch</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => (
                    <tr key={l.id} onClick={() => setSelected(l.id)} className="border-t hover:bg-muted/40 cursor-pointer">
                      <td className="px-3 py-2 font-medium">{l.locker_number}</td>
                      <td className="px-3 py-2">{l.location}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.row_label}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.key_lock ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.badge_number ?? "—"}</td>
                      <td className="px-3 py-2">{l.employee_name ?? <span className="text-muted-foreground italic">{STATUS_LABEL[l.status as LockerStatus] ?? "—"}</span>}</td>
                      <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                      <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{l.physical_key_status?.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-xs capitalize text-muted-foreground">{l.spare_key_status?.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatBatchIntake(l.batch_intake)}</td>
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

function StatusBadge({ status }: { status: string }) {
  const swatch = STATUS_SWATCH[status as LockerStatus] ?? "bg-muted-foreground";
  const label = STATUS_LABEL[status as LockerStatus] ?? status;
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </Badge>
  );
}

// ---------- Add Locker Dialog (manual entry) ----------
function AddLockerDialog({
  onClose,
  onCreated,
  existingLocations,
}: {
  onClose: () => void;
  onCreated: () => void;
  existingLocations: string[];
}) {
  const [form, setForm] = useState({
    locker_number: "",
    location: existingLocations[0] ?? "",
    row_label: "",
    unit_type: "",
    key_lock: "",
    badge_number: "",
    employee_name: "",
    status: "empty" as Database["public"]["Enums"]["locker_status"],
    batch_intake: "",
    remark: "",
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.locker_number.trim()) {
      toast.error("Locker number is required");
      return;
    }
    if (!form.location.trim()) {
      toast.error("Location is required");
      return;
    }
    setSaving(true);
    const hasBadge = !!form.badge_number.trim();
    const finalStatus = hasBadge && form.status === "empty" ? "active" : form.status;
    const { data: inserted, error } = await supabase.from("lockers").insert({
      locker_number: form.locker_number.trim(),
      location: form.location.trim(),
      row_label: form.row_label.trim() || null,
      unit_type: form.unit_type.trim() || null,
      key_lock: form.key_lock.trim() || null,
      badge_number: form.badge_number.trim() || null,
      employee_name: form.employee_name.trim() || null,
      status: finalStatus,
      batch_intake: parseBatchIntake(form.batch_intake),
      remark: form.remark.trim() || null,
    }).select("*").single();
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That locker number already exists" : error.message);
      return;
    }
    if (inserted && finalStatus === "active" && (inserted.employee_name || inserted.badge_number)) {
      const { syncActivationToOccupancy } = await import("@/lib/occupancy-sync");
      await syncActivationToOccupancy(inserted);
    }
    toast.success(`Locker ${form.locker_number} added`);
    onCreated();
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display">Add new locker</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4 py-2">
        <div>
          <Label>Locker Number *</Label>
          <Input value={form.locker_number} onChange={(e) => set("locker_number", e.target.value)} placeholder="e.g. 1A, A01, LK01, AA01" />
        </div>
        <div>
          <Label>Location *</Label>
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Building A" list="loc-list" />
          <datalist id="loc-list">
            {existingLocations.map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>
        <div>
          <Label>Row</Label>
          <Input value={form.row_label} onChange={(e) => set("row_label", e.target.value)} placeholder="e.g. Nine Row" />
        </div>
        <div>
          <Label>Unit Type</Label>
          <Input value={form.unit_type} onChange={(e) => set("unit_type", e.target.value)} placeholder="e.g. Horizontal" />
        </div>
        <div>
          <Label>Key Lock</Label>
          <Input value={form.key_lock} onChange={(e) => set("key_lock", e.target.value)} placeholder="e.g. Round Lock Key" />
        </div>
        <div>
          <Label>Badge Number</Label>
          <Input value={form.badge_number} onChange={(e) => set("badge_number", e.target.value)} />
        </div>
        <div>
          <Label>Employee Name</Label>
          <Input value={form.employee_name} onChange={(e) => set("employee_name", e.target.value)} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v as typeof form.status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOCKER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Batch Intake (dd/mm/yyyy)</Label>
          <Input value={form.batch_intake} onChange={(e) => set("batch_intake", e.target.value)} placeholder="16/01/2026" />
        </div>
        <div className="col-span-2">
          <Label>Remark</Label>
          <Input value={form.remark} onChange={(e) => set("remark", e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add Locker"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

