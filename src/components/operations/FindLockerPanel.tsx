// Admin panel: shows a QR code linking to /find-locker plus recent lookup attempts.
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, RefreshCw, QrCode as QrIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Attempt = {
  id: string;
  ip_address: string | null;
  locker_number: string | null;
  success: boolean;
  attempted_at: string;
};

export function FindLockerPanel() {
  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/find-locker`;
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 }).catch(() => {});
  }, [url]);

  const loadAttempts = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("locker_lookup_attempts" as never)
      .select("id,ip_address,locker_number,success,attempted_at")
      .order("attempted_at", { ascending: false })
      .limit(50);
    setAttempts((data as unknown as Attempt[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAttempts(); }, []);

  const download = () => {
    const c = canvasRef.current; if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "find-locker-qr.png";
    a.click();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><QrIcon className="h-4 w-4" /> Find My Locker QR</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-center rounded-lg bg-white p-4">
            <canvas ref={canvasRef} />
          </div>
          <p className="text-xs text-muted-foreground break-all text-center">{url}</p>
          <Button variant="outline" size="sm" onClick={download} className="w-full">
            <Download className="h-4 w-4 mr-2" /> Download QR
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Recent lookup attempts</CardTitle>
          <Button variant="ghost" size="sm" onClick={loadAttempts} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Locker</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(attempts ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.attempted_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{a.locker_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{a.ip_address ?? "—"}</TableCell>
                    <TableCell>
                      {a.success
                        ? <Badge variant="default">Success</Badge>
                        : <Badge variant="secondary">No match</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {attempts && attempts.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No attempts yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
