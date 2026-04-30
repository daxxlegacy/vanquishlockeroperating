import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { softDeleteLocker, undoDeletion, UNDO_TOAST_MS } from "@/lib/delete-actions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locker: { id: string; locker_number: string; location: string };
  onDeleted?: () => void;
}

export function DeleteLockerDialog({ open, onOpenChange, locker, onDeleted }: Props) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reasonOk = reason.trim().length >= 4;
  const confirmOk = confirm.trim().toUpperCase() === locker.locker_number.toUpperCase();
  const canDelete = reasonOk && confirmOk && !busy;

  const handleDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      const { auditId } = await softDeleteLocker({
        id: locker.id,
        locker_number: locker.locker_number,
        location: locker.location,
        reason: reason.trim(),
      });
      toast.success(`Locker ${locker.locker_number} deleted`, {
        description: "You have 15 minutes to undo this from the Audit page.",
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await undoDeletion(auditId);
              toast.success(`Restored locker ${locker.locker_number}`);
              onDeleted?.();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Undo failed");
            }
          },
        },
      });
      onOpenChange(false);
      setReason(""); setConfirm("");
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Delete locker {locker.locker_number}?
          </DialogTitle>
          <DialogDescription>
            This will remove the locker from the active map and tables. You can restore it within 15 minutes from the Audit page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="del-reason">Reason for deletion *</Label>
            <Textarea
              id="del-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="e.g. Locker physically removed during renovation."
            />
            <p className="text-xs text-muted-foreground mt-1">{reason.trim().length}/500 — min 4 characters</p>
          </div>
          <div>
            <Label htmlFor="del-confirm">Type <span className="font-mono font-semibold">{locker.locker_number}</span> to confirm</Label>
            <Input
              id="del-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            {busy ? "Deleting…" : "Delete locker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
