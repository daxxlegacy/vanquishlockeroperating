import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { invalidateOccupancyCache, type OccupancyRow, type OccCategory } from "@/lib/occupancy-cache";

interface EditProps {
  row: OccupancyRow | null;
  onClose: () => void;
}

const STATUS_OPTIONS = ["Active", "Terminate", "Vacant", "Empty", "Repair", "Unknown"];

export function EditOccupancyRowDialog({ row, onClose }: EditProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_name: "",
    badge_number: "",
    national_id: "",
    status: "",
    work_location: "",
    category: "main" as OccCategory,
    termination_date: "",
    remarks: "",
  });

  useEffect(() => {
    if (!row) return;
    setForm({
      employee_name: row.employee_name ?? "",
      badge_number: row.badge_number ?? "",
      national_id: row.national_id ?? "",
      status: row.status ?? "",
      work_location: row.work_location ?? "",
      category: row.category,
      termination_date: row.termination_date ? row.termination_date.slice(0, 10) : "",
      remarks: row.remarks ?? "",
    });
  }, [row]);

  if (!row) return null;

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const newStatus = form.status.trim();
      const isActive = newStatus.toLowerCase() === "active";

      // Proactive uniqueness check for Active rows
      if (isActive) {
        const { data: conflicts } = await supabase
          .from("locker_occupancy")
          .select("id, category, employee_name, badge_number")
          .eq("locker_number", row.locker_number)
          .ilike("status", "active")
          .neq("id", row.id);
        if (conflicts && conflicts.length > 0) {
          const c = conflicts[0];
          toast.error(`This locker already has an active occupant in ${c.category} — terminate or edit that row first.`, { duration: 8000 });
          setSaving(false);
          return;
        }
      }

      const payload = {
        employee_name: form.employee_name.trim() || null,
        badge_number: form.badge_number.trim() || null,
        national_id: form.national_id.trim() || null,
        status: newStatus || null,
        work_location: form.work_location.trim() || null,
        category: form.category,
        termination_date: form.termination_date || null,
        remarks: form.remarks.trim() || null,
      };

      const { error } = await supabase.from("locker_occupancy").update(payload).eq("id", row.id);
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          toast.error(`This locker already has an active occupant elsewhere — terminate or edit that row first.`);
        } else {
          toast.error(error.message);
        }
        setSaving(false);
        return;
      }

      // Audit log
      const prev = `${row.status ?? "—"} · ${row.employee_name ?? "—"} · ${row.badge_number ?? "—"} · ${row.category}`;
      const next = `${payload.status ?? "—"} · ${payload.employee_name ?? "—"} · ${payload.badge_number ?? "—"} · ${payload.category}`;
      await supabase.from("status_change_log").insert({
        locker_number: row.locker_number,
        previous_status: prev,
        new_status: next,
        source: "manual_edit",
        changed_by: user.id,
        changed_by_email: user.email ?? null,
      });

      invalidateOccupancyCache();
      toast.success(`Updated occupancy for ${row.locker_number}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" /> Edit occupancy — Locker {row.locker_number}
          </DialogTitle>
          <DialogDescription>Edits only this occupancy record. The Lockers page is not touched.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Employee Name">
            <Input value={form.employee_name} onChange={(e) => setForm((f) => ({ ...f, employee_name: e.target.value }))} />
          </Field>
          <Field label="Badge Number">
            <Input value={form.badge_number} onChange={(e) => setForm((f) => ({ ...f, badge_number: e.target.value }))} />
          </Field>
          <Field label="National ID">
            <Input value={form.national_id} onChange={(e) => setForm((f) => ({ ...f, national_id: e.target.value }))} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Work Location">
            <Input value={form.work_location} onChange={(e) => setForm((f) => ({ ...f, work_location: e.target.value }))} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as OccCategory }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="main">Full Lockers</SelectItem>
                <SelectItem value="staff">Staff Lockers</SelectItem>
                <SelectItem value="shoe">Shoe Lockers</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Termination Date">
            <Input type="date" value={form.termination_date} onChange={(e) => setForm((f) => ({ ...f, termination_date: e.target.value }))} />
          </Field>
          <Field label="Remarks" wide>
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
        </div>

        {form.status.toLowerCase() === "active" && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Only one Active row is allowed per locker across all categories. Save will be blocked if another active record exists.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

interface DeleteProps {
  row: OccupancyRow | null;
  onClose: () => void;
}

export function DeleteOccupancyRowDialog({ row, onClose }: DeleteProps) {
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);

  if (!row) return null;

  const confirm = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("locker_occupancy").delete().eq("id", row.id);
      if (error) { toast.error(error.message); setDeleting(false); return; }
      await supabase.from("status_change_log").insert({
        locker_number: row.locker_number,
        previous_status: row.status ?? "—",
        new_status: "(deleted)",
        source: "manual_delete",
        changed_by: user.id,
        changed_by_email: user.email ?? null,
      });
      invalidateOccupancyCache();
      toast.success(`Removed occupancy record for ${row.locker_number}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && !deleting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" /> Remove occupancy record?
          </DialogTitle>
          <DialogDescription>This cannot be undone. Only this history record is removed — the Lockers page is not affected.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <div><span className="text-muted-foreground">Locker:</span> <span className="font-mono font-semibold">{row.locker_number}</span></div>
          <div><span className="text-muted-foreground">Status:</span> {row.status ?? "—"}</div>
          <div><span className="text-muted-foreground">Employee:</span> {row.employee_name ?? "—"}</div>
          <div><span className="text-muted-foreground">Badge:</span> {row.badge_number ?? "—"}</div>
          <div><span className="text-muted-foreground">Category:</span> {row.category}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={deleting}>{deleting ? "Removing…" : "Remove record"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
