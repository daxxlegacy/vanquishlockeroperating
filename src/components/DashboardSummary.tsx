// Admin/staff dashboard summary — live stat cards for key operational KPIs.
// Reuses count_occupancy_drift() RPC and simple head+count queries for
// support requests, pending identity claims, spare-key issues, and recent
// terminations. Polls every 3 minutes to match the Sync badge cadence.
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LifeBuoy,
  UserSearch,
  RefreshCw,
  KeyRound,
  UserMinus,
  RotateCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format-date";

type Tone = "attention" | "neutral";

type Stat = {
  key: string;
  label: string;
  hint: string;
  to: string;
  search?: Record<string, string>;
  icon: typeof LifeBuoy;
  value: number | null;
  tone: Tone;
};

const REFRESH_MS = 3 * 60 * 1000;

// Cast so TS doesn't complain about tables/columns not in generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

async function fetchCounts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [sup, claims, drift, spare, terms] = await Promise.all([
    sb.from("support_requests").select("*", { count: "exact", head: true }).in("status", ["new", "in_progress"]),
    sb.from("locker_identity_claims").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.rpc("count_occupancy_drift"),
    sb.from("lockers").select("*", { count: "exact", head: true }).in("spare_key_status", ["missing", "with_employee", "damaged"]),
    sb.from("terminations").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
  ]);

  const driftData = drift?.data as unknown;
  const driftVal =
    typeof driftData === "number"
      ? driftData
      : driftData && typeof driftData === "object" && "count" in (driftData as Record<string, unknown>)
        ? Number((driftData as Record<string, unknown>).count)
        : 0;

  return {
    support: sup?.count ?? 0,
    claims: claims?.count ?? 0,
    drift: Number.isFinite(driftVal) ? driftVal : 0,
    spareIssues: spare?.count ?? 0,
    recentTerms: terms?.count ?? 0,
  };
}

const TONE_STYLES: Record<Tone, { border: string; iconWrap: string; icon: string; number: string }> = {
  attention: {
    border: "border-destructive/40 hover:border-destructive",
    iconWrap: "bg-destructive/10",
    icon: "text-destructive",
    number: "text-destructive",
  },
  neutral: {
    border: "border-border hover:border-primary/50",
    iconWrap: "bg-primary/10",
    icon: "text-primary",
    number: "text-foreground",
  },
};

export function DashboardSummary() {
  const [counts, setCounts] = useState<{
    support: number; claims: number; drift: number; spareIssues: number; recentTerms: number;
  } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const c = await fetchCounts();
      setCounts(c);
      setUpdatedAt(new Date().toISOString());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const stats: Stat[] = [
    {
      key: "support",
      label: "Pending Support",
      hint: "New or in-progress tickets",
      to: "/support-requests",
      icon: LifeBuoy,
      value: counts?.support ?? null,
      tone: (counts?.support ?? 0) > 0 ? "attention" : "neutral",
    },
    {
      key: "claims",
      label: "Identity Claims",
      hint: "Awaiting admin review",
      to: "/admin",
      icon: UserSearch,
      value: counts?.claims ?? null,
      tone: (counts?.claims ?? 0) > 0 ? "attention" : "neutral",
    },
    {
      key: "drift",
      label: "Occupancy Drift",
      hint: "Lockers out of sync",
      to: "/occupancy",
      icon: RefreshCw,
      value: counts?.drift ?? null,
      tone: (counts?.drift ?? 0) > 0 ? "attention" : "neutral",
    },
    {
      key: "spare",
      label: "Spare Key Issues",
      hint: "Missing, with employee, or damaged",
      to: "/spare-keys",
      icon: KeyRound,
      value: counts?.spareIssues ?? null,
      tone: (counts?.spareIssues ?? 0) > 0 ? "attention" : "neutral",
    },
    {
      key: "terms",
      label: "Recent Terminations",
      hint: "Last 7 days",
      to: "/terminations",
      icon: UserMinus,
      value: counts?.recentTerms ?? null,
      tone: "neutral",
    },
  ];

  return (
    <section className="mb-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Dashboard</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Live operational summary. Click any card to jump to the full view.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {updatedAt ? `Last updated ${formatDateTime(updatedAt)}` : "Loading…"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={busy}
            aria-label="Refresh dashboard"
          >
            <RotateCw className={`h-4 w-4 mr-1.5 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        {stats.map((s) => {
          const styles = TONE_STYLES[s.tone];
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              to={s.to}
              className="block group"
              aria-label={`${s.label}: ${s.value ?? "…"}`}
            >
              <Card className={`p-4 h-full transition-colors ${styles.border} group-hover:shadow-sm`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className={`h-9 w-9 rounded-md grid place-items-center ${styles.iconWrap}`}>
                    <Icon className={`h-5 w-5 ${styles.icon}`} />
                  </div>
                </div>
                {s.value === null ? (
                  <Skeleton className="h-8 w-16 mb-1" />
                ) : (
                  <div className={`text-3xl font-bold tabular-nums leading-none ${styles.number}`}>
                    {s.value.toLocaleString()}
                  </div>
                )}
                <div className="mt-2 text-sm font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.hint}</div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
