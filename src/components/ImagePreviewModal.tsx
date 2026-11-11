// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Shared full-screen image lightbox used across the app (support ticket
// composer preview, admin conversation thread, public ticket view, and any
// future places that show image attachments).
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImagePreviewItem = {
  /** Already-resolved URL (e.g. object URL for a local File). */
  url?: string;
  /** Resolver to fetch a fresh signed URL on open. Preferred for remote images. */
  sign?: () => Promise<string>;
  /** Optional alt text for the image. */
  alt?: string;
  /** Optional stable key. */
  key?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ImagePreviewItem[];
  index: number;
  onIndexChange: (index: number) => void;
};

export function ImagePreviewModal({ open, onOpenChange, items, index, onIndexChange }: Props) {
  const item = items[index];
  const [resolvedUrl, setResolvedUrl] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setResolvedUrl(null);
    setLoaded(false);
    setError(null);
    (async () => {
      try {
        const url = item.url ?? (item.sign ? await item.sign() : null);
        if (cancelled) return;
        if (!url) setError("Image unavailable");
        else setResolvedUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Image unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, index, item]);

  const canNav = items.length > 1;
  const prev = React.useCallback(() => {
    if (!canNav) return;
    onIndexChange((index - 1 + items.length) % items.length);
  }, [canNav, index, items.length, onIndexChange]);
  const next = React.useCallback(() => {
    if (!canNav) return;
    onIndexChange((index + 1) % items.length);
  }, [canNav, index, items.length, onIndexChange]);

  React.useEffect(() => {
    if (!open || !canNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canNav, prev, next]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">Image preview</DialogPrimitive.Title>

          {/* Backdrop that captures click-to-close. Sits behind the image and controls. */}
          <button
            type="button"
            aria-label="Close preview"
            onClick={() => onOpenChange(false)}
            className="absolute inset-0 cursor-default"
          />

          <DialogPrimitive.Close
            className="absolute top-3 right-3 z-10 rounded-full bg-black/60 text-white hover:bg-black/80 p-2 focus:outline-none focus:ring-2 focus:ring-white/60"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          {canNav && (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="Previous image"
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 text-white hover:bg-black/80 p-2 focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Next image"
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 text-white hover:bg-black/80 p-2 focus:outline-none focus:ring-2 focus:ring-white/60"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/60 text-white text-xs px-3 py-1 select-none">
                {index + 1} / {items.length}
              </div>
            </>
          )}

          {/* Image / status. Wrapper is relative so it sits above the backdrop. */}
          <div
            className="relative flex items-center justify-center max-w-full max-h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {!resolvedUrl && !error && (
              <Loader2 className="h-8 w-8 text-white/80 animate-spin" />
            )}
            {error && (
              <div className="text-white/80 text-sm px-4 text-center">{error}</div>
            )}
            {resolvedUrl && (
              <img
                src={resolvedUrl}
                alt={item?.alt ?? "Preview"}
                onLoad={() => setLoaded(true)}
                onError={() => setError("Could not load image")}
                className={cn(
                  "max-w-[95vw] max-h-[88dvh] object-contain rounded-md shadow-2xl transition-opacity",
                  loaded ? "opacity-100" : "opacity-0",
                )}
                draggable={false}
              />
            )}
            {resolvedUrl && !loaded && !error && (
              <Loader2 className="absolute h-8 w-8 text-white/80 animate-spin" />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
