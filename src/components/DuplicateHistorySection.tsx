// Detection + cleanup surface for duplicate history entries: the same event
// (badge + name + status + date) recorded more than once for one locker,
// across locker_occupancy and terminations. Report + one-click de-dupe.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, History, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";
import { invalidateOccupancyCache } from "@/lib/occupancy-cache";

type EventRow = {
  id: string;
  source: "occupancy" | "termination";
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  national_id: string | null;
  status: string;
  date: string | null;
  remarks: string | null;
  created_at: string | null;
};

export type DupHistoryGroup = {
  key: string;
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  status: string;
  date: string | null;
  rows: EventRow[];
};

function norm(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isTerminate(status: string | null | undefined) {
  return /^\s*terminate/i.test(status ?? "");
}

// Completeness score — the row we keep should carry the most information.
function score(r: EventRow) {
  let s = 0;
  if ((r.employee_name ?? "").trim()) s += 2;
  if ((r.badge_number ?? "").trim()) s += 2;
  if ((r.national_id ?? "").trim()) s += 2;
  if ((r.date ?? "").trim()) s += 1;
  if ((r.remarks ?? "").trim()) s += 1;
  return s;
}

async function fetchAll<T>(
  table: "locker_occupancy" | "terminations",
  columns: string,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function buildHistoryDupGroups(events: EventRow[]): DupHistoryGroup[] {
  const map = new Map<string, EventRow[]>();
  for (const e of events) {
    const statusKey = isTerminate(e.status) ? "terminate" : norm(e.status);
    const key = [
      norm(e.locker_number),
      norm(e.badge_number),
      norm(e.employee_name),
      statusKey,
      (e.date ?? "").slice(0, 10),
    ].join("|");
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }

  const groups: DupHistoryGroup[] = [];
  for (const [key, rows] of map) {
    if (rows.length < 2) continue;
    // Ignore rows with no identifying data at all.
    if (!rows.some((r) => (r.employee_name ?? "").trim() || (r.badge_number ?? "").trim())) continue;
    const sorted = [...rows].sort(
      (a, b) => score(b) - score(a) || (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
    groups.push({
      key,
      locker_number: sorted[0].locker_number,
      employee_name: sorted.find((r) => r.employee_name)?.employee_name ?? null,
      badge_number: sorted.find((r) => r.badge_number)?.badge_number ?? null,
      status: isTerminate(sorted[0].status) ? "Terminate" : sorted[0].status,
      date: sorted.find((r) => r.date)?.date ?? null,
      rows: sorted,
    });
  }

  return groups.sort(
    (a, b) => b.rows.length - a.rows.length || a.locker_number.localeCompare(b.locker_number),
  );
}

export function DuplicateHistorySection({
  active,
  isAdmin,
  onViewHistory,
}: {
  active: boolean;
  isAdmin: boolean;
  onViewHistory?: (lockerNumber: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<DupHistoryGroup[]>([]);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<DupHistoryGroup | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [occ, term] = await Promise.all([
        fetchAll<{
          id: string;
          locker_number: string;
          employee_name: string | null;
          badge_number: string | null;
          national_id: string | null;
          status: string | null;
          termination_date: string | null;
          batch_intake_date: string | null;
          remarks: string | null;
          created_at: string | null;
        }>(
          "locker_occupancy",
          "id,locker_number,employee_name,badge_number,national_id,status,termination_date,batch_intake_date,remarks,created_at",
        ),
        fetchAll<{
          id: string;
          locker_number: string;
          employee_name: string | null;
          badge_number: string | null;
          termination_date: string | null;
          reason: string | null;
          created_at: string | null;
          undone_at: string | null;
        }>(
          "terminations",
          "id,locker_number,employee_name,badge_number,termination_date,reason,created_at,undone_at",
        ),
      ]);

      const events: EventRow[] = [];
      for (const r of occ) {
        const st = (r.status ?? "—").trim() || "—";
        events.push({
          id: r.id,
          source: "occupancy",
          locker_number: r.locker_number,
          employee_name: r.employee_name,
          badge_number: r.badge_number,
          national_id: r.national_id,
          status: st,
          date: st.toLowerCase() === "active" ? r.batch_intake_date : r.termination_date,
          remarks: r.remarks,
          created_at: r.created_at,
        });
      }
      for (const t of term) {
        if (t.undone_at) continue;
        events.push({
          id: t.id,
          source: "termination",
          locker_number: t.locker_number,
          employee_name: t.employee_name,
          badge_number: t.badge_number,
          national_id: null,
          status: "Terminate",
          date: t.termination_date,
          remarks: t.reason,
          created_at: t.created_at,
        });
      }

      setGroups(buildHistoryDupGroups(events));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !loaded && !loading) load();
  }, [active, loaded, loading, load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.locker_number.toLowerCase().includes(q) ||
        (g.employee_name ?? "").toLowerCase().includes(q) ||
        (g.badge_number ?? "").toLowerCase().includes(q),
    );
  }, [groups, search]);

  const totalDupRows = groups.reduce((n, g) => n + g.rows.length - 1, 0);

  // Remove the duplicate copies of one group, keeping rows[0].
  // NOTE: `terminations` has no DELETE policy (deletes silently affect 0 rows),
  // so duplicate termination rows are soft-removed by stamping undone_at —
  // the scanner and the history dialog both ignore undone rows.
  const removeGroup = async (
    g: DupHistoryGroup,
    user: { id?: string; email?: string | null },
  ) => {
    const [keep, ...drop] = g.rows;
    const occIds = drop.filter((r) => r.source === "occupancy").map((r) => r.id);
    const termIds = drop.filter((r) => r.source === "termination").map((r) => r.id);

    let removed = 0;

    if (occIds.length) {
      const { data, error } = await supabase
        .from("locker_occupancy")
        .delete()
        .in("id", occIds)
        .select("id");
      if (error) throw error;
      removed += data?.length ?? 0;
      if ((data?.length ?? 0) < occIds.length) {
        throw new Error("Some occupancy duplicates could not be removed (permission denied).");
      }
    }

    if (termIds.length) {
      const { data, error } = await supabase
        .from("terminations")
        .update({ undone_at: new Date().toISOString(), undone_by: user.id ?? null })
        .in("id", termIds)
        .is("undone_at", null)
        .select("id");
      if (error) throw error;
      removed += data?.length ?? 0;
      if ((data?.length ?? 0) < termIds.length) {
        throw new Error("Some termination duplicates could not be removed (permission denied).");
      }
    }

    if (drop.length) {
      await supabase.from("status_change_log").insert(
        drop.map((r) => ({
          locker_number: g.locker_number,
          previous_status: r.status,
          new_status: "(duplicate removed)",
          source:
            r.source === "occupancy"
              ? "duplicate_history_cleanup_occupancy"
              : "duplicate_history_cleanup_termination",
          changed_by: user.id ?? "",
          changed_by_email: user.email ?? null,
        })),
      );
    }

    return { removed, keep };
  };

  const autoRemove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { removed, keep } = await removeGroup(confirm, {
        id: u.user?.id,
        email: u.user?.email,
      });

      invalidateOccupancyCache();
      toast.success(
        `Removed ${removed} duplicate cop${removed === 1 ? "y" : "ies"} from ${confirm.locker_number}` +
          ` (kept the ${keep.source === "occupancy" ? "occupancy" : "termination"} record)`,
      );
      setConfirm(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    setConfirmAll(false);
    setBusy(true);
    setProgress({ done: 0, total: groups.length });
    let removed = 0;
    let failed = 0;
    try {
      const { data: u } = await supabase.auth.getUser();
      const user = { id: u.user?.id, email: u.user?.email };
      for (let i = 0; i < groups.length; i++) {
        try {
          const res = await removeGroup(groups[i], user);
          removed += res.removed;
        } catch {
          failed++;
        }
        setProgress({ done: i + 1, total: groups.length });
      }
      invalidateOccupancyCache();
      if (failed) {
        toast.warning(`Removed ${removed} duplicate rows; ${failed} group(s) could not be cleaned.`);
      } else {
        toast.success(`Removed ${removed} duplicate row${removed === 1 ? "" : "s"}.`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };


  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      <p className="text-xs text-muted-foreground">
        {loading
          ? "Scanning all occupancy and termination records…"
          : `${groups.length} locker${groups.length === 1 ? "" : "s"} have duplicate history entries (${totalDupRows} total duplicate row${totalDupRows === 1 ? "" : "s"}).`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search locker, name, or badge…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={load} disabled={loading || busy}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Rescan
        </Button>
        {isAdmin && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmAll(true)}
            disabled={loading || busy || groups.length === 0}
          >
            <Wand2 className="h-4 w-4 mr-1.5" />
            {progress ? `Removing ${progress.done}/${progress.total}…` : "Remove All Duplicates"}
          </Button>
        )}
      </div>


      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs break-words">{error}</AlertDescription>
          </Alert>
        )}

        {loading && [...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}

        {!loading && !error && visible.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            {groups.length === 0
              ? "No duplicate history entries found."
              : "No matches for this search."}
          </div>
        )}

        {!loading &&
          visible.map((g) => (
            <div key={g.key} className="rounded-lg border p-3 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-semibold">{g.locker_number}</span>
                  <Badge variant="secondary" className="text-[11px]">{g.status}</Badge>
                  <Badge variant="destructive" className="text-[11px]">{g.rows.length} copies</Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {g.employee_name ?? "—"}
                  {g.badge_number ? ` · #${g.badge_number}` : ""} · {formatDate(g.date ?? "") || "—"}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  From: {g.rows.map((r) => (r.source === "occupancy" ? "locker_occupancy" : "terminations")).join(", ")}
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                {onViewHistory && (
                  <Button size="sm" variant="outline" onClick={() => onViewHistory(g.locker_number)}>
                    <History className="h-3.5 w-3.5 mr-1" /> View history
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" onClick={() => setConfirm(g)}>
                    <Wand2 className="h-3.5 w-3.5 mr-1" /> Auto-remove duplicates
                  </Button>
                )}
              </div>
            </div>
          ))}
      </div>

      <Dialog open={!!confirm} onOpenChange={(v) => { if (!v && !busy) setConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" /> Remove duplicate copies
            </DialogTitle>
            <DialogDescription>
              {confirm
                ? `This will remove ${confirm.rows.length - 1} duplicate cop${confirm.rows.length - 1 === 1 ? "y" : "ies"}, keeping the original (most complete record) for locker ${confirm.locker_number}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {confirm && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div><span className="text-muted-foreground">Employee:</span> {confirm.employee_name ?? "—"}</div>
              <div><span className="text-muted-foreground">Badge:</span> <span className="font-mono">{confirm.badge_number ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Status:</span> {confirm.status}</div>
              <div><span className="text-muted-foreground">Date:</span> {formatDate(confirm.date ?? "") || "—"}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button onClick={autoRemove} disabled={busy}>{busy ? "Removing…" : "Remove duplicates"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
