import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMinus, ArrowLeft, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { syncTerminationToOccupancy } from "@/lib/occupancy-sync";
import type { Database } from "@/integrations/supabase/types";

type Locker = Database["public"]["Tables"]["lockers"]["Row"];

export const Route = createFileRoute("/terminate/$lockerId")({
  head: () => ({
    meta: [
      { title: "Terminate user — LockerOps" },
      { name: "description", content: "Confirm termination of a locker user with date and reason." },
    ],
  }),
  component: TerminatePage,
});

function TerminatePage() {
  const { lockerId } = useParams({ from: "/terminate/$lockerId" });
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [locker, setLocker] = useState<Locker | null | undefined>(undefined);

  const initialDateStr = (() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("date");
      const m = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const today = new Date();
    return `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  })();
  const [date, setDate] = useState(initialDateStr);
  const [reason, setReason] = useState("");
  const [newStatus, setNewStatus] = useState<"empty" | "cleaning" | "find_spare_key" | "repair" | "on_hold">("empty");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Strict dd/mm/yyyy validation with descriptive errors.
  const dateError = (() => {
    if (!date.trim()) return "Termination date is required";
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date.trim())) return "Format must be exactly dd/mm/yyyy (e.g. 05/05/2026)";
    const [dd, mm, yyyy] = date.trim().split("/").map((n) => parseInt(n, 10));
    if (mm < 1 || mm > 12) return `Month must be 01–12 (got ${String(mm).padStart(2, "0")})`;
    const daysInMonth = new Date(yyyy, mm, 0).getDate();
    if (dd < 1 || dd > daysInMonth) return `Day must be 01–${String(daysInMonth).padStart(2, "0")} for ${String(mm).padStart(2, "0")}/${yyyy}`;
    if (yyyy < 2000 || yyyy > 2100) return "Year must be between 2000 and 2100";
    const picked = new Date(yyyy, mm - 1, dd);
    const oneYearAhead = new Date(); oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);
    if (picked > oneYearAhead) return "Date can't be more than 1 year in the future";
    return null;
  })();
  const iso = !dateError ? (() => {
    const [dd, mm, yyyy] = date.trim().split("/");
    return `${yyyy}-${mm}-${dd}`;
  })() : null;

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user || !lockerId) return;
    supabase.from("lockers").select("*").eq("id", lockerId).maybeSingle().then(({ data }) => setLocker(data));
  }, [user, lockerId]);

  if (loading || !user || locker === undefined) {
    return <div className="min-h-screen"><AppHeader /><main className="max-w-2xl mx-auto px-6 py-8"><Skeleton className="h-96" /></main></div>;
  }

  if (!locker) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-2xl mx-auto px-6 py-8">
          <Card className="p-8 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive mb-3" />
            <h1 className="font-display text-xl font-bold">Locker not found</h1>
            <p className="text-muted-foreground text-sm mt-2">It may have been deleted.</p>
          </Card>
        </main>
      </div>
    );
  }

  const isAdmin = role === "admin";
  const canSubmit = !dateError && !busy && !!locker.employee_name && confirmText.trim() === locker.locker_number && isAdmin;

  const handleTerminate = async () => {
    if (!canSubmit || !iso) return;
    setBusy(true);
    try {
      const { error: e1 } = await supabase.from("terminations").insert({
        locker_id: locker.id,
        locker_number: locker.locker_number,
        location: locker.location,
        row_label: locker.row_label,
        employee_name: locker.employee_name,
        badge_number: locker.badge_number,
        termination_date: iso,
        reason: reason.trim() || null,
        terminated_by: user.id,
        terminated_by_email: user.email ?? null,
        prior_status: locker.status,
        prior_employee_name: locker.employee_name,
        prior_badge_number: locker.badge_number,
      });
      if (e1) throw e1;

      const updatePayload: { employee_name: null; badge_number: null; national_id: null; batch_intake: null; status: typeof newStatus; spare_key_status?: "missing" } =
        newStatus === "find_spare_key"
          ? { employee_name: null, badge_number: null, national_id: null, batch_intake: null, status: "find_spare_key", spare_key_status: "missing" }
          : { employee_name: null, badge_number: null, national_id: null, batch_intake: null, status: newStatus };
      const { error: e2 } = await supabase
        .from("lockers")
        .update(updatePayload)
        .eq("id", locker.id);
      if (e2) throw e2;

      await syncTerminationToOccupancy(locker, iso, reason.trim() || null);

      toast.success(`Terminated ${locker.employee_name} from ${locker.locker_number}`);
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Termination failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <Button variant="ghost" size="sm" onClick={() => window.close()} className="mb-3">
          <ArrowLeft className="h-4 w-4 mr-1" /> Close tab
        </Button>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-1">
            <UserMinus className="h-6 w-6 text-warning" />
            <h1 className="font-display text-2xl font-bold">Terminate user</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Review the details below, then confirm to release the user from this locker. The action is logged in the audit log.
          </p>

          <div className="grid grid-cols-2 gap-4 rounded-md border p-4 bg-muted/30 mb-4">
            <Detail label="Locker #" value={locker.locker_number} mono />
            <Detail label="Location" value={locker.location} />
            <Detail label="Row" value={locker.row_label ?? "—"} />
            <Detail label="Status">
              <Badge variant="outline">{locker.status}</Badge>
            </Detail>
            <Detail label="Employee" value={locker.employee_name ?? "—"} />
            <Detail label="Badge" value={locker.badge_number ?? "—"} mono />
          </div>

          {!locker.employee_name ? (
            <Card className="p-4 bg-muted/40 text-sm text-muted-foreground text-center">
              This locker has no assigned user — nothing to terminate.
            </Card>
          ) : done ? (
            <Card className="p-6 text-center bg-success/10 border-success">
              <div className="font-display text-lg font-bold text-success">User terminated</div>
              <p className="text-sm text-muted-foreground mt-1">Recorded in the termination log and audit trail.</p>
              <Button className="mt-4" onClick={() => window.close()}>Close tab</Button>
            </Card>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="td">Termination date (dd/mm/yyyy) *</Label>
                <Input
                  id="td"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`font-mono ${dateError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  placeholder="16/01/2026"
                  inputMode="numeric"
                  maxLength={10}
                  aria-invalid={!!dateError}
                />
                {dateError ? (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{dateError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Looks good — will save as {iso}.</p>
                )}
              </div>
              <div>
                <Label htmlFor="ts">Locker status after termination *</Label>
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as typeof newStatus)}>
                  <SelectTrigger id="ts"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empty">Empty (ready for next user)</SelectItem>
                    <SelectItem value="cleaning">Cleaning</SelectItem>
                    <SelectItem value="find_spare_key">Find spare key</SelectItem>
                    <SelectItem value="repair">Damage / Repair</SelectItem>
                    <SelectItem value="on_hold">On hold</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Choose what happens to the locker after the user is released.</p>
              </div>
              <div>
                <Label htmlFor="tr">Reason (optional)</Label>
                <Textarea id="tr" rows={3} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} />
              </div>
              <div>
                <Label htmlFor="tc">Type the locker number <span className="font-mono font-semibold">{locker.locker_number}</span> to confirm *</Label>
                <Input id="tc" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="font-mono" />
              </div>

              {!isAdmin && <p className="text-xs text-destructive">Only admins can terminate users.</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => window.close()} disabled={busy}>Cancel</Button>
                <Button
                  onClick={handleTerminate}
                  disabled={!canSubmit}
                  className="bg-warning text-warning-foreground hover:bg-warning/90"
                >
                  <UserMinus className="h-4 w-4 mr-1" />
                  {busy ? "Saving…" : "Confirm termination"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function Detail({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 ${mono ? "font-mono font-semibold" : "font-medium"}`}>
        {children ?? value}
      </div>
    </div>
  );
}
