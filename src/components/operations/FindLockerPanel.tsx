// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Admin panel: shows a QR code linking to /find-locker plus recent lookup attempts.
import { useEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, QrCode as QrIcon } from "lucide-react";
import { LookupAttemptsCard } from "./LookupAttemptsCard";

export function FindLockerPanel() {
  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/find-locker`;
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 }).catch(() => {});
  }, [url]);

  const download = () => {
    const c = canvasRef.current; if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "find-locker-qr.png";
    a.click();
  };

  return (
    <div className="grid min-w-0 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><QrIcon className="h-4 w-4" /> Locker Inquiry QR</CardTitle>
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

      <LookupAttemptsCard />
    </div>
  );
}
