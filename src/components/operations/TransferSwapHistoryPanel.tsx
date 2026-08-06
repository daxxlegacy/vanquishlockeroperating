import { useEffect, useMemo, useState } from "react";
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
import { Search, ArrowRightLeft, Repeat, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatBatchIntake } from "@/lib/locker-utils";
import type { Database } from "@/integrations/supabase/types";

type Row = Database["public"]["Tables"]["transfer_swap_history"]["Row"];

export function TransferSwapHistoryPanel() {
  const { user, role } = useAuth();
  const [items, setItems] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [refresh, setRefresh] = useState(0);

  const [clearOpen, setClearOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("transfer_swap_history")
      .select("*")
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3000)
      .then(({ data, error }) => {
        if (error) toast.error(`Could not load history: ${error.message}`);
        setItems(data ?? []);
      });
  }, [user, refresh]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (r) =>
        r.locker_number.toLowerCase().includes(s) ||
        (r.other_locker_number ?? "").toLowerCase().includes(s) ||
        r.event_type.includes(s),
    );
  }, [items, q]);

  const inRange = useMemo(() => {
    if (!items || !from || !to) return [];
    return items.filter((r) => r.occurred_on >= from && r.occurred_on <= to);
  }, [items, from, to]);

  const resetClear = () => {
    setFrom("");
    setTo("");
    setConfirming(false);
  };

  const applyClear = async () => {
    setBusy(true);
    try {
      const { data: deleted, error } = await supabase
        .from("transfer_swap_history")
        .delete()
        .gte("occurred_on", from)
        .lte("occurred_on", to)
        .select("id");
      if (error) throw error;
      const removed = deleted?.length ?? 0;

      const { error: logErr } = await supabase.from("transfer_swap_history_clears").insert({
        from_date: from,
        to_date: to,
        removed_count: removed,
        performed_by: user!.id,
        performed_by_email: user!.email ?? null,
      });
      if (logErr) toast.warning(`History cleared, but audit log failed: ${logErr.message}`);

      toast.success(`Removed ${removed} entr${removed === 1 ? "y" : "ies"}`);
      setClearOpen(false);
      resetClear();
      setRefresh((k) => k + 1);
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
          <ArrowRightLeft className="h-5 w-5" />
          <div>
            <h2 className="font-display text-xl font-bold">Transfer and Swap History</h2>
            <p className="text-muted-foreground text-xs">
              {items?.length.toLocaleString() ?? "…"} entries · transfer requests &amp; locker swaps
            </p>
          </div>
        </div>
        {role === "admin" && (
          <Button variant="outline" onClick={() => { resetClear(); setClearOpen(true); }}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear History
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search locker number…"
            className="pl-9"
          />
        </div>
      </Card>

      {!items ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No transfer or swap history yet.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2 border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Locker Number</span>
            <span>Date</span>
          </div>
          <div className="divide-y max-h-[32rem] overflow-auto">
            {filtered.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 text-sm items-center">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-semibold">{r.locker_number}</span>
                  <Badge variant="outline" className="gap-1 shrink-0 text-[10px]">
                    {r.event_type === "swap" ? <Repeat className="h-3 w-3" /> : <ArrowRightLeft className="h-3 w-3" />}
                    {r.event_type === "swap" ? "Swap" : "Transfer"}
                  </Badge>
                </span>
                <span className="text-muted-foreground whitespace-nowrap">{formatBatchIntake(r.occurred_on)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={clearOpen} onOpenChange={(v) => { if (!busy) { setClearOpen(v); if (!v) resetClear(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> Clear Transfer &amp; Swap History
            </DialogTitle>
            <DialogDescription>
              Only this section's history is affected — terminations and occupancy history stay intact.
            </DialogDescription>
          </DialogHeader>

          {!confirming ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="clear-from">From</Label>
                <Input id="clear-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clear-to">To</Label>
                <Input id="clear-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
