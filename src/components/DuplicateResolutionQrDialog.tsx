// Per-employee "Duplicate Locker Resolution" QR: links to the existing
// /locker-identity-update form with the badge number pre-filled and the
// multiple-locker resolution wording enabled.
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Download, QrCode as QrIcon } from "lucide-react";
import { toast } from "sonner";

export function buildResolutionUrl(badge: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/locker-identity-update?type=multiple_locker&badge=${encodeURIComponent(badge)}`;
}

export function DuplicateResolutionQrDialog({
  open,
  onClose,
  badge,
  name,
  lockerNumbers,
}: {
  open: boolean;
  onClose: () => void;
  badge: string;
  name?: string | null;
  lockerNumbers: string[];
}) {
  const url = useMemo(() => (badge ? buildResolutionUrl(badge) : ""), [badge]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!open || !url) return;
    const t = window.setTimeout(() => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 })
        .then(() => setReady(true))
        .catch(() => {});
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, url]);

  const download = () => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `duplicate-resolution-${badge.replace(/[^\w-]+/g, "_")}.png`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrIcon className="h-5 w-5 text-primary" /> Duplicate Resolution QR
          </DialogTitle>
          <DialogDescription>
            Send or print this QR for {name || badge}. The form opens with their badge number pre-filled and asks
            which locker they are currently using.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center rounded-lg bg-white p-4">
          <canvas ref={canvasRef} />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Lockers in question:</span>
            {lockerNumbers.map((l) => (
              <Badge key={l} variant="secondary" className="font-mono text-[11px]">{l}</Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground break-all">{url}</p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(url);
              toast.success("Link copied");
            }}
          >
            <Copy className="h-4 w-4 mr-1.5" /> Copy link
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={download} disabled={!ready}>
              <Download className="h-4 w-4 mr-1.5" /> Download QR
            </Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
