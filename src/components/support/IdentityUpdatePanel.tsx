// Admin panel: QR code linking to /locker-identity-update plus a list of
// submitted identity claims. Independent from the Locker Inquiry QR.
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  RefreshCw,
  QrCode as QrIcon,
  ClipboardCheck,
  User,
  Hash,
  Phone,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format-date";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

type ClaimStatus = "pending" | "approved" | "rejected";
type Claim = {
  id: string;
  created_at: string;
  locker_number: string;
  badge_number: string;
  full_name: string;
  still_using: boolean | null;
  contact_number: string;
  status: ClaimStatus;
  reviewed_at: string | null;
  admin_notes: string | null;
};

const STATUS_STYLE: Record<ClaimStatus, string> = {
  pending: "bg-primary/15 text-primary border-primary/30",
  approved: "bg-success/15 text-success border-success/40",
  rejected: "bg-destructive/15 text-destructive border-destructive/40",
};

export function IdentityUpdatePanel() {
  const { user } = useAuth();
  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/locker-identity-update`;
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [rows, setRows] = useState<Claim[] | null>(null);
  const [filter, setFilter] = useState<ClaimStatus | "all">("pending");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 }).catch(() => {});
  }, [url]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (
              col: string,
              o: { ascending: boolean },
            ) => Promise<{ data: Claim[] | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .from("locker_identity_claims")
      .select("id,created_at,locker_number,badge_number,full_name,still_using,contact_number,status,reviewed_at,admin_notes")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    setRows(data ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("locker-identity-claims-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "locker_identity_claims" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return filter === "all" ? rows : rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: 0 };
    for (const r of rows ?? []) {
      c.all++;
      c[r.status]++;
    }
    return c;
  }, [rows]);

  const updateStatus = async (id: string, status: ClaimStatus) => {
    const patch: Record<string, unknown> = { status };
    if (status === "pending") {
      patch.reviewed_by = null;
      patch.reviewed_at = null;
    } else {
      patch.reviewed_by = user?.id ?? null;
      patch.reviewed_at = new Date().toISOString();
    }
    const { error } = await (
      supabase as unknown as {
        from: (t: string) => {
          update: (p: Record<string, unknown>) => {
            eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      }
    )
      .from("locker_identity_claims")
      .update(patch)
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(`Marked ${status}`);
  };

  const download = () => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "locker-identity-update-qr.png";
    a.click();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrIcon className="h-4 w-4" /> Locker Identity Update QR
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[auto,1fr] items-start">
          <div className="flex justify-center rounded-lg bg-white p-4">
            <canvas ref={canvasRef} />
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Print this QR on locker stickers to collect identity updates. Different from the Locker Inquiry QR.
            </p>
            <p className="text-xs text-muted-foreground break-all">{url}</p>
            <p className="text-xs text-muted-foreground">
              Tip: append <code className="font-mono">?locker=1411E</code> to pre-fill the locker number for a specific sticker.
            </p>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="h-4 w-4 mr-2" /> Download QR
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-bold">Identity Update Submissions</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as ClaimStatus | "all")}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="pending">Pending{counts.pending > 0 ? ` (${counts.pending})` : ""}</TabsTrigger>
          <TabsTrigger value="approved">Approved{counts.approved > 0 ? ` (${counts.approved})` : ""}</TabsTrigger>
          <TabsTrigger value="rejected">Rejected{counts.rejected > 0 ? ` (${counts.rejected})` : ""}</TabsTrigger>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No {filter === "all" ? "" : filter} submissions.</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <Badge variant="outline" className="font-mono">
                    <Hash className="h-3 w-3 mr-1" />
                    {r.locker_number}
                  </Badge>
                  <Badge variant="outline" className={STATUS_STYLE[r.status]}>
                    {r.status}
                  </Badge>
                  <Badge variant="outline">
                    {r.still_using ? "Still using" : r.still_using === false ? "No longer using" : "—"}
                  </Badge>
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
              <div className="mt-3 flex gap-2 flex-wrap justify-end">
                {r.status !== "approved" && (
                  <Button size="sm" onClick={() => updateStatus(r.id, "approved")}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                  </Button>
                )}
                {r.status !== "rejected" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "rejected")}>
                    <XCircle className="h-4 w-4 mr-1" /> Reject
                  </Button>
                )}
                {r.status !== "pending" && (
                  <Button size="sm" variant="ghost" onClick={() => updateStatus(r.id, "pending")}>
                    Reopen
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
