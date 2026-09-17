import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, Search, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLockers, invalidateLockersCache, patchLockersInCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { syncActivationToOccupancy, syncStatusChangeToOccupancy } from "@/lib/occupancy-sync";
import { LOCKER_STATUSES, STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import { KeyBadge, isCombinationLock } from "@/components/KeyBadge";
import type { Database } from "@/integrations/supabase/types";

const SPARE_KEY_WARNING_STATUSES = ["missing", "with_employee"];

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locker: Locker;
  onTransferred?: () => void;
}


export function TransferLockerDialog({ open, onOpenChange, locker, onTransferred }: Props) {
  const { lockers } = useLockers();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 180);
  const [locFilter, setLocFilter] = useState<string>(locker.location);
  const [statusFilter, setStatusFilter] = useState<"all" | LockerStatus>("all");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [oldAction, setOldAction] = useState<LockerStatus>("empty");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) invalidateLockersCache();
  }, [open]);

  const locations = useMemo(() => {
    if (!lockers) return [];
    return Array.from(new Set(lockers.map((l) => l.location))).sort();
  }, [lockers]);

  const available = useMemo(() => {
    if (!lockers) return [];
    const q = debounced.toLowerCase().trim();
    return lockers
      .filter((l) =>
        l.id !== locker.id &&
        l.status !== "active" &&
        !l.badge_number && !l.employee_name &&
        (locFilter === "all" || l.location === locFilter) &&
        (statusFilter === "all" || l.status === statusFilter) &&
        (!q ||
          l.locker_number.toLowerCase().includes(q) ||
          (l.row_label ?? "").toLowerCase().includes(q) ||
          (l.key_lock ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number))
      .slice(0, 200);
  }, [lockers, debounced, locFilter, statusFilter, locker.id]);

  const target = useMemo(() => available.find((l) => l.id === targetId) ?? null, [available, targetId]);
  

  const reset = () => { setSearch(""); setTargetId(null); setOldAction("empty"); setConfirming(false); };

  const handleTransfer = () => {
    if (!target) { toast.error("Pick a target locker"); return; }
    const from = locker;
    const to = target;
    const action = oldAction;

    // Optimistic: patch both rows locally + close instantly so admin can move on.
    const optimisticFrom: Locker = {
      ...from,
      badge_number: null,
      employee_name: null,
      national_id: null,
      work_location: null,
      batch_intake: null,
      remark: null,
      custom_status: null,
      status: action,
    };
    const optimisticTo: Locker = {
      ...to,
      badge_number: from.badge_number,
      employee_name: from.employee_name,
      national_id: from.national_id,
      work_location: from.work_location,
      batch_intake: from.batch_intake,
      remark: from.remark,
      status: "active",
    };
    patchLockersInCache([optimisticFrom, optimisticTo]);
    toast.success(`Transferring ${from.employee_name ?? from.badge_number} → ${to.locker_number}`);
    onOpenChange(false);
    reset();
    onTransferred?.();

    void (async () => {
      // Re-fetch the target from DB to avoid stale-cache "already occupied" errors.
      const { data: fresh, error: freshErr } = await supabase
        .from("lockers")
        .select("id, status, employee_name, badge_number, locker_number, deleted_at")
        .eq("id", to.id)
        .maybeSingle();
      if (freshErr) {
        toast.error(`Transfer failed: ${freshErr.message}`);
        invalidateLockersCache();
        return;
      }
      if (!fresh || fresh.deleted_at) {
        toast.error("Target locker no longer exists");
        invalidateLockersCache();
        return;
      }
      if (fresh.status === "active" || fresh.employee_name || fresh.badge_number) {
        toast.error(`Target ${fresh.locker_number} is now occupied — pick another locker`);
        invalidateLockersCache();
        return;
      }

      const { data, error } = await supabase.rpc("transfer_locker" as never, {
        _from_id: from.id,
        _to_id: to.id,
        _old_action: action,
      } as never);
      if (error) {
        toast.error(`Transfer failed: ${error.message}`);
        invalidateLockersCache();
        return;
      }
      const result = data as { from: Locker; to: Locker } | null;
      if (result?.from && result?.to) {
        patchLockersInCache([result.from, result.to]);
        // The transfer RPC writes its history row in the same transaction as
        // the locker move, so a successful move can never be missing history.
        try {
          await syncStatusChangeToOccupancy(result.from);
          await syncActivationToOccupancy(result.to);
        } catch (err) {
          toast.error(err instanceof Error ? `Occupancy sync failed: ${err.message}` : "Occupancy sync failed");
        }
      }
    })();
  };


  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" /> Transfer locker
          </DialogTitle>
          <DialogDescription>
            Move <span className="font-semibold">{locker.employee_name ?? locker.badge_number ?? "occupant"}</span>{" "}
            from <span className="font-semibold">{locker.locker_number}</span> to an available locker.
          </DialogDescription>
        </DialogHeader>

        {!confirming ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_180px] gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search locker #, row, key lock…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {LOCKER_STATUSES.filter((s) => s !== "active").map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                Available lockers · {available.length}
              </Label>
              <div className="mt-1 border rounded-md max-h-72 overflow-auto divide-y">
                {available.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-center text-muted-foreground">
                    No available lockers match.
                  </div>
                ) : available.map((l) => {
                  const sel = l.id === targetId;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setTargetId(l.id)}
                      className={`w-full text-left px-3 py-2 text-sm grid grid-cols-[70px_1fr_auto] sm:grid-cols-[110px_1fr_1fr_auto] gap-2 sm:gap-3 items-center hover:bg-muted/50 ${sel ? "bg-primary/10" : ""}`}
                    >
                      <span className="font-semibold">{l.locker_number}</span>
                      <span className="truncate text-muted-foreground min-w-0">{l.location}{l.row_label ? ` · ${l.row_label}` : ""}</span>
                      <span className="hidden sm:block truncate text-xs text-muted-foreground min-w-0">{l.key_lock ?? "—"}</span>
                      <Badge variant="outline" className="gap-1.5 capitalize shrink-0">
                        <span className={`h-2 w-2 rounded-full ${STATUS_SWATCH[l.status as LockerStatus] ?? "bg-muted-foreground"}`} />
                        {STATUS_LABEL[l.status as LockerStatus] ?? l.status}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>What to do with old locker {locker.locker_number}?</Label>
              <Select value={oldAction} onValueChange={(v) => setOldAction(v as LockerStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCKER_STATUSES.filter((s) => s !== "active").map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Occupant</div>
                <div className="font-semibold">
                  {locker.employee_name ?? "—"}
                  {locker.badge_number ? <span className="text-muted-foreground font-normal"> · {locker.badge_number}</span> : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">From (old locker)</div>
                  <div className="font-semibold">{locker.locker_number}</div>
                  <div className="text-xs text-muted-foreground">
                    {locker.location}{locker.row_label ? ` · ${locker.row_label}` : ""}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Spare Key:</span>
                    <KeyBadge status={locker.spare_key_status} keyLock={locker.key_lock} />
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
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">To (new locker)</div>
                  <div className="font-semibold">{target?.locker_number}</div>
                  <div className="text-xs text-muted-foreground">
                    {target?.location}{target?.row_label ? ` · ${target.row_label}` : ""}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Spare Key:</span>
                    <KeyBadge status={target?.spare_key_status ?? null} keyLock={target?.key_lock} />
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
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Old locker action</div>
                <div className="font-semibold">{STATUS_LABEL[oldAction]}</div>
              </div>
              {((!isCombinationLock(locker.key_lock) && SPARE_KEY_WARNING_STATUSES.includes(locker.spare_key_status ?? "unknown") ||
                (!isCombinationLock(target?.key_lock) && SPARE_KEY_WARNING_STATUSES.includes(target?.spare_key_status ?? "unknown"))) && (
                <p className="text-xs text-warning flex items-start gap-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    One or both spare keys are not yet returned — recommend recovering them before/after the transfer.
                    <span className="block text-muted-foreground italic">Kunci sandaran belum dipulangkan — disyorkan diambil semula sebelum/selepas pemindahan.</span>
                  </span>
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Runs as a single atomic operation — the target locker is locked so two users can't claim it at the same time.
            </p>
          </div>
        )}

        <DialogFooter>
          {!confirming ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => setConfirming(true)} disabled={!target || busy}>
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                {target ? `Review → ${target.locker_number}` : "Review transfer"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
              <Button onClick={handleTransfer} disabled={busy}>
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                {busy ? "Transferring…" : "Confirm transfer"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
