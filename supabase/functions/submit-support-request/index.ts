// Public "Submit Support Request" endpoint. Rate-limited per IP.
// Calls the SECURITY DEFINER RPC public.submit_support_request via
// the service role — anon cannot execute the RPC directly.
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

const ALLOWED_TYPES = new Set(["transfer_locker", "cant_find_locker", "other"]);

const clean = (v: unknown, max: number) =>
  String(v ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server misconfigured" }, 500);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "").trim();

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const request_type = String(body.request_type ?? "").trim();
  if (!ALLOWED_TYPES.has(request_type)) {
    return json({ error: "Invalid request type" }, 400);
  }

  const name = clean(body.name, 120);
  const badge_number = clean(body.badge_number, 60);
  const locker_number_raw = clean(body.locker_number, 60);
  const contact_number = clean(body.contact_number, 40);
  const message = clean(body.message, 2000);

  if (!name || !badge_number || !contact_number || !message) {
    return json({ error: "Missing required fields" }, 400);
  }

  const { data, error } = await supabase.rpc("submit_support_request", {
    _request_type: request_type,
    _name: name,
    _badge_number: badge_number,
    _locker_number: locker_number_raw || null,
    _contact_number: contact_number,
    _message: message,
    _ip: ip || null,
  });

  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("rate limit")) {
      return json({ error: "Too many requests. Please try again in a few minutes." }, 429);
    }
    console.error("submit_support_request failed:", error.message);
    return json({ error: "Could not submit your request. Please try again shortly." }, 400);
  }

  const payload = (data ?? {}) as { id?: string; ticket_number?: string };
  return json({ id: payload.id, ticket_number: payload.ticket_number });
});
