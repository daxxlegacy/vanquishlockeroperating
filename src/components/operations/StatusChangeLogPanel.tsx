// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Status Change Log panel (Reconcile page).
//
// REQUIREMENT: the manual, date-range scoped "Clear History" action below is the
// ONLY ongoing way rows are removed from `status_change_log`. The explicitly
// requested one-time duplicate-noise removal is separate. No scheduled job,
// cron entry, expiry trigger, or automatic cleanup may touch this table.
// This clear action is fully separate from the Transfer & Swap History clear.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, History, Trash2, AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format-date";
import { formatBatchIntake } from "@/lib/locker-utils";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import { visibleStatusChangeRows } from "@/lib/status-change-log";
import { KeyBadge } from "@/components/KeyBadge";

type Row = {
  id: string;
  locker_number: string;
  previous_status: string | null;
  new_status: string;
  source: string;
  changed_by_email: string | null;
  created_at: string;
};

const SOURCE_LABEL: Record<string, string> = {
  locker_detail_manual: "Manual edit",
  bulk_status_update: "Bulk update",
  bulk_spare_key: "Spare key",
  transfer: "Transfer",
  reclassify: "Reclassify",
  force_terminate: "Force terminate",
  force_activate: "Force activate",
  sync: "Sync",
};

function StatusPill({ value }: { value: string | null }) {
  const raw = (value ?? "").trim();
  if (!raw) return <span className="text-muted-foreground">—</span>;
  const swatch = STATUS_SWATCH[raw as LockerStatus] ?? "bg-muted-foreground";
  const label = STATUS_LABEL[raw as LockerStatus] ?? raw;
  return (
    <Badge variant="outline" className="gap-1.5 w-fit text-[10px] whitespace-nowrap">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </Badge>
  );
}

const GRID = "grid grid-cols-[7rem_9rem_1.2rem_9rem_8rem_11rem_9.5rem] gap-3 items-center";

export function StatusChangeLogPanel() {
  const { role } = useAuth();
  const [items, setItems] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");

  const [clearOpen, setClearOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("status_change_log")
      .select("id, locker_number, previous_status, new_status, source, changed_by_email, created_at")
      .neq("new_status", "(duplicate removed)")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) {
      toast.error(`Could not load status change log: ${error.message}`);
      setItems([]);
      return;
    }
    setItems(visibleStatusChangeRows((data ?? []) as Row[]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((r) =>
      [r.locker_number, r.previous_status, r.new_status, r.source, r.changed_by_email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s),
    );
  }, [items, q]);

  const inRange = useMemo(() => {
    if (!items || !from || !to) return [];
    return items.filter((r) => {
      const d = r.created_at.slice(0, 10);
      return d >= from && d <= to;
    });
  }, [items, from, to]);

  const resetClear = () => {
    setFrom("");
    setTo("");
    setConfirming(false);
  };

  const applyClear = async () => {
    setBusy(true);
    try {
      const endExclusive = new Date(`${to}T00:00:00Z`);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      const { data, error } = await supabase
        .from("status_change_log")
        .delete()
        .gte("created_at", `${from}T00:00:00Z`)
        .lt("created_at", endExclusive.toISOString())
        .select("id");
      if (error) throw new Error(error.message);
      const ids = new Set((data ?? []).map((r) => (r as { id: string }).id));
      setItems((prev) => (prev ? prev.filter((r) => !ids.has(r.id)) : prev));
      toast.success(`Removed ${ids.size} entr${ids.size === 1 ? "y" : "ies"}`);
      setClearOpen(false);
      resetClear();
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5" />
          <div>
            <h2 className="font-display text-xl font-bold">Status Change Log</h2>
            <p className="text-muted-foreground text-xs">
              {items?.length.toLocaleString() ?? "…"} entries · every locker status change, manual or automated
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCcw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          {role === "admin" && (
            <Button variant="outline" onClick={() => { resetClear(); setClearOpen(true); }}>
              <Trash2 className="h-4 w-4 mr-1" /> Clear History
            </Button>
          )}
        </div>
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search locker number, status, source or admin…"
            className="pl-9"
          />
        </div>
      </Card>

      {!items ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No status changes recorded yet.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[60rem]">
              <div
                className={`${GRID} px-4 py-2 border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground`}
              >
                <span>Locker</span>
                <span>Previous</span>
                <span />
                <span>New</span>
                <span>Source</span>
                <span>Admin</span>
                <span>Date</span>
              </div>
              <div className="divide-y max-h-[32rem] overflow-auto">
                {filtered.map((r) => (
                  <div key={r.id} className={`${GRID} px-4 py-2.5 text-sm`}>
                    <span className="font-mono font-semibold truncate">{r.locker_number}</span>
                    {r.source === "bulk_spare_key" ? <KeyBadge status={r.previous_status} /> : <StatusPill value={r.previous_status} />}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    {r.source === "bulk_spare_key" ? <KeyBadge status={r.new_status} /> : <StatusPill value={r.new_status} />}
                    <span className="text-xs text-muted-foreground truncate" title={r.source}>
                      {SOURCE_LABEL[r.source] ?? r.source}
                    </span>
                    <span className="text-xs text-muted-foreground truncate" title={r.changed_by_email ?? ""}>
                      {r.changed_by_email ?? "—"}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap text-xs">
                      {formatDateTime(r.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Dialog open={clearOpen} onOpenChange={(v) => { if (!busy) { setClearOpen(v); if (!v) resetClear(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Clear Status Change Log
            </DialogTitle>
            <DialogDescription>
              Only this log is affected — transfer &amp; swap history, terminations and occupancy history stay intact.
            </DialogDescription>
          </DialogHeader>

          {!confirming ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="scl-from">From</Label>
                <Input id="scl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="scl-to">To</Label>
                <Input id="scl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                {from && to
                  ? from > to
                    ? "“From” must be on or before “To”."
                    : `${inRange.length} entr${inRange.length === 1 ? "y" : "ies"} in this range.`
                  : "Pick a date range to continue."}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
              <span>
                This will permanently delete <span className="font-semibold">{inRange.length}</span> entr
                {inRange.length === 1 ? "y" : "ies"} between{" "}
                <span className="font-semibold">{formatBatchIntake(from)}</span> and{" "}
                <span className="font-semibold">{formatBatchIntake(to)}</span>. This cannot be undone.
              </span>
            </div>
          )}

          <DialogFooter>
            {!confirming ? (
              <>
                <Button variant="outline" onClick={() => setClearOpen(false)}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={!from || !to || from > to || inRange.length === 0}
                  onClick={() => setConfirming(true)}
                >
                  Continue
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
                <Button variant="destructive" onClick={applyClear} disabled={busy}>
                  {busy ? "Clearing…" : "Delete permanently"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
