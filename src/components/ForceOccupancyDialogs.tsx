import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, PlayCircle, StopCircle } from "lucide-react";
import { toast } from "sonner";
import { invalidateOccupancyCache, type OccupancyRow } from "@/lib/occupancy-cache";

interface Props {
  row: OccupancyRow | null;
  onClose: () => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function logStatusChange(
  row: OccupancyRow,
  prev: string,
  next: string,
  source: string,
  userId: string,
  userEmail: string | null,
) {
  await supabase.from("status_change_log").insert({
    locker_number: row.locker_number,
    previous_status: prev,
    new_status: next,
    source,
    changed_by: userId,
    changed_by_email: userEmail,
  });
}

export function ForceTerminateDialog({ row, onClose }: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!row) return;
    setDate(row.termination_date ? row.termination_date.slice(0, 10) : todayIso());
    setReason(row.remarks ?? "");
  }, [row]);

  if (!row) return null;

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("locker_occupancy")
        .update({
          status: "Terminate",
          termination_date: date || todayIso(),
          remarks: reason.trim() || null,
        })
        .eq("id", row.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      await logStatusChange(
        row,
        `${row.status ?? "—"} (${row.category})`,
        `Terminate (${row.category}) · ${date}`,
        "manual_force_terminate",
        user.id,
        user.email ?? null,
      );
      invalidateOccupancyCache();
      toast.success(`Force-terminated ${row.locker_number}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Force terminate failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StopCircle className="h-5 w-5 text-destructive" /> Force Terminate — {row.locker_number}
          </DialogTitle>
          <DialogDescription>
            Manual override on this specific occupancy record. Does not sync back to the Lockers page.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            This bypasses the automated match with the Lockers page. Use only when the
            normal sync can't safely resolve this row.
          </AlertDescription>
        </Alert>

        <div className="space-y-3 py-1">
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <div><span className="text-muted-foreground">Employee:</span> {row.employee_name ?? "—"}</div>
            <div><span className="text-muted-foreground">Badge:</span> {row.badge_number ?? "—"}</div>
            <div><span className="text-muted-foreground">Category:</span> {row.category}</div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Termination Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this record being force-terminated?" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>{saving ? "Applying…" : "Force Terminate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Conflict = { id: string; category: string; employee_name: string | null; badge_number: string | null };

export function ForceActivateDialog({ row, onClose }: Props) {
  const { user } = useAuth();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [clearingConflict, setClearingConflict] = useState(false);

  useEffect(() => {
    if (!row) { setConflict(null); return; }
    setConflict(null);
    setChecking(true);
    (async () => {
      const { data } = await supabase
        .from("locker_occupancy")
        .select("id, category, employee_name, badge_number")
        .eq("locker_number", row.locker_number)
        .ilike("status", "active")
        .neq("id", row.id)
        .limit(1);
      setConflict(data && data.length > 0 ? (data[0] as Conflict) : null);
      setChecking(false);
    })();
  }, [row]);

  if (!row) return null;

  const clearConflict = async () => {
    if (!user || !conflict) return;
    setClearingConflict(true);
    try {
      const { error } = await supabase
        .from("locker_occupancy")
        .update({
          status: "Terminate",
          termination_date: todayIso(),
          remarks: `Auto-terminated to allow force-activation of another record for ${row.locker_number}`,
        })
        .eq("id", conflict.id);
      if (error) { toast.error(error.message); setClearingConflict(false); return; }
      await supabase.from("status_change_log").insert({
        locker_number: row.locker_number,
        previous_status: `Active (${conflict.category})`,
        new_status: `Terminate (${conflict.category})`,
        source: "manual_force_terminate",
        changed_by: user.id,
        changed_by_email: user.email ?? null,
      });
      invalidateOccupancyCache();
      toast.success(`Terminated conflicting record in ${conflict.category}`);
      setConflict(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear conflict");
    } finally {
      setClearingConflict(false);
    }
  };

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("locker_occupancy")
        .update({
          status: "Active",
          termination_date: null,
        })
        .eq("id", row.id);
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          toast.error("Another active record still exists for this locker. Terminate it first.");
        } else {
          toast.error(error.message);
        }
        setSaving(false);
        return;
      }
      await logStatusChange(
        row,
        `${row.status ?? "—"} (${row.category})`,
        `Active (${row.category})`,
        "manual_force_activate",
        user.id,
        user.email ?? null,
      );
      invalidateOccupancyCache();
      toast.success(`Force-activated ${row.locker_number}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Force activate failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && !saving && !clearingConflict && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" /> Force Activate — {row.locker_number}
          </DialogTitle>
          <DialogDescription>
            Manual override on this specific occupancy record. Does not sync back to the Lockers page.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            This bypasses the automated match with the Lockers page. Use only when the
            normal sync can't safely resolve this row.
          </AlertDescription>
        </Alert>

        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <div><span className="text-muted-foreground">Employee:</span> {row.employee_name ?? "—"}</div>
          <div><span className="text-muted-foreground">Badge:</span> {row.badge_number ?? "—"}</div>
          <div><span className="text-muted-foreground">Category:</span> {row.category}</div>
        </div>

        {checking ? (
          <div className="text-xs text-muted-foreground py-2">Checking for conflicts…</div>
        ) : conflict ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Active conflict detected</AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              <div>
                Locker <span className="font-mono font-semibold">{row.locker_number}</span> is already Active
                under <span className="font-semibold">{conflict.category}</span> for{" "}
                <span className="font-semibold">{conflict.employee_name ?? "—"}</span>
                {conflict.badge_number ? ` (#${conflict.badge_number})` : ""} — force-activating this
                row will fail unless that one is terminated first.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={clearConflict}
                disabled={clearingConflict}
              >
                {clearingConflict ? "Terminating…" : "Terminate that row now"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="text-xs text-muted-foreground">No conflicts found. Ready to force-activate this row.</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving || clearingConflict}>Cancel</Button>
          <Button onClick={submit} disabled={saving || checking || !!conflict}>
            {saving ? "Applying…" : "Force Activate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
