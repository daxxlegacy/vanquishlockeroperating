import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Undo2, CheckCircle2, Clock, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { undoDeletion, UNDO_WINDOW_MS } from "@/lib/delete-actions";
import { formatBatchIntake } from "@/lib/locker-utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Database } from "@/integrations/supabase/types";

type Audit = Database["public"]["Tables"]["deletion_audit"]["Row"];
type Term = Database["public"]["Tables"]["terminations"]["Row"];

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — LockerOps" },
      { name: "description", content: "Every locker deletion with who, when, and why. Restore within 15 minutes." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Audit[] | null>(null);
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("deletion_audit").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setItems(data ?? []));
    supabase.from("terminations").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setTerms(data ?? []));
  }, [user, refresh]);

  // tick every 10s so the "time left" countdown updates
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  if (loading || !user) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <History className="h-6 w-6" />
          <div>
            <h1 className="font-display text-3xl font-bold">Audit Log</h1>
            <p className="text-muted-foreground text-sm">Deletions and terminations. Deletions can be restored within 15 minutes.</p>
          </div>
        </div>

        <Tabs defaultValue="deletions">
          <TabsList>
            <TabsTrigger value="deletions">Deletions ({items?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="terminations">Terminations ({terms?.length ?? 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="deletions" className="mt-4">
        {/* deletions block start */}

        {!items ? (
          <Skeleton className="h-96 w-full" />
        ) : items.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">No deletions yet.</Card>
        ) : (
          <div className="space-y-3">
            {items.map((a) => {
              const ageMs = now - new Date(a.created_at).getTime();
              const remainingMs = UNDO_WINDOW_MS - ageMs;
              const restorable = !a.undone_at && remainingMs > 0;
              return (
                <Card key={a.id} className="p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={a.deletion_kind === "location" ? "destructive" : "outline"} className="capitalize">
                          {a.deletion_kind}
                        </Badge>
                        {a.deletion_kind === "locker" ? (
                          <span className="font-mono font-semibold">{a.locker_number}</span>
                        ) : (
                          <span className="font-semibold">{a.location}</span>
                        )}
                        <span className="text-muted-foreground text-sm">·</span>
                        <span className="text-sm text-muted-foreground">{a.affected_count} locker{a.affected_count === 1 ? "" : "s"}</span>
                        {a.undone_at ? (
                          <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Restored
                          </Badge>
                        ) : restorable ? (
                          <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/40 gap-1">
                            <Clock className="h-3 w-3" /> {Math.ceil(remainingMs / 60_000)} min left
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Window closed</Badge>
                        )}
                      </div>
                      <p className="text-sm mt-2"><span className="text-muted-foreground">Reason:</span> {a.reason}</p>
                      <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>By: {a.deleted_by_email ?? a.deleted_by.slice(0, 8)}</span>
                        <span>When: {new Date(a.created_at).toLocaleString()}</span>
                        <span>Location: {a.location}</span>
                      </div>
                      {a.deletion_kind === "location" && a.affected_locker_numbers && a.affected_locker_numbers.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Show affected lockers ({a.affected_locker_numbers.length})
                          </summary>
                          <ScrollArea className="h-32 mt-2 rounded border p-2">
                            <div className="flex flex-wrap gap-1">
                              {a.affected_locker_numbers.map((n) => (
                                <span key={n} className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted border">{n}</span>
                              ))}
                            </div>
                          </ScrollArea>
                        </details>
                      )}
                    </div>
                    {role === "admin" && restorable && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const c = await undoDeletion(a.id);
                            toast.success(`Restored ${c} locker${c === 1 ? "" : "s"}`);
                            setRefresh((k) => k + 1);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Restore failed");
                          }
                        }}
                      >
                        <Undo2 className="h-4 w-4 mr-1" /> Restore
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          </TabsContent>
          <TabsContent value="terminations" className="mt-4">
            {!terms ? (
              <Skeleton className="h-96 w-full" />
            ) : terms.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">No terminations yet.</Card>
            ) : (
              <div className="space-y-3">
                {terms.map((t) => (
                  <Card key={t.id} className="p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/40 gap-1">
                        <UserMinus className="h-3 w-3" /> Termination
                      </Badge>
                      <span className="font-mono font-semibold">{t.locker_number}</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-sm font-medium">{t.employee_name ?? "—"}</span>
                      {t.badge_number && <span className="text-xs text-muted-foreground">Badge {t.badge_number}</span>}
                    </div>
                    <p className="text-sm mt-2">
                      <span className="text-muted-foreground">Reason:</span> {t.reason ?? "—"}
                    </p>
                    <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>Termination date: <span className="font-medium text-foreground">{formatBatchIntake(t.termination_date)}</span></span>
                      <span>By: {t.terminated_by_email ?? t.terminated_by.slice(0, 8)}</span>
                      <span>Logged: {new Date(t.created_at).toLocaleString()}</span>
                      <span>Location: {t.location ?? "—"}</span>
                      {t.row_label && <span>Row: {t.row_label}</span>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
