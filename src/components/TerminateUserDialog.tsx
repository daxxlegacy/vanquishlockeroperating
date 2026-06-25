import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseBatchIntake } from "@/lib/locker-utils";
import { terminateLocker } from "@/lib/termination-actions";
import { LOCKER_STATUSES, STATUS_LABEL, defaultPostTerminationStatus } from "@/lib/locker-status";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locker: Locker;
  onTerminated?: () => void;
}

export function TerminateUserDialog({ open, onOpenChange, locker, onTerminated }: Props) {
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const [date, setDate] = useState(todayStr);
  const [reason, setReason] = useState<"AWOL" | "RESIGN" | "">("");
  const [newStatus, setNewStatus] = useState<Database["public"]["Enums"]["locker_status"]>(() => defaultPostTerminationStatus(locker.key_lock));
  const [busy, setBusy] = useState(false);

  const iso = parseBatchIntake(date);
  const dateOk = !!iso;
  const canSubmit = dateOk && !busy && !!locker.employee_name && !!reason;

  const handleTerminate = async () => {
    if (!canSubmit || !iso || !reason) return;
    setBusy(true);
    try {
      await terminateLocker(locker, iso, reason, newStatus);
      toast.success(`Terminated ${locker.employee_name} from ${locker.locker_number}`);
      onOpenChange(false);
      setReason("");
      onTerminated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Termination failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <UserMinus className="h-5 w-5 text-warning" /> Terminate user
          </DialogTitle>
          <DialogDescription>
            Releases <span className="font-semibold">{locker.employee_name ?? "—"}</span> from locker {locker.locker_number}. The locker becomes empty and the termination is logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="term-date">Termination date (dd/mm/yyyy) *</Label>
            <Input
              id="term-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="16/01/2026"
              className="font-mono"
            />
            {!dateOk && date && <p className="text-xs text-destructive mt-1">Use format dd/mm/yyyy</p>}
          </div>
          <div>
            <Label htmlFor="term-status">Locker status after termination *</Label>
            <Select value={newStatus} onValueChange={(v) => setNewStatus(v as Database["public"]["Enums"]["locker_status"])}>
              <SelectTrigger id="term-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOCKER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="term-reason">Reason *</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as "AWOL" | "RESIGN")}>
              <SelectTrigger id="term-reason"><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AWOL">AWOL (Absence Without Leave)</SelectItem>
                <SelectItem value="RESIGN">RESIGN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleTerminate} disabled={!canSubmit} className="bg-warning text-warning-foreground hover:bg-warning/90">
            <UserMinus className="h-4 w-4 mr-1" />
            {busy ? "Saving…" : "Terminate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
