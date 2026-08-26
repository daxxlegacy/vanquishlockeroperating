// Admin panel: log of per-employee "Duplicate Locker Resolution" QR codes
// generated from the Check Duplicates tool, plus the matching submission and
// the Approve action that blocks the non-selected lockers for repair.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Clock,
  Copy,
  Hash,
  Loader2,
  QrCode as QrIcon,
  RefreshCw,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format-date";
import { DuplicateResolutionQrDialog, buildResolutionUrl } from "@/components/DuplicateResolutionQrDialog";

type LogRow = {
  id: string;
  created_at: string;
  badge_number: string;
  employee_name: string | null;
  locker_numbers: string[] | null;
  generated_by_email: string | null;
  resolved_at: string | null;
};

type ClaimRow = {
  id: string;
  created_at: string;
  badge_number: string;
  full_name: string;
  locker_number: string;
  other_locker_numbers: string[] | null;
  contact_number: string;
  status: "pending" | "approved" | "rejected";
};

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export function DuplicateResolutionPanel() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<LogRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [logRes, claimRes] = await Promise.all([
      sb
        .from("duplicate_resolution_requests")
        .select("id,created_at,badge_number,employee_name,locker_numbers,generated_by_email,resolved_at")
        .order("created_at", { ascending: false }),
      sb
        .from("locker_identity_claims")
        .select("id,created_at,badge_number,full_name,locker_number,other_locker_numbers,contact_number,status")
        .eq("claim_type", "multiple_locker")
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (logRes.error) {
      toast.error(logRes.error.message);
      setRows([]);
      return;
    }
    setRows((logRes.data ?? []) as LogRow[]);
    setClaims((claimRes.data ?? []) as ClaimRow[]);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("duplicate-resolution-panel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "duplicate_resolution_requests" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const claimFor = useCallback(
    (r: LogRow) =>
      claims.find(
        (c) => norm(c.badge_number) === norm(r.badge_number) && c.created_at >= r.created_at,
      ) ?? null,
    [claims],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.badge_number.toLowerCase().includes(q) ||
        (r.employee_name ?? "").toLowerCase().includes(q) ||
        (r.locker_numbers ?? []).some((l) => l.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const approve = async (claimId: string) => {
    setBusy(claimId);
    const { error } = await sb.rpc("approve_duplicate_resolution", { _claim_id: claimId });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Approved — other lockers marked for repair");
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this entry from the resolution log?")) return;
    const { error } = await sb.from("duplicate_resolution_requests").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
  };

  const pending = (rows ?? []).filter((r) => !r.resolved_at).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <QrIcon className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-bold">
            Duplicate Resolution
            {rows ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({rows.length} sent · {pending} pending)
              </span>
            ) : null}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search badge, name, locker…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-[220px]"
          />
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Generated from Occupancy → Check Duplicates → Duplicate Active Occupants. Approving a submission keeps the
        locker the employee selected and sets every other locker in their set to <strong>repair</strong>.
      </p>

      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : visible.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No resolution links generated yet.
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const claim = claimFor(r);
            const resolved = !!r.resolved_at || claim?.status === "approved";
            return (
              <Card key={r.id} className={`p-4 ${resolved ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.employee_name || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Hash className="h-3 w-3" /> {r.badge_number}
                      <button
                        type="button"
                        className="hover:text-foreground"
                        title="Copy link"
                        onClick={() => {
                          navigator.clipboard.writeText(buildResolutionUrl(r.badge_number));
                          toast.success("Link copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {resolved ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Resolved
                      </Badge>
                    ) : claim ? (
                      <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15">
                        Awaiting approval
                      </Badge>
                    ) : (
                      <Badge variant="outline">Pending response</Badge>
                    )}
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatDateTime(r.created_at)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Duplicate lockers:</span>
                  {(r.locker_numbers ?? []).map((l) => (
                    <Badge key={l} variant="secondary" className="font-mono text-[11px]">{l}</Badge>
                  ))}
                </div>

                {claim && (
                  <div className="mt-3 rounded-md border bg-muted/30 p-2.5 text-sm space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Employee selected:</span>
                      <Badge className="font-mono">{claim.locker_number}</Badge>
                      <span className="text-xs text-muted-foreground">To be blocked:</span>
                      {(claim.other_locker_numbers ?? [])
                        .filter((l) => l.toUpperCase() !== claim.locker_number.toUpperCase())
                        .map((l) => (
                          <Badge key={l} variant="outline" className="font-mono text-[11px]">{l}</Badge>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Submitted {formatDateTime(claim.created_at)} by {claim.full_name} · {claim.contact_number}
                    </p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setQrFor(r)}>
                    <QrIcon className="h-4 w-4 mr-1" /> View QR
                  </Button>
                  {claim && claim.status === "pending" && (
                    <Button size="sm" onClick={() => approve(claim.id)} disabled={busy === claim.id}>
                      {busy === claim.id ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 mr-1" />
                      )}
                      Approve &amp; block others
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove(r.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <DuplicateResolutionQrDialog
        open={!!qrFor}
        onClose={() => setQrFor(null)}
        badge={qrFor?.badge_number ?? ""}
        name={qrFor?.employee_name ?? null}
        lockerNumbers={qrFor?.locker_numbers ?? []}
      />
    </div>
  );
}
