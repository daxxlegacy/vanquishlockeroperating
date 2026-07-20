// Renders a reply attachment thumbnail using a short-lived signed URL.
// For admins (signed-in) we sign directly against storage. For public ticket
// viewers we call the support-ticket edge fn's sign_attachment action.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ImageOff } from "lucide-react";

type Props = {
  path: string;
  mode: "admin" | "public";
  ticketNumber?: string;
  badgeNumber?: string;
};

export function ReplyAttachment({ path, mode, ticketNumber, badgeNumber }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sign = async () => {
      try {
        if (mode === "admin") {
          const { data, error } = await supabase.storage
            .from("ticket-attachments")
            .createSignedUrl(path, 300);
          if (cancelled) return;
          if (error || !data) setErr(true);
          else setUrl(data.signedUrl);
        } else {
          const { data, error } = await supabase.functions.invoke("support-ticket", {
            body: {
              action: "sign_attachment",
              ticket_number: ticketNumber,
              badge_number: badgeNumber,
              attachment_path: path,
            },
          });
          if (cancelled) return;
          const u = (data as { url?: string } | null)?.url;
          if (error || !u) setErr(true);
          else setUrl(u);
        }
      } catch {
        if (!cancelled) setErr(true);
      }
    };
    sign();
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
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
      <img
        src={url}
        alt="Reply attachment"
        className="max-h-40 rounded-md border object-cover hover:opacity-90 transition"
        loading="lazy"
      />
    </a>
  );
}
