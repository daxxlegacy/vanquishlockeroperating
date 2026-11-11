// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Shared helper for signing a ticket attachment path into a short-lived URL.
// Admin (signed-in) path signs directly against Supabase storage; public
// ticket viewers go through the support-ticket edge function.
import { supabase } from "@/integrations/supabase/client";

export type TicketAttachmentContext =
  | { mode: "admin" }
  | { mode: "public"; ticketNumber: string; badgeNumber: string };

export async function signTicketAttachment(
  path: string,
  ctx: TicketAttachmentContext,
): Promise<string> {
  if (ctx.mode === "admin") {
    const { data, error } = await supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "Failed to sign attachment");
    }
    return data.signedUrl;
  }
  const { data, error } = await supabase.functions.invoke("support-ticket", {
    body: {
      action: "sign_attachment",
      ticket_number: ctx.ticketNumber,
      badge_number: ctx.badgeNumber,
      attachment_path: path,
    },
  });
  const url = (data as { url?: string } | null)?.url;
  if (error || !url) {
    throw new Error(error?.message ?? "Failed to sign attachment");
  }
  return url;
}
