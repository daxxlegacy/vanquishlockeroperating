import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, UserMinus, ArrowRightLeft, Repeat, Eraser } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getLockerById, patchLockersInCache } from "@/lib/lockers-cache";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { DeleteLockerDialog } from "@/components/DeleteLockerDialog";
import { TerminateUserDialog } from "@/components/TerminateUserDialog";
import { TransferLockerDialog } from "@/components/TransferLockerDialog";
import { SwapLockerDialog } from "@/components/SwapLockerDialog";
import { syncActivationToOccupancy, syncMetadataToOccupancy, syncStatusChangeToOccupancy } from "@/lib/occupancy-sync";
import { LOCKER_STATUSES } from "@/lib/locker-status";
import type { Database } from "@/integrations/supabase/types";
import { NationalIdCell } from "@/components/NationalIdCell";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  lockerId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  mode?: "full" | "spare";
}

const SPARE_DETAIL_OPTIONS = ["missing", "available", "taken", "taken_for_cleaning"] as const;

const STATUSES = LOCKER_STATUSES;


export function LockerDetail({ lockerId, open, onClose, onUpdated, mode = "full" }: Props) {
  const isSpare = mode === "spare";
  const { role } = useAuth();
  const [locker, setLocker] = useState<Locker | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const isAdmin = role === "admin";
  const editedRef = useRef(false);

  useEffect(() => {
    if (!lockerId || !open) return;
    editedRef.current = false;
    const cached = getLockerById(lockerId);
    if (cached) setLocker(cached);
    // Admins can read the full national_id from the base table (RLS allows).
    // Everyone else reads from the masked view so national_id is never exposed.
    const source = isAdmin ? "lockers" : "lockers_masked";
    (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (col: string, v: string) => { single: () => Promise<{ data: Locker | null }> } } } })
      .from(source).select("*").eq("id", lockerId).single().then(({ data }) => {
        // Guard against overwriting in-progress edits: if the admin has
        // started editing before the fresh fetch resolves, keep local state.
        if (data && !editedRef.current) setLocker(data);
      });
  }, [lockerId, open, isAdmin]);

  if (!locker) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent><DialogHeader><DialogTitle>Loading…</DialogTitle></DialogHeader></DialogContent>
      </Dialog>
    );
  }

  const update = (k: keyof Locker, v: string | null) => {
    editedRef.current = true;
    setLocker({ ...locker, [k]: v });
  };

  const handleSave = () => {
    if (!isAdmin) return;
    const customClean = (locker.custom_status ?? "").trim();
    const updatePayload = {
      key_lock: locker.key_lock,
      location: locker.location,
      row_label: locker.row_label,
      work_location: locker.work_location,
      badge_number: locker.badge_number,
      employee_name: locker.employee_name,
      national_id: locker.national_id,
      status: locker.status,
      custom_status: customClean ? customClean : null,
      spare_key_status: locker.spare_key_status,
      remark: locker.remark,
      batch_intake: locker.batch_intake,
    };
    const snap = locker;
    const optimistic = { ...snap, ...updatePayload } as Locker;

    // Optimistic: patch cache + close instantly so admin can key in the next locker.
    patchLockersInCache([optimistic]);
    toast.success("Locker updated");
    onUpdated?.();
    onClose();

    // Persist + sync occupancy in the background.
    void (async () => {
      const { error } = await supabase.from("lockers").update(updatePayload).eq("id", snap.id);
      if (error) { toast.error(`Save failed: ${error.message}`); return; }
      if (snap.status === "active" && (snap.employee_name || snap.badge_number)) {
        await syncActivationToOccupancy(snap);
        await syncMetadataToOccupancy(snap);
      } else {
        await syncStatusChangeToOccupancy(snap);
      }
    })();
  };

  const handleClearDetails = async () => {
    if (!isAdmin) return;
    setClearing(true);
    const cleared = {
      badge_number: null,
      employee_name: null,
      national_id: null,
      work_location: null,
      batch_intake: null,
      remark: null,
      custom_status: null,
      status: "empty" as const,
    };
    const { error } = await supabase.from("lockers").update(cleared).eq("id", locker.id);
    setClearing(false);
    setClearOpen(false);
    if (error) { toast.error(error.message); return; }
    const updated = { ...locker, ...cleared } as Locker;
    setLocker(updated);
    patchLockersInCache([updated]);
    await syncStatusChangeToOccupancy(updated);
    toast.success("Locker details cleared");
    onUpdated?.();
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Locker {locker.locker_number}</DialogTitle>
          </DialogHeader>
          {isSpare ? (
            <div className="py-4 space-y-3">
              <p className="text-sm text-muted-foreground">Update the spare key status for this locker.</p>
              <SelectField
                label="Spare Key Status"
                value={locker.spare_key_status ?? "unknown"}
                options={SPARE_DETAIL_OPTIONS}
                onChange={(v) => update("spare_key_status", v)}
                disabled={!isAdmin}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
              <Field label="Location" value={locker.location} onChange={(v) => update("location", v)} disabled={!isAdmin} />
              <Field label="Key Lock" value={locker.key_lock ?? ""} onChange={(v) => update("key_lock", v)} disabled={!isAdmin} />
              <Field label="Badge Number" value={locker.badge_number ?? ""} onChange={(v) => update("badge_number", v)} disabled={!isAdmin} />
              <Field label="Employee Name" value={locker.employee_name ?? ""} onChange={(v) => update("employee_name", v)} disabled={!isAdmin} />
              <Field label="Work Location" value={locker.work_location ?? ""} onChange={(v) => update("work_location", v)} disabled={!isAdmin} />
              <SelectField label="Status" value={locker.status} options={STATUSES} onChange={(v) => update("status", v)} disabled={!isAdmin} />
              <DateField label="Batch Intake" value={locker.batch_intake ?? ""} onChange={(v) => update("batch_intake", v)} disabled={!isAdmin} />
              {isAdmin ? (
                <Field label="National ID" value={locker.national_id ?? ""} onChange={(v) => update("national_id", v)} disabled={false} />
              ) : (
                <div>
                  <Label>National ID</Label>
                  <div className="h-9 flex items-center rounded-md border bg-muted/30 px-3">
                    <NationalIdCell value={locker.national_id} recordId={locker.id} table="lockers" />
                  </div>
                </div>
              )}
              <div className="sm:col-span-2">
                <Label>Custom Status (free text)</Label>
                <Input
                  value={locker.custom_status ?? ""}
                  placeholder='e.g. "Blocked", "VIP hold", "Quarantine" — overrides Status when set'
                  onChange={(e) => update("custom_status", e.target.value)}
                  disabled={!isAdmin}
                />
                <p className="text-xs text-muted-foreground mt-1">Leave blank to use the standard Status above. When set, it shows everywhere across the app.</p>
              </div>
              <div className="sm:col-span-2">
                <Label>Remark</Label>
                <Textarea
                  value={locker.remark ?? ""}
                  onChange={(e) => update("remark", e.target.value)}
                  disabled={!isAdmin}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-col sm:flex-row sm:justify-between">
            {!isSpare && isAdmin ? (
              <div className="flex gap-2 flex-wrap">
                <Button variant="destructive" size="sm" disabled={saving} onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving || clearing}
                  onClick={() => setClearOpen(true)}
                >
                  <Eraser className="h-4 w-4 mr-1" /> Clear details
                </Button>
                {locker.employee_name && (
                  <>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => setTransferOpen(true)}
                      variant="secondary"
                    >
                      <ArrowRightLeft className="h-4 w-4 mr-1" /> Transfer
                    </Button>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => setSwapOpen(true)}
                      variant="secondary"
                    >
                      <Repeat className="h-4 w-4 mr-1" /> Swap user
                    </Button>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => setTermOpen(true)}
                      className="bg-warning text-warning-foreground hover:bg-warning/90"
                    >
                      <UserMinus className="h-4 w-4 mr-1" /> Terminate user
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/terminate/${locker.id}`, "_blank")}
                    >
                      Open in new tab
                    </Button>
                  </>
                )}
              </div>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              {isAdmin && (
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteLockerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        locker={{ id: locker.id, locker_number: locker.locker_number, location: locker.location }}
        onDeleted={() => { onUpdated?.(); onClose(); }}
      />
      <TerminateUserDialog
        open={termOpen}
        onOpenChange={setTermOpen}
        locker={locker}
        onTerminated={() => { onUpdated?.(); onClose(); }}
      />
      <TransferLockerDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        locker={locker}
        onTransferred={() => { onUpdated?.(); onClose(); }}
      />
      <SwapLockerDialog
        open={swapOpen}
        onOpenChange={setSwapOpen}
        locker={locker}
        onSwapped={() => { onUpdated?.(); onClose(); }}
      />
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear locker details?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the employee name, badge number, national ID, work location, batch intake, status, custom status, and remark for locker {locker.locker_number}. Location and Key Lock will be kept. Status will be set to empty.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearDetails} disabled={clearing}>
              {clearing ? "Clearing…" : "Clear details"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}

function DateField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  // Stored as ISO yyyy-mm-dd; displayed as dd/mm/yyyy.
  const isoToDisplay = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  const displayToIso = (s: string) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  };
  const [text, setText] = useState(isoToDisplay(value));
  useEffect(() => { setText(isoToDisplay(value)); }, [value]);
  return (
    <div>
      <Label>{label}</Label>
      <Input
        value={text}
        placeholder="dd/mm/yyyy"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(displayToIso(text))}
        disabled={disabled}
      />
    </div>
  );
}
function SelectField({ label, value, options, onChange, disabled }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o.replace(/_/g, " ")}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
