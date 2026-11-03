import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserMinus, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { parseBatchIntake } from "@/lib/locker-utils";
import { terminateLocker } from "@/lib/termination-actions";
import { invalidateLockersCache } from "@/lib/lockers-cache";
import { LOCKER_STATUSES, STATUS_LABEL, defaultPostTerminationStatus } from "@/lib/locker-status";
import { KeyBadge, isCombinationLock } from "@/components/KeyBadge";
import type { Database } from "@/integrations/supabase/types";
import { TerminationMetadataFields } from "@/components/TerminationMetadataFields";
import { suggestedType, validTerminationMetadata, type TerminationMetadata, type ReasonCode } from "@/lib/termination-reasons";

const SPARE_KEY_WARNING_STATUSES = ["missing", "with_employee"];

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
  const [reason, setReason] = useState<ReasonCode | "">("");
  const [metadata, setMetadata] = useState<TerminationMetadata>({});
  const [newStatus, setNewStatus] = useState<Database["public"]["Enums"]["locker_status"]>(() => defaultPostTerminationStatus(locker.key_lock));
  const [busy, setBusy] = useState(false);

  const iso = parseBatchIntake(date);
  const dateOk = !!iso;
  const canSubmit = dateOk && !busy && !!locker.employee_name && !!reason && validTerminationMetadata(metadata);

  const handleTerminate = async () => {
    if (!canSubmit || !iso || !reason) return;
    setBusy(true);
    try {
      await terminateLocker(locker, iso, reason === "OTHER" ? "OTHERS" : reason, newStatus, metadata);
      invalidateLockersCache();
      toast.success(`Terminated ${locker.employee_name} from ${locker.locker_number}`);
      onOpenChange(false);
      setReason("");
      setMetadata({});
      onTerminated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Termination failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <UserMinus className="h-5 w-5 text-warning" /> Terminate user
          </DialogTitle>
          <DialogDescription>
            Releases <span className="font-semibold">{locker.employee_name ?? "—"}</span> from locker {locker.locker_number}. The locker becomes empty and the termination is logged.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Spare Key:</span>
            <KeyBadge status={locker.spare_key_status} keyLock={locker.key_lock} />
          </div>
          {!isCombinationLock(locker.key_lock) && SPARE_KEY_WARNING_STATUSES.includes(locker.spare_key_status ?? "unknown") && (
            <p className="text-xs text-warning flex items-start gap-1">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Spare key not yet returned — recommend recovering it before/after termination.
                <span className="block text-muted-foreground italic">Kunci sandaran belum dipulangkan — disyorkan diambil semula sebelum/selepas penamatan.</span>
              </span>
            </p>
          )}
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
            <Select value={reason} onValueChange={(v) => { setReason(v as ReasonCode); setMetadata(prev => ({...prev,reason_code:v as ReasonCode,termination_type:suggestedType(v),reason_detail:null})); }}>
              <SelectTrigger id="term-reason"><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AWOL">AWOL (Absence Without Leave)</SelectItem>
                <SelectItem value="RESIGN">RESIGN</SelectItem>
                <SelectItem value="RTV">RTV (Return to Vendor)</SelectItem>
                <SelectItem value="OTHER">OTHERS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TerminationMetadataFields id="term" value={metadata} onChange={setMetadata} />
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
