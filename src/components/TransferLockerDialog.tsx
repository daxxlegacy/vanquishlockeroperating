import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLockers, invalidateLockersCache } from "@/lib/lockers-cache";
import { useDebounced } from "@/hooks/use-debounced";
import { compareLockerNumbers } from "@/lib/locker-utils";
import { syncActivationToOccupancy, syncStatusChangeToOccupancy } from "@/lib/occupancy-sync";
import { STATUS_LABEL, STATUS_SWATCH, type LockerStatus } from "@/lib/locker-status";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locker: Locker;
  onTransferred?: () => void;
}

type OldAction = "empty" | "cleaning" | "broken_door" | "find_spare_key";

const OLD_ACTIONS: { value: OldAction; label: string; desc: string }[] = [
  { value: "empty", label: "Empty (ready for use)", desc: "Mark old locker as empty." },
  { value: "find_spare_key", label: "Find spare key", desc: "Put old locker on hold and flag spare key as missing." },
  { value: "cleaning", label: "Cleaning", desc: "Send old locker to cleaning." },
  { value: "broken_door", label: "Damage / broken door", desc: "Mark old locker as damaged." },
];

export function TransferLockerDialog({ open, onOpenChange, locker, onTransferred }: Props) {
  const { lockers } = useLockers();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 180);
  const [locFilter, setLocFilter] = useState<string>(locker.location);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [oldAction, setOldAction] = useState<OldAction>("empty");
  const [busy, setBusy] = useState(false);

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
        (l.status === "empty" || l.status === "cleaning" || l.status === "repair") &&
        !l.badge_number && !l.employee_name &&
        (locFilter === "all" || l.location === locFilter) &&
        (!q ||
          l.locker_number.toLowerCase().includes(q) ||
          (l.row_label ?? "").toLowerCase().includes(q) ||
          (l.key_lock ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => compareLockerNumbers(a.locker_number, b.locker_number))
      .slice(0, 200);
  }, [lockers, debounced, locFilter, locker.id]);

  const target = useMemo(() => available.find((l) => l.id === targetId) ?? null, [available, targetId]);

  const reset = () => { setSearch(""); setTargetId(null); setOldAction("empty"); };

  const handleTransfer = async () => {
    if (!target) { toast.error("Pick a target locker"); return; }
    if (!locker.employee_name && !locker.badge_number) { toast.error("Old locker has no occupant to transfer"); return; }
    setBusy(true);
    try {
      // 1. Activate target with same occupant
      const { data: newRow, error: e1 } = await supabase
        .from("lockers")
        .update({
          employee_name: locker.employee_name,
          badge_number: locker.badge_number,
          batch_intake: locker.batch_intake,
          status: "active",
          remark: locker.remark,
        })
        .eq("id", target.id)
        .select("*")
        .single();
      if (e1) throw e1;

      // 2. Update old locker
      const oldUpdate: Partial<Locker> = {
        employee_name: null,
        badge_number: null,
        batch_intake: null,
      };
      if (oldAction === "find_spare_key") {
        oldUpdate.status = "on_hold";
        oldUpdate.spare_key_status = "missing";
      } else {
        oldUpdate.status = oldAction;
      }
      const { data: oldRow, error: e2 } = await supabase
        .from("lockers")
        .update(oldUpdate)
        .eq("id", locker.id)
        .select("*")
        .single();
      if (e2) throw e2;

      // 3. Sync occupancy history
      await syncStatusChangeToOccupancy(oldRow as Locker);
      await syncActivationToOccupancy(newRow as Locker);

      toast.success(`Transferred ${locker.employee_name ?? locker.badge_number} → ${target.locker_number}`);
      invalidateLockersCache();
      onOpenChange(false);
      reset();
      onTransferred?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
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

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-[1fr_220px] gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search locker #, row, key lock…"
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
                    className={`w-full text-left px-3 py-2 text-sm grid grid-cols-[110px_1fr_1fr_auto] gap-3 items-center hover:bg-muted/50 ${sel ? "bg-primary/10" : ""}`}
                  >
                    <span className="font-semibold">{l.locker_number}</span>
                    <span className="truncate text-muted-foreground">{l.location}{l.row_label ? ` · ${l.row_label}` : ""}</span>
                    <span className="truncate text-xs text-muted-foreground">{l.key_lock ?? "—"}</span>
                    <Badge variant="outline" className="gap-1.5 capitalize">
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
            <Select value={oldAction} onValueChange={(v) => setOldAction(v as OldAction)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OLD_ACTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {OLD_ACTIONS.find((o) => o.value === oldAction)?.desc}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={!target || busy}>
            <ArrowRightLeft className="h-4 w-4 mr-1" />
            {busy ? "Transferring…" : target ? `Transfer → ${target.locker_number}` : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
