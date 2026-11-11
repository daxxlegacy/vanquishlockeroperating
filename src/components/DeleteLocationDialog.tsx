// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { softDeleteLocation, undoDeletion, UNDO_TOAST_MS } from "@/lib/delete-actions";
import { compareLockerNumbers } from "@/lib/locker-utils";

export function DeleteLocationDialog({
  locations,
  onDeleted,
}: {
  locations: string[];
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);

  useEffect(() => {
    if (!target) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("lockers")
        .select("locker_number")
        .eq("location", target)
        .is("deleted_at", null);
      if (cancelled) return;
      const nums = (data ?? []).map((r) => r.locker_number).sort(compareLockerNumbers);
      setPreview(nums);
    })();
    return () => { cancelled = true; };
  }, [target]);

  const reasonOk = reason.trim().length >= 4;
  const confirmOk = target && confirm.trim() === target;
  const canDelete = !!target && !!preview?.length && reasonOk && confirmOk && !busy;

  const reset = () => { setTarget(""); setReason(""); setConfirm(""); setPreview(null); };

  const handleDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      const { auditId, count } = await softDeleteLocation({ location: target, reason: reason.trim() });
      toast.success(`Deleted ${count} lockers from "${target}"`, {
        description: "You have 15 minutes to undo from the Audit page.",
        duration: UNDO_TOAST_MS,
        action: auditId ? {
          label: "Undo",
          onClick: async () => {
            try {
              const restored = await undoDeletion(auditId);
              toast.success(`Restored ${restored} lockers in "${target}"`);
              onDeleted();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Undo failed");
            }
          },
        } : undefined,
      });
      setOpen(false);
      reset();
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); if (!v) reset(); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={locations.length === 0}>
          <Trash2 className="h-4 w-4 mr-1" /> Delete Location
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Delete an entire location
          </DialogTitle>
          <DialogDescription>
            All lockers in the selected location will be soft-deleted. Restorable within 15 minutes from the Audit page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Location</Label>
            <Select value={target} onValueChange={(v) => { setTarget(v); setConfirm(""); }}>
              <SelectTrigger><SelectValue placeholder="Select a location…" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {target && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                {preview === null ? "Loading lockers…" :
                  preview.length === 0 ? "No active lockers in this location." :
                  <>This will delete <span className="text-destructive font-bold">{preview.length}</span> lockers:</>}
              </p>
              {preview && preview.length > 0 && (
                <ScrollArea className="h-32 mt-2">
                  <div className="flex flex-wrap gap-1 pr-3">
                    {preview.map((n) => (
                      <span key={n} className="font-mono text-xs px-1.5 py-0.5 rounded bg-background border">{n}</span>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="loc-reason">Reason for deletion *</Label>
            <Textarea
              id="loc-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="e.g. Decommissioning building wing."
            />
          </div>

          {target && (
            <div>
              <Label htmlFor="loc-confirm">Type <span className="font-mono font-semibold">{target}</span> to confirm</Label>
              <Input id="loc-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="font-mono" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            {busy ? "Deleting…" : `Delete ${preview?.length ?? 0} lockers`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
