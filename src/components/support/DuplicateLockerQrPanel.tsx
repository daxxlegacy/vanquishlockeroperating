// Admin panel: QR code for the public "Duplicate Locker" notice poster.
// Points at /locker-identity-update?type=multiple_locker&source=duplicate_notice
// so approval releases the non-selected lockers to 'repair' (not 'empty').
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  RefreshCw,
  QrCode as QrIcon,
  CopyCheck,
  User,
  Hash,
  Phone,
  Clock,
  Check,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format-date";
import { toast } from "sonner";

type Claim = {
  id: string;
  created_at: string;
  locker_number: string;
  other_locker_numbers: string[] | null;
  badge_number: string;
  full_name: string;
  contact_number: string;
  status: "pending" | "approved" | "rejected";
};

export function DuplicateLockerQrPanel() {
  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/locker-identity-update?type=multiple_locker&source=duplicate_notice`;
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rows, setRows] = useState<Claim[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 }).catch(() => {});
  }, [url]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("locker_identity_claims")
      .select(
        "id,created_at,locker_number,other_locker_numbers,badge_number,full_name,contact_number,status,source",
      )
      .eq("source", "duplicate_notice")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Claim[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("duplicate-locker-claims")
      .on("postgres_changes", { event: "*", schema: "public", table: "locker_identity_claims" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const download = () => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "duplicate-locker-qr.png";
    a.click();
  };

  const approve = async (r: Claim) => {
    const others = (r.other_locker_numbers ?? []).filter((x) => x && x.toUpperCase() !== r.locker_number.toUpperCase());
    if (
      !confirm(
        `Keep ${r.locker_number} for ${r.full_name}.\n\nThese lockers will be set to REPAIR and blocked:\n${others.join(", ") || "(none)"}\n\nContinue?`,
      )
    )
      return;
    setBusy(r.id);
    const { data, error } = await supabase.rpc("approve_duplicate_resolution", { _claim_id: r.id });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const blocked = (data as { blocked?: string[] } | null)?.blocked ?? [];
    toast.success(
      blocked.length ? `Kept ${r.locker_number}; blocked for repair: ${blocked.join(", ")}` : `Kept ${r.locker_number}`,
    );
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this submission? This cannot be undone.")) return;
    const { error } = await supabase.from("locker_identity_claims").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrIcon className="h-4 w-4" /> Duplicate Locker QR
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[auto,1fr] items-start">
          <div className="flex justify-center rounded-lg bg-white p-4">
            <canvas ref={canvasRef} />
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Post this QR generally. Employees who know they hold more than one locker scan it, pick the locker they
              actually use, and list the rest. On approval the other lockers are set to <strong>repair</strong> and
              blocked pending a check.
            </p>
            <p className="text-xs text-muted-foreground break-all">{url}</p>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="h-4 w-4 mr-2" /> Download QR
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CopyCheck className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-bold">
            Duplicate Locker Submissions
            {rows ? <span className="ml-2 text-sm font-normal text-muted-foreground">({rows.length})</span> : null}
          </h2>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No submissions yet.</Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const done = r.status === "approved";
            const others = (r.other_locker_numbers ?? []).filter(
              (x) => x && x.toUpperCase() !== r.locker_number.toUpperCase(),
            );
            return (
              <Card key={r.id} className={`p-4 ${done ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/10 font-mono">
                      Keeping {r.locker_number}
                    </Badge>
                    {others.map((o) => (
                      <Badge key={o} variant="outline" className="font-mono">
                        <ShieldAlert className="h-3 w-3 mr-1" />
                        {o}
                      </Badge>
                    ))}
                    {done ? <Badge variant="secondary">Approved</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatDateTime(r.created_at)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" /> {r.full_name}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" /> {r.badge_number}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" /> {r.contact_number}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  {!done && (
                    <Button size="sm" onClick={() => approve(r)} disabled={busy === r.id}>
                      <Check className="h-4 w-4 mr-1" /> Approve &amp; block others
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(r.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
