// Admin-only cleanup for duplicate TERMINATED occupancy rows.
// Detection + deletion run server-side via RPCs; Active rows are never touched.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatBatchIntake } from "@/lib/locker-utils";
import { invalidateOccupancyCache, removeOccupancyFromCache } from "@/lib/occupancy-cache";

type DupRow = {
  group_key: string;
  id: string;
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  national_id_masked: string | null;
  termination_date: string | null;
  created_at: string;
  source: string | null;
};
type Mode = "badge" | "name";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function last4(v: string | null) {
  if (!v) return "—";
  return "******" + v.replace(/\*/g, "").slice(-4);
}

export function useDuplicateTerminatedCount(enabled: boolean) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    rpc("find_duplicate_terminated", { match_by: "badge" }).then(({ data }) => {
      const rows = (data as DupRow[] | null) ?? [];
      setN(new Set(rows.map((r) => r.group_key)).size);
    });
  }, [enabled]);
  return [n, setN] as const;
}

export function DuplicateTerminatedDialog({
  open,
  onClose,
  onGroupsChange,
}: {
  open: boolean;
  onClose: () => void;
  onGroupsChange?: (badgeGroups: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("badge");
  const [data, setData] = useState<Record<Mode, DupRow[] | null>>({ badge: null, name: null });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirm, setConfirm] = useState<DupRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [b, n] = await Promise.all([
      rpc("find_duplicate_terminated", { match_by: "badge" }),
      rpc("find_duplicate_terminated", { match_by: "name" }),
    ]);
    setLoading(false);
    if (b.error || n.error) {
      toast.error((b.error ?? n.error)!.message);
      return;
    }
    const badge = (b.data as DupRow[]) ?? [];
    setData({ badge, name: (n.data as DupRow[]) ?? [] });
    onGroupsChange?.(new Set(badge.map((r) => r.group_key)).size);
  };

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Groups (unfiltered) keyed by group_key, rows sorted latest-first.
  const groupsAll = useMemo(() => {
    const m = new Map<string, DupRow[]>();
    for (const r of data[mode] ?? []) {
      const arr = m.get(r.group_key) ?? [];
      arr.push(r);
      m.set(r.group_key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        (b.termination_date ?? "").localeCompare(a.termination_date ?? "") ||
        b.created_at.localeCompare(a.created_at),
      );
    }
    return [...m.entries()].filter(([, rows]) => rows.length > 1);
  }, [data, mode]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return groupsAll.filter(([key, rows]) => {
      if (s && !key.toLowerCase().includes(s) &&
          !rows.some((r) => (r.employee_name ?? "").toLowerCase().includes(s) || (r.badge_number ?? "").toLowerCase().includes(s)))
        return false;
      if (from || to) {
        return rows.some((r) => {
          const d = r.termination_date ?? "";
          return (!from || d >= from) && (!to || d <= to);
        });
      }
      return true;
    });
  }, [groupsAll, q, from, to]);

  const allRows = useMemo(() => [...(data.badge ?? []), ...(data.name ?? [])], [data]);
  const totalRemovable = (rows: [string, DupRow[]][]) => rows.reduce((a, [, r]) => a + r.length - 1, 0);

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // Safety: every group must keep ≥1 row.
  const violatesKeepOne = (ids: Set<string>) =>
    groupsAll.some(([, rows]) => rows.every((r) => ids.has(r.id)));

  const requestDelete = (rows: DupRow[]) => {
    const ids = new Set(rows.map((r) => r.id));
    if (violatesKeepOne(ids)) {
      toast.error("Each group must keep at least one record.");
      return;
    }
    if (rows.length) setConfirm(rows);
  };

  const doDelete = async () => {
    if (!confirm) return;
    const ids = confirm.map((r) => r.id);
    setBusy(true);
    const { data: n, error } = await rpc("delete_terminated_occupancy_rows", { ids });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const idSet = new Set(ids);
    setData((d) => ({
      badge: d.badge?.filter((r) => !idSet.has(r.id)) ?? null,
      name: d.name?.filter((r) => !idSet.has(r.id)) ?? null,
    }));
    setSelected((s) => new Set([...s].filter((x) => !idSet.has(x))));
    removeOccupancyFromCache(ids);
    setConfirm(null);
    toast.success(`Removed ${n ?? ids.length} duplicate terminated records`);
    invalidateOccupancyCache();
    load();
  };

  const selectedRows = allRows.filter((r, i, a) => selected.has(r.id) && a.findIndex((x) => x.id === r.id) === i);
  const badgeGroups = new Set((data.badge ?? []).map((r) => r.group_key)).size;
  const nameGroups = new Set((data.name ?? []).map((r) => r.group_key)).size;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Duplicate Terminated</DialogTitle>
            <DialogDescription>
              Terminated records that share a badge number or name. Active records are never shown or deleted.
            </DialogDescription>
          </DialogHeader>

          {data.badge && data.name && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              <Card className="p-3"><div className="text-muted-foreground text-xs">Groups by badge</div><div className="font-semibold">{badgeGroups}</div></Card>
              <Card className="p-3"><div className="text-muted-foreground text-xs">Groups by name</div><div className="font-semibold">{nameGroups}</div></Card>
              <Card className="p-3"><div className="text-muted-foreground text-xs">Removable (keep latest)</div><div className="font-semibold">{totalRemovable(groupsAll)} in this tab</div></Card>
            </div>
          )}

          <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setSelected(new Set()); }}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="badge" className="flex-1">By Badge Number</TabsTrigger>
              <TabsTrigger value="name" className="flex-1">By Name</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="Search badge or name" value={q} onChange={(e) => setQ(e.target.value)} className="sm:flex-1" />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Terminated from" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Terminated to" />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setSelected(new Set(groups.flatMap(([, rows]) => rows.slice(1).map((r) => r.id))))}
            >
              Select all older duplicates
            </Button>
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={selected.size === 0}
              onClick={() => requestDelete(selectedRows)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete selected ({selected.size})
            </Button>
            <Button variant="ghost" className="w-full sm:w-auto sm:ml-auto" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {!data[mode] ? (
            <Skeleton className="h-40 w-full" />
          ) : groups.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">No duplicate terminated records.</Card>
          ) : (
            <div className="space-y-3">
              {groups.map(([key, rows]) => (
                <Card key={key} className="p-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="font-medium">
                      {mode === "badge" ? <span className="font-mono">{key}</span> : key}
                      <span className="ml-2 text-sm text-muted-foreground">{rows.length} duplicate records</span>
                    </div>
                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => requestDelete(rows.slice(1))}>
                      Keep latest, delete others
                    </Button>
                  </div>
                  <div className="divide-y">
                    {rows.map((r, i) => {
                      const lastLeft = rows.length <= 1;
                      return (
                        <div key={r.id} className="py-2 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Select ${r.locker_number}`} />
                            <Badge variant={i === 0 ? "default" : "outline"}>{i === 0 ? "Latest" : "Older"}</Badge>
                            <span className="font-mono font-medium">{r.locker_number}</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 sm:flex-1">
                            <span>{r.employee_name || "—"}</span>
                            <span className="font-mono text-muted-foreground">{r.badge_number || "—"}</span>
                            <span className="font-mono text-xs text-muted-foreground">{last4(r.national_id_masked)}</span>
                            <span className="text-muted-foreground">{r.termination_date ? formatBatchIntake(r.termination_date) : "—"}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive w-full sm:w-auto"
                            disabled={lastLeft}
                            onClick={() => requestDelete([r])}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirm?.length} terminated record(s)?</DialogTitle>
            <DialogDescription>Only these occupancy history rows are removed. Lockers are not changed.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 overflow-y-auto text-sm space-y-1">
            {confirm?.map((r) => (
              <li key={r.id}><span className="font-mono">{r.locker_number}</span> — {r.employee_name || "—"}</li>
            ))}
          </ul>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)} className="w-full sm:w-auto">Cancel</Button>
            <Button variant="destructive" onClick={doDelete} disabled={busy} className="w-full sm:w-auto">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
