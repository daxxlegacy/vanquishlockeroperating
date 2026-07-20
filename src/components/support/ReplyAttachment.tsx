// Renders a reply attachment thumbnail using a short-lived signed URL.
// Clicking it either opens the URL directly (fallback) or triggers a
// caller-provided lightbox handler so the modal can display a fresh URL and
// step through multiple attachments in the same conversation.
import { useEffect, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";
import { signTicketAttachment } from "@/lib/ticket-attachment";

type Props = {
  path: string;
  mode: "admin" | "public";
  ticketNumber?: string;
  badgeNumber?: string;
  /** When provided, the thumbnail becomes a button that opens a shared lightbox. */
  onOpen?: () => void;
};

export function ReplyAttachment({ path, mode, ticketNumber, badgeNumber, onOpen }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signed = await signTicketAttachment(
          path,
          mode === "admin"
            ? { mode: "admin" }
            : { mode: "public", ticketNumber: ticketNumber ?? "", badgeNumber: badgeNumber ?? "" },
        );
        if (!cancelled) setUrl(signed);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, mode, ticketNumber, badgeNumber]);

  if (err) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5" /> Attachment unavailable
      </div>
    );
  }
  if (!url) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading attachment…
      </div>
    );
  }

  const img = (
    <img
      src={url}
      alt="Reply attachment"
      className="max-h-40 rounded-md border object-cover hover:opacity-90 transition"
      loading="lazy"
    />
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 inline-block cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        aria-label="Open image preview"
      >
        {img}
      </button>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
      {img}
    </a>
  );
}
