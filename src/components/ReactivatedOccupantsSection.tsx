// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Read-only report: employees with a Terminate event followed by a later Active
// event (same locker = likely re-issue, different locker = reassignment).
// Purely for review — no fix actions, since a legitimate rehire looks identical
// in the data to a bug.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, History, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/format-date";

type Ev = {
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  status: "Active" | "Terminate";
  date: string | null;
  created_at: string | null;
};

export type ReactivationRow = {
  key: string;
  badge: string;
  name: string;
  fromLocker: string;
  fromDate: string | null;
  toLocker: string;
  toDate: string | null;
  bucket: "same" | "different";
};

function norm(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isTerminate(status: string | null | undefined) {
  return /^\s*terminate/i.test(status ?? "");
}

function sortKey(e: Ev) {
  return `${(e.date ?? "").slice(0, 10) || "0000-00-00"}T${e.created_at ?? ""}`;
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

export function buildReactivations(events: Ev[]): ReactivationRow[] {
  const byBadge = new Map<string, Ev[]>();
  for (const e of events) {
    const badge = norm(e.badge_number);
    if (!badge) continue;
    if (!e.date) continue;
    const list = byBadge.get(badge) ?? [];
    list.push(e);
    byBadge.set(badge, list);
  }

  const rows: ReactivationRow[] = [];
  for (const [badge, list] of byBadge) {
    const sorted = [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    // Find the last Terminate that has a strictly later Active after it.
    let lastTerm: Ev | null = null;
    let reactivation: { term: Ev; act: Ev } | null = null;
    for (const e of sorted) {
      if (e.status === "Terminate") {
        lastTerm = e;
      } else if (lastTerm && sortKey(e) > sortKey(lastTerm)) {
        reactivation = { term: lastTerm, act: e };
      }
    }
    if (!reactivation) continue;
    const { term, act } = reactivation;
    const same = norm(term.locker_number) === norm(act.locker_number);
    rows.push({
      key: badge,
      badge: (term.badge_number ?? act.badge_number ?? badge).trim(),
      name: act.employee_name?.trim() || term.employee_name?.trim() || "—",
      fromLocker: term.locker_number,
      fromDate: term.date,
      toLocker: act.locker_number,
      toDate: act.date,
      bucket: same ? "same" : "different",
    });
  }

  return rows.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === "different" ? -1 : 1;
    return (b.toDate ?? "").localeCompare(a.toDate ?? "");
  });
}

export function ReactivatedOccupantsSection({
  active,
  onViewHistory,
}: {
  active: boolean;
  onViewHistory?: (lockerNumber: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReactivationRow[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [occ, term] = await Promise.all([
        fetchAll<{
          locker_number: string;
          employee_name: string | null;
          badge_number: string | null;
          status: string | null;
          termination_date: string | null;
          batch_intake_date: string | null;
          created_at: string | null;
        }>(
          "locker_occupancy",
          "locker_number,employee_name,badge_number,status,termination_date,batch_intake_date,created_at",
        ),
        fetchAll<{
          locker_number: string;
          employee_name: string | null;
          badge_number: string | null;
          termination_date: string | null;
          created_at: string | null;
          undone_at: string | null;
        }>(
          "terminations",
          "locker_number,employee_name,badge_number,termination_date,created_at,undone_at",
        ),
      ]);

      const events: Ev[] = [];
      for (const r of occ) {
        const st = (r.status ?? "").trim();
        if (st.toLowerCase() === "active") {
          events.push({
            locker_number: r.locker_number,
            employee_name: r.employee_name,
            badge_number: r.badge_number,
            status: "Active",
            date: r.batch_intake_date,
            created_at: r.created_at,
          });
        } else if (isTerminate(st)) {
          events.push({
            locker_number: r.locker_number,
            employee_name: r.employee_name,
            badge_number: r.badge_number,
            status: "Terminate",
            date: r.termination_date,
            created_at: r.created_at,
          });
        }
      }
      for (const t of term) {
        if (t.undone_at) continue;
        events.push({
          locker_number: t.locker_number,
          employee_name: t.employee_name,
          badge_number: t.badge_number,
          status: "Terminate",
          date: t.termination_date,
          created_at: t.created_at,
        });
      }

      setRows(buildReactivations(events));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !loaded && !loading) load();
  }, [active, loaded, loading, load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.badge.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.fromLocker.toLowerCase().includes(q) ||
        r.toLocker.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const sameCount = rows.filter((r) => r.bucket === "same").length;
  const diffCount = rows.length - sameCount;

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      <p className="text-xs text-muted-foreground">
        {loading
          ? "Scanning termination and activation history…"
          : `${rows.length} employee${rows.length === 1 ? "" : "s"} terminated and later reactivated (${sameCount} same locker, ${diffCount} different locker).`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search badge, name, or locker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Rescan
        </Button>
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
            {rows.length === 0
              ? "No employee was terminated and later reactivated."
              : "No matches for this search."}
          </div>
        )}

        {!loading &&
          visible.map((r) => {
            const diff = r.bucket === "different";
            return (
              <div
                key={r.key}
                className={`rounded-lg border p-3 space-y-2 ${
                  diff ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/30"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground">Badge {r.badge}</div>
                  </div>
                  <Badge
                    className={
                      diff
                        ? "bg-amber-500 text-amber-950 hover:bg-amber-500"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary"
                    }
                  >
                    {diff ? "Different Locker" : "Same Locker"}
                  </Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <div className="rounded-md border bg-background/60 px-2.5 py-2">
                    <div className="text-[11px] uppercase text-muted-foreground">Terminated on</div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{r.fromLocker}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.fromDate ? formatDate(r.fromDate) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-md border bg-background/60 px-2.5 py-2">
                    <div className="text-[11px] uppercase text-muted-foreground">Reactivated on</div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{r.toLocker}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.toDate ? formatDate(r.toDate) : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {onViewHistory && (
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => onViewHistory(r.toLocker)}
                    >
                      <History className="h-3.5 w-3.5 mr-1" /> View history
                      {diff ? ` (${r.toLocker})` : ""}
                    </Button>
                    {diff && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => onViewHistory(r.fromLocker)}
                      >
                        <History className="h-3.5 w-3.5 mr-1" /> {r.fromLocker}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
