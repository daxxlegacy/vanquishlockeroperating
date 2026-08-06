import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Repeat, Search, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLockers, invalidateLockersCache, patchLockersInCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { recordSwapHistory, SwapStepError } from "@/lib/occupancy-sync";
import { logTransferSwapEvent } from "@/lib/transfer-swap-history";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import { KeyBadge } from "@/components/KeyBadge";
import type { Database } from "@/integrations/supabase/types";

const SPARE_KEY_WARNING_STATUSES = ["missing", "with_employee"];

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locker: Locker;
  onSwapped?: () => void;
}

export function SwapLockerDialog({ open, onOpenChange, locker, onSwapped }: Props) {
  const { lockers } = useLockers();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 180);
  const [locFilter, setLocFilter] = useState<string>("all");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const locations = useMemo(() => {
    if (!lockers) return [];
    return Array.from(new Set(lockers.map((l) => l.location))).sort();
  }, [lockers]);

  const occupied = useMemo(() => {
    if (!lockers) return [];
    const q = debounced.toLowerCase().trim();
    return lockers
      .filter((l) =>
        l.id !== locker.id &&
        (!!l.employee_name || !!l.badge_number) &&
        (locFilter === "all" || l.location === locFilter) &&
        (!q ||
          l.locker_number.toLowerCase().includes(q) ||
          (l.employee_name ?? "").toLowerCase().includes(q) ||
          (l.badge_number ?? "").toLowerCase().includes(q) ||
          (l.row_label ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number))
      .slice(0, 200);
  }, [lockers, debounced, locFilter, locker.id]);

  const target = useMemo(() => occupied.find((l) => l.id === targetId) ?? null, [occupied, targetId]);

  const reset = () => { setSearch(""); setTargetId(null); setConfirming(false); };

  const inFlight = useRef(false);

  const handleSwap = async () => {
    if (!target) { toast.error("Pick a locker to swap with"); return; }
    if (inFlight.current) return; // guard double submits
    inFlight.current = true;
    setBusy(true);
    try {
      // Snapshot pre-swap occupants so we can terminate the outgoing rows correctly.
      const preA = { locker_number: locker.locker_number, employee_name: locker.employee_name, badge_number: locker.badge_number };
      const preB = { locker_number: target.locker_number, employee_name: target.employee_name, badge_number: target.badge_number };
      const nidA = locker.national_id;
      const nidB = target.national_id;

      const { data, error } = await supabase.rpc("swap_lockers" as never, {
        _a_id: locker.id,
        _b_id: target.id,
      } as never);
      if (error) throw error;

      const result = data as { a: Locker; b: Locker } | null;
      if (result?.a && result?.b) {
        // Instant cache patch so the Lockers page + LockerDetail re-render
        // with the swapped occupants immediately, before any background refetch.
        patchLockersInCache([result.a, result.b]);
        // Write the swap audit row FIRST — exactly ONE row per confirmed swap,
        // holding both lockers and both occupants. A later occupancy-sync
        // failure must never cost us the history record.
        try {
          await logTransferSwapEvent({
            eventType: "swap",
            lockerNumber: preA.locker_number,
            otherLockerNumber: preB.locker_number,
            sideA: { employeeName: preA.employee_name, badgeNumber: preA.badge_number, nationalId: nidA },
            sideB: { employeeName: preB.employee_name, badgeNumber: preB.badge_number, nationalId: nidB },
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Swap history log failed");
        }
        // Then reconcile occupancy: terminate outgoing occupancy row(s), then
        // insert fresh Active row for the incoming occupant. Order matters
        // to respect locker_occupancy_active_locker_unique.
        try {
          await recordSwapHistory(preA, result.a, preB.locker_number);
        } catch (err) {
          throw new Error(
            err instanceof SwapStepError
              ? `Locker ${err.lockerNumber} (side A): ${err.step} step failed — ${err.message.replace(/^Swap \w+ failed for [^:]+: /, "")}`
              : err instanceof Error ? `Locker A swap-history failed: ${err.message}` : "Locker A swap-history failed",
          );
        }
        try {
          await recordSwapHistory(preB, result.b, preA.locker_number);
        } catch (err) {
          throw new Error(
            err instanceof SwapStepError
              ? `Locker ${err.lockerNumber} (side B): ${err.step} step failed — ${err.message.replace(/^Swap \w+ failed for [^:]+: /, "")}`
              : err instanceof Error ? `Locker B swap-history failed: ${err.message}` : "Locker B swap-history failed",
          );
        }
      }




      toast.success(`Swapped ${locker.locker_number} ↔ ${target.locker_number}`);
      invalidateLockersCache();
      onOpenChange(false);
      reset();
      onSwapped?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Swap failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }

  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Repeat className="h-5 w-5 text-primary" /> Swap with another user
          </DialogTitle>
          <DialogDescription>
            Swap all occupant details between <span className="font-semibold">{locker.locker_number}</span>{" "}
            ({locker.employee_name ?? locker.badge_number ?? "occupant"}) and another occupied locker.
          </DialogDescription>
        </DialogHeader>

        {!confirming ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search locker #, name, badge…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={locFilter} onValueChange={setLocFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Occupied lockers · {occupied.length}
              </Label>
              <div className="mt-1 border rounded-md max-h-72 overflow-auto divide-y">
                {occupied.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-center text-muted-foreground">
                    No occupied lockers match.
                  </div>
                ) : occupied.map((l) => {
                  const sel = l.id === targetId;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setTargetId(l.id)}
                      className={`w-full text-left px-3 py-2 text-sm grid grid-cols-[70px_1fr_auto] sm:grid-cols-[110px_1fr_1fr_auto] gap-2 sm:gap-3 items-center hover:bg-muted/50 ${sel ? "bg-primary/10" : ""}`}
                    >
                      <span className="font-semibold">{l.locker_number}</span>
                      <span className="truncate min-w-0">{l.employee_name ?? "—"}<span className="text-muted-foreground"> · {l.badge_number ?? "—"}</span></span>
                      <span className="hidden sm:block truncate text-xs text-muted-foreground min-w-0">{l.location}{l.row_label ? ` · ${l.row_label}` : ""}</span>
                      <Badge variant="outline" className="gap-1.5 capitalize shrink-0">
                        <span className={`h-2 w-2 rounded-full ${STATUS_SWATCH[l.status as LockerStatus] ?? "bg-muted-foreground"}`} />
                        {STATUS_LABEL[l.status as LockerStatus] ?? l.status}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Locker A</div>
                  <div className="font-semibold">{locker.locker_number}</div>
                  <div>{locker.employee_name ?? "—"}{locker.badge_number ? <span className="text-muted-foreground"> · {locker.badge_number}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{locker.location}{locker.row_label ? ` · ${locker.row_label}` : ""}</div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Spare Key:</span>
                    <KeyBadge status={locker.spare_key_status} />
                  </div>
                  <Link
                    to="/spare-keys"
                    search={{ search: locker.locker_number }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    View spare key details <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Locker B</div>
                  <div className="font-semibold">{target?.locker_number}</div>
                  <div>{target?.employee_name ?? "—"}{target?.badge_number ? <span className="text-muted-foreground"> · {target.badge_number}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{target?.location}{target?.row_label ? ` · ${target.row_label}` : ""}</div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Spare Key:</span>
                    <KeyBadge status={target?.spare_key_status ?? null} />
                  </div>
                  <Link
                    to="/spare-keys"
                    search={{ search: target?.locker_number ?? "" }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    View spare key details <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
              {(SPARE_KEY_WARNING_STATUSES.includes(locker.spare_key_status ?? "unknown") ||
                SPARE_KEY_WARNING_STATUSES.includes(target?.spare_key_status ?? "unknown")) && (
                <p className="text-xs text-warning flex items-start gap-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    One or both spare keys are not yet returned — recommend recovering them before/after the swap.
                    <span className="block text-muted-foreground italic">Kunci sandaran belum dipulangkan — disyorkan diambil semula sebelum/selepas pertukaran.</span>
                  </span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                This will terminate the current occupants' records and create new intake records reflecting the swap — full history is preserved for both employees. Physical attributes (row, key lock) stay with each locker.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!confirming ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => setConfirming(true)} disabled={!target || busy}>
                <Repeat className="h-4 w-4 mr-1" />
                {target ? `Review ↔ ${target.locker_number}` : "Review swap"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
              <Button onClick={handleSwap} disabled={busy}>
                <Repeat className="h-4 w-4 mr-1" />
                {busy ? "Swapping…" : "Confirm swap"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
