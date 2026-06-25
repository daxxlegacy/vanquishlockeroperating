import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Repeat, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { syncActivationToOccupancy } from "@/lib/occupancy-sync";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import type { Database } from "@/integrations/supabase/types";

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

  const handleSwap = async () => {
    if (!target) { toast.error("Pick a locker to swap with"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("swap_lockers" as never, {
        _a_id: locker.id,
        _b_id: target.id,
      } as never);
      if (error) throw error;

      const result = data as { a: Locker; b: Locker } | null;
      if (result?.a && result?.b) {
        await syncActivationToOccupancy(result.a);
        await syncActivationToOccupancy(result.b);
      }

      toast.success(`Swapped ${locker.locker_number} ↔ ${target.locker_number}`);
      invalidateLockersCache();
      onOpenChange(false);
      reset();
      onSwapped?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Swap failed");
    } finally {
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
                      className={`w-full text-left px-3 py-2 text-sm grid grid-cols-[110px_1fr_1fr_auto] gap-3 items-center hover:bg-muted/50 ${sel ? "bg-primary/10" : ""}`}
                    >
                      <span className="font-semibold">{l.locker_number}</span>
                      <span className="truncate">{l.employee_name ?? "—"}<span className="text-muted-foreground"> · {l.badge_number ?? "—"}</span></span>
                      <span className="truncate text-xs text-muted-foreground">{l.location}{l.row_label ? ` · ${l.row_label}` : ""}</span>
                      <Badge variant="outline" className="gap-1.5 capitalize">
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
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Locker A</div>
                  <div className="font-semibold">{locker.locker_number}</div>
                  <div>{locker.employee_name ?? "—"}{locker.badge_number ? <span className="text-muted-foreground"> · {locker.badge_number}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{locker.location}{locker.row_label ? ` · ${locker.row_label}` : ""}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Locker B</div>
                  <div className="font-semibold">{target?.locker_number}</div>
                  <div>{target?.employee_name ?? "—"}{target?.badge_number ? <span className="text-muted-foreground"> · {target.badge_number}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{target?.location}{target?.row_label ? ` · ${target.row_label}` : ""}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Employee, badge, national ID, batch intake, work location, remark, and status are swapped between the two lockers. Physical attributes (row, key lock) stay with each locker.
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
