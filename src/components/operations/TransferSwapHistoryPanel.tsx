// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useMemo, useState } from "react";
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
import { useLockers } from "@/lib/lockers-cache";
import { NationalIdCell } from "@/components/NationalIdCell";
import type { Database } from "@/integrations/supabase/types";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import {
  clearTransferSwapHistoryRange,
  invalidateTransferSwapHistory,
  removeTransferSwapHistoryFromCache,
  useTransferSwapHistory,
  type TransferSwapHistoryRow as Row,
} from "@/lib/transfer-swap-history";
type Locker = Database["public"]["Tables"]["lockers"]["Row"];

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Occupant details resolved from the lockers table for a locker number. */
type Occupant = {
  lockerNumber: string;
  id: string | null;
  employeeName: string | null;
  badgeNumber: string | null;
  nationalId: string | null;
};

/**
 * Prefer the occupant snapshot stored on the history row itself (recorded at
 * the time of the event); fall back to the live lockers table for older rows
 * written before snapshots existed.
 */
function occupantOf(
  lockerNumber: string | null,
  byNumber: Map<string, Locker>,
  snapshot?: { employeeName?: string | null; badgeNumber?: string | null; nationalId?: string | null },
): Occupant {
  const l = lockerNumber ? byNumber.get(norm(lockerNumber)) : undefined;
  const snapName = snapshot?.employeeName?.trim() || null;
  const snapBadge = snapshot?.badgeNumber?.trim() || null;
  const hasSnap = !!(snapName || snapBadge);
  return {
    lockerNumber: lockerNumber ?? "—",
    // With a snapshot we cannot reveal via the live lockers row (the locker may
    // now hold a different person), so no reveal target is passed.
    id: hasSnap ? null : l?.id ?? null,
    employeeName: hasSnap ? snapName : l?.employee_name?.trim() || null,
    badgeNumber: hasSnap ? snapBadge : l?.badge_number?.trim() || null,
    nationalId: hasSnap ? snapshot?.nationalId ?? null : l?.national_id ?? null,
  };
}

/** Occupant snapshots stored on the history row itself (side A / side B). */
const snapA = (r: Row) => {
  const x = r as unknown as Record<string, string | null>;
  return { employeeName: x['employee_a'], badgeNumber: x['badge_a'], nationalId: x['national_id_a'] };
};
const snapB = (r: Row) => {
  const x = r as unknown as Record<string, string | null>;
  return { employeeName: x['employee_b'], badgeNumber: x['badge_b'], nationalId: x['national_id_b'] };
};

function OccupantCells({ o }: { o: Occupant }) {
  return (
    <>
      <span className="font-mono font-semibold truncate">{o.lockerNumber}</span>
      <span className="truncate">{o.employeeName ?? <span className="text-muted-foreground">—</span>}</span>
      <span className="font-mono text-xs truncate">
        {o.badgeNumber ?? <span className="text-muted-foreground font-sans">—</span>}
      </span>
      <NationalIdCell value={o.nationalId} recordId={o.id} table="lockers" />
    </>
  );
}


const GRID =
  "grid grid-cols-[5.5rem_7rem_1fr_7rem_9rem_9rem_11rem_6.5rem] gap-3 items-center";

/** Old-locker action rendered with the shared status label styling. */
function OldActionCell({ value }: { value: string | null | undefined }) {
  const raw = (value ?? "").trim();
  if (!raw || raw === "swap") return <span className="text-muted-foreground">—</span>;
  const swatch = STATUS_SWATCH[raw as LockerStatus] ?? "bg-muted-foreground";
  const label = STATUS_LABEL[raw as LockerStatus] ?? raw;
  return (
    <Badge variant="outline" className="gap-1.5 w-fit text-[10px]">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </Badge>
  );
}


export function TransferSwapHistoryPanel() {
  const { user, role } = useAuth();
  const { lockers } = useLockers();
  const { items } = useTransferSwapHistory();
  const [q, setQ] = useState("");

  const [clearOpen, setClearOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const byNumber = useMemo(() => {
    const m = new Map<string, Locker>();
    for (const l of lockers ?? []) {
      const k = norm(l.locker_number);
      const prev = m.get(k);
      // Prefer the row that actually has an occupant.
      if (!prev || (!prev.employee_name && l.employee_name)) m.set(k, l);
    }
    return m;
  }, [lockers]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((r) => {
      const a = occupantOf(r.locker_number, byNumber, snapA(r));
      const b = occupantOf(r.other_locker_number, byNumber, snapB(r));

      const hay = [
        r.locker_number,
        r.other_locker_number,
        r.event_type,
        a.employeeName,
        a.badgeNumber,
        b.employeeName,
        b.badgeNumber,
        r.performed_by_email,
      ]

        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [items, q, byNumber]);

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
      const { removedIds, auditError } = await clearTransferSwapHistoryRange(from, to, {
        id: user!.id,
        email: user!.email ?? null,
      });

      // Instant update first, background refetch as the safety net.
      removeTransferSwapHistoryFromCache(removedIds);
      invalidateTransferSwapHistory();

      if (auditError) toast.warning(`History cleared, but audit log failed: ${auditError}`);

      const removed = removedIds.length;
      toast.success(`Removed ${removed} entr${removed === 1 ? "y" : "ies"}`);
      setClearOpen(false);
      resetClear();
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
            placeholder="Search locker number, name or badge…"
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
          <div className="overflow-x-auto">
            <div className="min-w-[70rem]">
              <div
                className={`${GRID} px-4 py-2 border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground`}
              >
                <span>Type</span>
                <span>Locker</span>
                <span>Employee Name</span>
                <span>Badge</span>
                <span>National ID</span>
                <span>Old Locker Set To</span>
                <span>Admin</span>
                <span>Date</span>
              </div>
              <div className="divide-y max-h-[32rem] overflow-auto">
                {filtered.map((r) => {
                  const isSwap = r.event_type === "swap";
                  const a = occupantOf(r.locker_number, byNumber, snapA(r));
                  const b = occupantOf(r.other_locker_number, byNumber, snapB(r));
                  const date = formatBatchIntake(r.occurred_on);
                  const oldAction = (r as unknown as Record<string, string | null>)['old_locker_action'];
                  const admin = (
                    <span className="text-xs text-muted-foreground truncate" title={r.performed_by_email ?? ""}>
                      {r.performed_by_email ?? "—"}
                    </span>
                  );

                  if (isSwap) {
                    // ONE row per swap event: both sides stacked inside it,
                    // with a single Date column on the right.
                    return (
                      <div key={r.id} className={`${GRID} px-4 py-2.5 text-sm bg-muted/20`}>
                        <Badge variant="outline" className="gap-1 text-[10px] w-fit">
                          <Repeat className="h-3 w-3" /> Swap
                        </Badge>
                        <div className="col-span-4 rounded-md border border-border/60 bg-background/60 divide-y divide-border/60">
                          <div className="grid grid-cols-[7rem_1fr_7rem_9rem] gap-3 items-center px-2 py-1.5">
                            <OccupantCells o={a} />
                          </div>
                          <div className="grid grid-cols-[7rem_1fr_7rem_9rem] gap-3 items-center px-2 py-1.5">
                            <OccupantCells o={b} />
                          </div>
                        </div>
                        <OldActionCell value={oldAction} />
                        {admin}
                        <span className="text-muted-foreground whitespace-nowrap">{date}</span>
                      </div>
                    );
                  }

                  // Transfer: occupant details come from whichever side holds the person.
                  const person = a.employeeName || a.badgeNumber ? a : b;
                  return (
                    <div key={r.id} className={`${GRID} px-4 py-2.5 text-sm`}>
                      <Badge variant="outline" className="gap-1 text-[10px] w-fit">
                        <ArrowRightLeft className="h-3 w-3" /> Transfer
                      </Badge>
                      <span className="font-mono font-semibold truncate">
                        {r.other_locker_number ?? r.locker_number}
                        {r.other_locker_number && (
                          <span className="block text-[10px] font-sans font-normal text-muted-foreground">
                            → {r.locker_number}
                          </span>
                        )}
                      </span>
                      <span className="truncate">
                        {person.employeeName ?? <span className="text-muted-foreground">—</span>}
                      </span>
                      <span className="font-mono text-xs truncate">
                        {person.badgeNumber ?? <span className="text-muted-foreground font-sans">—</span>}
                      </span>
                      <NationalIdCell value={person.nationalId} recordId={person.id} table="lockers" />
                      <OldActionCell value={oldAction} />
                      {admin}
                      <span className="text-muted-foreground whitespace-nowrap">{date}</span>
                    </div>
                  );
                })}

              </div>
            </div>
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
