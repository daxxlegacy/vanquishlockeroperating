// Public ticket lookup + user reply. Primary entry is `list_by_badge`
// (rate-limited by IP). `lookup` fetches a specific ticket's full conversation
// by ticket_number+badge (used after the user picks a ticket from the list
// and by the polling loop). `reply` and `sign_attachment` operate on a
// specific ticket the caller has proven ownership of via ticket_number+badge.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const action = String(body.action ?? "lookup");
  const ticket = String(body.ticket_number ?? "").trim();
  const badge = String(body.badge_number ?? "").trim();

  // Alternate lookup: list all tickets for a badge, rate-limited per IP.
  if (action === "list_by_badge") {
    if (!badge) return json({ error: "Enter your badge number." }, 400);

    const fwd = req.headers.get("x-forwarded-for") ?? "";
    const ip = (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("locker_lookup_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("success", false)
      .gte("attempted_at", since);
    if ((count ?? 0) >= 10) {
      return json({ error: "Too many attempts, try again later" }, 429);
    }

    const { data: rows, error: lErr } = await supabase
      .from("support_requests")
      .select("ticket_number, request_type, status, created_at")
      .ilike("badge_number", badge)
      .order("created_at", { ascending: false })
      .limit(50);
    if (lErr) {
      console.error("list_by_badge failed:", lErr.message);
      return json({ error: "Could not load tickets." }, 400);
    }
    const list = rows ?? [];
    await supabase.from("locker_lookup_attempts").insert({
      ip_address: ip, locker_number: null, success: list.length > 0,
    });
    if (list.length === 0) return json({ error: "No matching record found" }, 404);
    return json({ tickets: list });
  }

  if (!ticket || !badge) return json({ error: "Enter ticket number and badge number." }, 400);


  // Verify caller owns this ticket (used before any operation)
  const { data: ownData, error: ownErr } = await supabase.rpc("get_support_ticket_public", {
    _ticket: ticket,
    _badge: badge,
  });
  if (ownErr) {
    console.error("lookup failed:", ownErr.message);
    return json({ error: "Could not load ticket." }, 400);
  }
  if (!ownData) return json({ error: "Ticket not found. Check your ticket number and badge." }, 404);

  if (action === "sign_attachment") {
    const path = String(body.attachment_path ?? "").trim();
    if (!path) return json({ error: "Missing attachment_path." }, 400);
    // Verify the path belongs to a reply on this ticket
    const replies = (ownData as any).replies as Array<{ attachment_path?: string | null }>;
    const owned = replies.some((r) => r.attachment_path === path);
    if (!owned) return json({ error: "Attachment not found on this ticket." }, 404);

    const { data: signed, error: sErr } = await supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(path, 300);
    if (sErr || !signed) {
      console.error("sign failed:", sErr?.message);
      return json({ error: "Could not sign attachment." }, 400);
    }
    return json({ url: signed.signedUrl });
  }

  if (action === "reply") {
    const message = String(body.message ?? "").trim();
    if (!message) return json({ error: "Please type a message." }, 400);
    if (message.length > 4000) return json({ error: "Message is too long." }, 400);

    const { error: rErr } = await supabase.rpc("add_support_ticket_reply_public", {
      _ticket: ticket,
      _badge: badge,
      _message: message,
    });
    if (rErr) {
      const m = (rErr.message || "").toLowerCase();
      if (m.includes("not found")) return json({ error: "Ticket not found." }, 404);
      console.error("reply failed:", rErr.message);
      return json({ error: "Could not send reply." }, 400);
    }
  }

  const { data, error } = await supabase.rpc("get_support_ticket_public", {
    _ticket: ticket,
    _badge: badge,
  });
  if (error) {
    console.error("lookup failed:", error.message);
    return json({ error: "Could not load ticket." }, 400);
  }
  if (!data) return json({ error: "Ticket not found. Check your ticket number and badge." }, 404);

  return json({ ticket: data });
});
