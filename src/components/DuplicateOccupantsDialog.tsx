// Report tool: finds employees who appear as an Active occupant in more than
// one locker. Read-only report + manual per-locker actions — never auto-fixes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  StopCircle,
} from "lucide-react";
import { toast } from "sonner";
import { invalidateOccupancyCache, type OccCategory } from "@/lib/occupancy-cache";
import { OCC_CATEGORY_SHORT } from "@/lib/locker-category";
import { formatDate } from "@/lib/format-date";

const DEFAULT_REASON = "Resolved duplicate occupancy";

type DupRow = {
  id: string;
  category: string;
  locker_number: string;
  employee_name: string | null;
  badge_number: string | null;
  national_id: string | null;
  batch_intake_date: string | null;
  status: string | null;
  badge_key: string;
};

type Group = {
  badgeKey: string;
  badge: string;
  name: string;
  rows: DupRow[];
  bucket: "same" | "cross";
  nameMismatch: boolean;
  nidMismatch: boolean;
};

function norm(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function catLabel(c: string) {
  return OCC_CATEGORY_SHORT[c as OccCategory] ?? c;
}

function buildGroups(rows: DupRow[]): Group[] {
  const map = new Map<string, DupRow[]>();
  for (const r of rows) {
    const list = map.get(r.badge_key) ?? [];
    list.push(r);
    map.set(r.badge_key, list);
  }

  const groups: Group[] = [];
  for (const [badgeKey, list] of map) {
    if (list.length < 2) continue;
    const cats = new Set(list.map((r) => r.category));
    // Any category holding 2+ of this badge's active lockers is a hard error.
    const sameCategory = [...cats].some(
      (c) => list.filter((r) => r.category === c).length > 1,
    );
    const names = new Set(list.map((r) => norm(r.employee_name)).filter(Boolean));
    const nids = new Set(list.map((r) => norm(r.national_id)).filter(Boolean));
    groups.push({
      badgeKey,
      badge: list[0].badge_number?.trim() || badgeKey,
      name: list.find((r) => r.employee_name)?.employee_name ?? "—",
      rows: list,
      bucket: sameCategory ? "same" : "cross",
      nameMismatch: names.size > 1,
      nidMismatch: nids.size > 1,
    });
  }

  return groups.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === "same" ? -1 : 1;
    return a.badge.localeCompare(b.badge);
  });
}

export function DuplicateOccupantsDialog({
  open,
  onClose,
  isAdmin,
  onViewHistory,
}: {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onViewHistory?: (lockerNumber: string) => void;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState("occupants");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DupRow[]>([]);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<DupRow | null>(null);
  const [reason, setReason] = useState(DEFAULT_REASON);


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("find_duplicate_active_occupants");
    if (e) {
      setError(e.message);
      setRows([]);
    } else {
      setRows((data ?? []) as DupRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const groups = useMemo(() => buildGroups(rows), [rows]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.badge.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        g.rows.some((r) => r.locker_number.toLowerCase().includes(q)),
    );
  }, [groups, search]);

  const sameCount = groups.filter((g) => g.bucket === "same").length;
  const crossCount = groups.filter((g) => g.bucket === "cross").length;

  const terminate = async () => {
    if (!confirmRow || !user) return;
    setBusyId(confirmRow.id);
    try {
      const { error: e } = await supabase
        .from("locker_occupancy")
        .update({
          status: "Terminate",
          termination_date: new Date().toISOString().slice(0, 10),
          remarks: reason.trim() || DEFAULT_REASON,
        })
        .eq("id", confirmRow.id);
      if (e) throw e;

      await supabase.from("status_change_log").insert({
        locker_number: confirmRow.locker_number,
        previous_status: `${confirmRow.status ?? "—"} (${confirmRow.category})`,
        new_status: `Terminate (${confirmRow.category})`,
        source: "duplicate_occupancy_review",
        changed_by: user.id,
        changed_by_email: user.email ?? null,
      });

      invalidateOccupancyCache();
      toast.success(`Terminated ${confirmRow.locker_number}`);
      setConfirmRow(null);
      setReason(DEFAULT_REASON);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terminate failed");
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (g: Group) => {
    setBusyId(g.badgeKey);
    try {
      const { error: e } = await supabase.rpc("approve_multiple_locker_exception", {
        _badge_number: g.badge,
        _full_name: g.name === "—" ? g.badge : g.name,
        _locker_numbers: g.rows.map((r) => r.locker_number),
        _notes: `Approved via duplicate occupancy review (${g.bucket === "same" ? "same-category" : "cross-category"})`,
      });
      if (e) throw e;
      toast.success(`${g.badge} marked as a legitimate multiple-locker holder`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record exception");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Check Duplicates
            </DialogTitle>
            <DialogDescription>
              {loading
                ? "Scanning all active occupancy records…"
                : `${groups.length} employee${groups.length === 1 ? "" : "s"} with duplicate active lockers (${sameCount} same-category, ${crossCount} cross-category).`}
            </DialogDescription>
          </DialogHeader>

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

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs break-words">{error}</AlertDescription>
              </Alert>
            )}

            {loading && [...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}

            {!loading && !error && visible.length === 0 && (
              <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                {groups.length === 0
                  ? "No employee holds more than one active locker."
                  : "No matches for this search."}
              </div>
            )}

            {!loading &&
              visible.map((g) => {
                const same = g.bucket === "same";
                return (
                  <div
                    key={g.badgeKey}
                    className={`rounded-lg border p-3 space-y-2 ${
                      same ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{g.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          Badge {g.badge}
                          <button
                            type="button"
                            className="hover:text-foreground"
                            title="Copy badge number"
                            onClick={() => {
                              navigator.clipboard.writeText(g.badge);
                              toast.success("Badge number copied");
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          · {g.rows.length} active lockers
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {g.nameMismatch && (
                          <Badge variant="outline" className="border-destructive text-destructive text-[11px]">
                            Name mismatch
                          </Badge>
                        )}
                        {g.nidMismatch && (
                          <Badge variant="outline" className="border-destructive text-destructive text-[11px]">
                            National ID mismatch
                          </Badge>
                        )}
                        <Badge
                          className={
                            same
                              ? "bg-destructive text-destructive-foreground"
                              : "bg-amber-500 text-amber-950 hover:bg-amber-500"
                          }
                        >
                          {same ? "Duplicate" : "Cross-Category"}
                        </Badge>
                      </div>
                    </div>

                    {(g.nameMismatch || g.nidMismatch) && (
                      <p className="text-[11px] text-destructive">
                        Same badge number but differing identity details — likely a data-integrity issue rather than
                        one person with two lockers.
                      </p>
                    )}

                    <div className="rounded-md border bg-background/60 divide-y">
                      {g.rows.map((r) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm">
                          <span className="font-mono font-medium">{r.locker_number}</span>
                          <Badge variant="secondary" className="text-[11px]">{catLabel(r.category)}</Badge>
                          <span className="text-xs text-muted-foreground">
                            Intake: {r.batch_intake_date ? formatDate(r.batch_intake_date) : "—"}
                          </span>
                          {r.employee_name && norm(r.employee_name) !== norm(g.name) && (
                            <span className="text-xs text-destructive truncate">as “{r.employee_name}”</span>
                          )}
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto h-7 text-destructive hover:text-destructive"
                              disabled={busyId === r.id}
                              onClick={() => {
                                setReason(DEFAULT_REASON);
                                setConfirmRow(r);
                              }}
                            >
                              <StopCircle className="h-3.5 w-3.5 mr-1" /> Terminate this one
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {isAdmin && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === g.badgeKey}
                          onClick={() => approve(g)}
                        >
                          {busyId === g.badgeKey ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                          )}
                          This is legitimate, don’t flag again
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-[11px] text-muted-foreground text-left">
              Report only — nothing is terminated automatically. Choose which locker to keep yourself.
            </p>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRow} onOpenChange={(v) => !v && !busyId && setConfirmRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StopCircle className="h-5 w-5 text-destructive" /> Terminate {confirmRow?.locker_number}
            </DialogTitle>
            <DialogDescription>
              Marks only this occupancy record as terminated. The employee keeps their other locker(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRow(null)} disabled={!!busyId}>Cancel</Button>
            <Button variant="destructive" onClick={terminate} disabled={!!busyId}>
              {busyId ? "Applying…" : "Terminate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
