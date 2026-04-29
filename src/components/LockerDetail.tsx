import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

interface Props {
  lockerId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const STATUSES = ["active", "empty", "repair", "unknown"] as const;
const KEYS = ["available", "missing", "with_employee", "damaged", "unknown"] as const;

export function LockerDetail({ lockerId, open, onClose, onUpdated }: Props) {
  const { role } = useAuth();
  const [locker, setLocker] = useState<Locker | null>(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!lockerId || !open) return;
    supabase.from("lockers").select("*").eq("id", lockerId).single().then(({ data }) => {
      setLocker(data);
    });
  }, [lockerId, open]);

  if (!locker) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent><DialogHeader><DialogTitle>Loading…</DialogTitle></DialogHeader></DialogContent>
      </Dialog>
    );
  }

  const update = (k: keyof Locker, v: string | null) => setLocker({ ...locker, [k]: v });

  const handleSave = async () => {
    if (!isAdmin) return;
    setSaving(true);
    const { error } = await supabase
      .from("lockers")
      .update({
        unit_type: locker.unit_type,
        key_lock: locker.key_lock,
        location: locker.location,
        row_label: locker.row_label,
        badge_number: locker.badge_number,
        employee_name: locker.employee_name,
        status: locker.status,
        physical_key_status: locker.physical_key_status,
        spare_key_status: locker.spare_key_status,
        remark: locker.remark,
        batch_intake: locker.batch_intake,
      })
      .eq("id", locker.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Locker updated");
      onUpdated?.();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Locker {locker.locker_number}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <Field label="Location" value={locker.location} onChange={(v) => update("location", v)} disabled={!isAdmin} />
          <Field label="Row" value={locker.row_label ?? ""} onChange={(v) => update("row_label", v)} disabled={!isAdmin} />
          <Field label="Unit Type" value={locker.unit_type ?? ""} onChange={(v) => update("unit_type", v)} disabled={!isAdmin} />
          <Field label="Key Lock" value={locker.key_lock ?? ""} onChange={(v) => update("key_lock", v)} disabled={!isAdmin} />
          <Field label="Badge Number" value={locker.badge_number ?? ""} onChange={(v) => update("badge_number", v)} disabled={!isAdmin} />
          <Field label="Employee Name" value={locker.employee_name ?? ""} onChange={(v) => update("employee_name", v)} disabled={!isAdmin} />
          <SelectField label="Status" value={locker.status} options={STATUSES} onChange={(v) => update("status", v)} disabled={!isAdmin} />
          <Field label="Batch Intake" value={locker.batch_intake ?? ""} onChange={(v) => update("batch_intake", v)} disabled={!isAdmin} />
          <SelectField label="Physical Key" value={locker.physical_key_status ?? "unknown"} options={KEYS} onChange={(v) => update("physical_key_status", v)} disabled={!isAdmin} />
          <SelectField label="Spare Key" value={locker.spare_key_status ?? "unknown"} options={KEYS} onChange={(v) => update("spare_key_status", v)} disabled={!isAdmin} />
          <div className="col-span-2">
            <Label>Remark</Label>
            <Textarea
              value={locker.remark ?? ""}
              onChange={(e) => update("remark", e.target.value)}
              disabled={!isAdmin}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {isAdmin ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={saving}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete locker {locker.locker_number}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this locker record from the database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      setSaving(true);
                      const { error } = await supabase.from("lockers").delete().eq("id", locker.id);
                      setSaving(false);
                      if (error) toast.error(error.message);
                      else {
                        toast.success(`Locker ${locker.locker_number} deleted`);
                        onUpdated?.();
                        onClose();
                      }
                    }}
                  >
                    Delete locker
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
