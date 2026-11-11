// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Undo2, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { formatBatchIntake } from "@/lib/locker-utils";
import { restoreTerminationAdmin } from "@/lib/termination-actions";
import type { Database } from "@/integrations/supabase/types";

type Term = Database["public"]["Tables"]["terminations"]["Row"];

/** Start of yesterday, local time, as an ISO timestamp. */
function yesterdayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.toISOString();
}

/**
 * Admin-only: terminations logged yesterday or today, with the ability to
 * restore an occupant who was terminated by mistake.
 */
export function RecentTerminationsPanel() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";
  const [items, setItems] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!user || !isAdmin) return;
    let cancelled = false;
    supabase
      .from("terminations")
      .select("*")
      .gte("created_at", yesterdayStartIso())
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => { if (!cancelled) setItems(data ?? []); });
    return () => { cancelled = true; };
  }, [user, isAdmin, refresh]);

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

  if (!isAdmin) {
    return (
      <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" /> Admin access only.
      </Card>
    );
  }

  const todayKey = new Date().toDateString();

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        {items?.length.toLocaleString() ?? "…"} terminations from yesterday and today · admins can restore a wrongly terminated user
      </p>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, badge, locker, location…" className="pl-9" />
        </div>
      </Card>

      {!items ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">No terminations in the last two days.</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => {
            const isToday = new Date(t.created_at).toDateString() === todayKey;
            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{t.locker_number}</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-sm font-medium">{t.prior_employee_name ?? t.employee_name ?? "—"}</span>
                      {(t.prior_badge_number ?? t.badge_number) && (
                        <span className="text-xs text-muted-foreground">Badge {t.prior_badge_number ?? t.badge_number}</span>
                      )}
                      <Badge variant="outline" className="text-[10px]">{isToday ? "Today" : "Yesterday"}</Badge>
                      {t.undone_at && (
                        <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Restored
                        </Badge>
                      )}
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
                  {!t.undone_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === t.id || !t.locker_id}
                      onClick={async () => {
                        setBusyId(t.id);
                        try {
                          await restoreTerminationAdmin(t.id);
                          toast.success(`Restored ${t.prior_employee_name ?? t.employee_name ?? "user"} to ${t.locker_number}`);
                          setRefresh((k) => k + 1);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Restore failed");
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      <Undo2 className="h-4 w-4 mr-1" /> {busyId === t.id ? "Restoring…" : "Restore user"}
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
