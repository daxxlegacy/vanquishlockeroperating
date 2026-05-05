// Automation Run History — list every run + per-run rollback.
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { History, Undo2, Eye, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/automation-history")({
  head: () => ({ meta: [{ title: "Automation History — LockerOps" }] }),
  component: AutomationHistoryPage,
});

type Run = {
  id: string; task_type: string; filename: string | null;
  candidates_count: number; terminated_count: number; failed_count: number;
  dry_run: boolean; reason: string | null; termination_date: string | null;
  executed_by: string; executed_by_email: string | null;
  undone_at: string | null; undone_by: string | null; created_at: string;
};

function AutomationHistoryPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const refresh = async () => {
    const { data } = await supabase.from("automation_runs").select("*").order("created_at", { ascending: false }).limit(200);
    setRuns((data ?? []) as Run[]);
  };
  useEffect(() => { if (user) refresh(); }, [user]);

  const rollback = async (run: Run) => {
    if (!isAdmin || !user) return;
    if (!confirm(`Roll back run from ${new Date(run.created_at).toLocaleString()}? This will restore ${run.terminated_count} lockers.`)) return;
    setBusy(run.id);
    try {
      const { data: items, error } = await supabase
        .from("automation_run_items").select("*").eq("run_id", run.id).eq("succeeded", true);
      if (error) throw error;
      let restored = 0, failed = 0;
      for (const it of items ?? []) {
        try {
          if (it.locker_id) {
            const { error: e1 } = await supabase.from("lockers").update({
              employee_name: it.employee_name,
              badge_number: it.badge_number,
              status: (it.prior_status ?? "active") as "active",
            }).eq("id", it.locker_id);
            if (e1) throw e1;
          }
          if (it.termination_id) {
            await supabase.from("terminations").update({
              undone_at: new Date().toISOString(), undone_by: user.id,
            }).eq("id", it.termination_id);
          }
          restored++;
        } catch { failed++; }
      }
      await supabase.from("automation_runs").update({
        undone_at: new Date().toISOString(), undone_by: user.id,
      }).eq("id", run.id);
      toast.success(`Rollback complete — ${restored} restored, ${failed} failed.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rollback failed");
    }
    setBusy(null);
  };

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <History className="h-6 w-6 text-primary" />
            <h1 className="font-display text-3xl font-bold">Automation Run History</h1>
          </div>
          <Link to="/automation"><Button variant="outline">Back to Automation</Button></Link>
        </div>

        {!isAdmin && (
          <Alert className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>View only</AlertTitle>
            <AlertDescription>Only admins can roll back runs.</AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase">When</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase">File</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase">Mode</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase text-right">Candidates</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase text-right">Terminated</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase">By</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase">Status</th>
                  <th className="px-3 py-2.5 font-semibold text-xs uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No runs yet.</td></tr>
                )}
                {runs.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.filename ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.dry_run
                        ? <Badge variant="outline"><Eye className="h-3 w-3 mr-1" />Dry run</Badge>
                        : <Badge>Committed</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.candidates_count}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.terminated_count}
                      {r.failed_count > 0 && <span className="text-destructive ml-1">({r.failed_count} failed)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.executed_by_email ?? r.executed_by.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      {r.undone_at ? <Badge variant="secondary">Rolled back</Badge>
                        : r.dry_run ? <Badge variant="outline">—</Badge>
                        : <Badge variant="default">Active</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isAdmin && !r.dry_run && !r.undone_at && r.terminated_count > 0 && (
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => rollback(r)}>
                          <Undo2 className="h-3 w-3 mr-1" />
                          {busy === r.id ? "Rolling back…" : "Rollback"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
