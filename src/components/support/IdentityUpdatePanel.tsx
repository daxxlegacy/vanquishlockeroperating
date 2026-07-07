// Admin panel: QR code linking to /locker-identity-update plus a list of
// submitted identity claims. Independent from the Locker Inquiry QR.
// View-only: no approve/reject workflow — admins consume submissions directly.
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
  ClipboardCheck,
  User,
  Hash,
  Phone,
  Clock,
  Check,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format-date";
import { toast } from "sonner";

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
};


export function IdentityUpdatePanel() {
  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/locker-identity-update`;
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [rows, setRows] = useState<Claim[] | null>(null);
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
      .select("id,created_at,locker_number,badge_number,full_name,still_using,contact_number,status")
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

  const download = () => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "locker-identity-update-qr.png";
    a.click();
  };

  const markDone = async (id: string) => {
    const { error } = await supabase
      .from("locker_identity_claims")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked as done");
    setRows((prev) => prev ? prev.map((r) => r.id === id ? { ...r, status: "approved" } : r) : prev);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this submission? This cannot be undone.")) return;
    const { error } = await supabase.from("locker_identity_claims").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Submission deleted");
    setRows((prev) => prev ? prev.filter((r) => r.id !== id) : prev);
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
          <h2 className="font-display text-xl font-bold">
            Identity Update Submissions
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
            return (
            <Card key={r.id} className={`p-4 ${done ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <Badge variant="outline" className="font-mono">
                    <Hash className="h-3 w-3 mr-1" />
                    {r.locker_number}
                  </Badge>
                  <Badge variant="outline">
                    {r.still_using ? "Still using" : r.still_using === false ? "No longer using" : "—"}
                  </Badge>
                  {done ? <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Done</Badge> : null}
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
                  <Button variant="outline" size="sm" onClick={() => markDone(r.id)}>
                    <Check className="h-4 w-4 mr-1" /> Mark as done
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => remove(r.id)} className="text-destructive hover:text-destructive">
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
