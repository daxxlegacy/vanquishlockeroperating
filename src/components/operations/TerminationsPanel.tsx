import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Undo2, Clock, CheckCircle2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { formatBatchIntake } from "@/lib/locker-utils";
import { undoTermination, TERMINATION_UNDO_WINDOW_MS } from "@/lib/termination-actions";
import type { Database } from "@/integrations/supabase/types";

type Term = Database["public"]["Tables"]["terminations"]["Row"];

export function TerminationsPanel() {
  const { user, role } = useAuth();
  const [items, setItems] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!user) return;
    supabase.from("terminations").select("*").order("created_at", { ascending: false }).limit(2000)
      .then(({ data }) => setItems(data ?? []));
  }, [user, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((t) =>
      t.employee_name?.toLowerCase().includes(s) ||
      t.badge_number?.toLowerCase().includes(s) ||
      t.locker_number.toLowerCase().includes(s) ||
      t.location?.toLowerCase().includes(s),
    );
  }, [items, q]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <UserMinus className="h-5 w-5" />
        <div>
          <h2 className="font-display text-xl font-bold">Terminations</h2>
          <p className="text-muted-foreground text-xs">{items?.length.toLocaleString() ?? "…"} records · restore within 15 min</p>
        </div>
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, badge, locker, location…" className="pl-9" />
        </div>
      </Card>

      {!items ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No terminations match.</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => {
            const ageMs = now - new Date(t.created_at).getTime();
            const remainingMs = TERMINATION_UNDO_WINDOW_MS - ageMs;
            const restorable = !t.undone_at && remainingMs > 0 && !!t.locker_id;
            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{t.locker_number}</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-sm font-medium">{t.employee_name ?? "—"}</span>
                      {t.badge_number && <span className="text-xs text-muted-foreground">Badge {t.badge_number}</span>}
                      {t.undone_at ? (
                        <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Restored
                        </Badge>
                      ) : restorable ? (
                        <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/40 gap-1">
                          <Clock className="h-3 w-3" /> {Math.ceil(remainingMs / 60_000)} min left
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm mt-2"><span className="text-muted-foreground">Reason:</span> {t.reason ?? "—"}</p>
                    <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>Termination date: <span className="font-medium text-foreground">{formatBatchIntake(t.termination_date)}</span></span>
                      <span>By: {t.terminated_by_email ?? t.terminated_by.slice(0, 8)}</span>
                      <span>Logged: {new Date(t.created_at).toLocaleString()}</span>
                      <span>Location: {t.location ?? "—"}</span>
                      {t.row_label && <span>Row: {t.row_label}</span>}
                    </div>
                  </div>
                  {role === "admin" && restorable && (
                    <Button variant="outline" size="sm" onClick={async () => {
                      try {
                        await undoTermination(t.id);
                        toast.success(`Restored ${t.employee_name ?? "user"} to ${t.locker_number}`);
                        setRefresh((k) => k + 1);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Restore failed");
                      }
                    }}>
                      <Undo2 className="h-4 w-4 mr-1" /> Restore user
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
