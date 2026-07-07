// Public "Locker Identity Update" submission endpoint.
// Calls the SECURITY DEFINER RPC public.submit_locker_identity_claim via
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

const ALLOWED_CLAIM_TYPES = new Set(["unknown_owner", "found_own_locker", "other"]);

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

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

  const claim_type = String(body.claim_type ?? "unknown_owner").trim();
  if (!ALLOWED_CLAIM_TYPES.has(claim_type)) {
    return json({ error: "Invalid claim type" }, 400);
  }

  const locker_number = clean(body.locker_number, 60).toUpperCase();
  const badge_number = clean(body.badge_number, 60);
  const full_name = clean(body.full_name, 120);
  const contact_number = clean(body.contact_number, 40);
  const location = clean(body.location, 120);
  const still_using = typeof body.still_using === "boolean" ? body.still_using : null;
  const other_raw = Array.isArray(body.other_locker_numbers) ? body.other_locker_numbers : [];
  const other_locker_numbers = other_raw
    .map((v: unknown) => clean(v, 60).toUpperCase())
    .filter((v: string) => v.length > 0)
    .slice(0, 20);

  if (!locker_number || !badge_number || !full_name || !contact_number) {
    return json({ error: "Missing required fields" }, 400);
  }

  const { data, error } = await supabase.rpc("submit_locker_identity_claim", {
    _claim_type: claim_type,
    _locker_number: locker_number,
    _badge_number: badge_number,
    _full_name: full_name,
    _contact_number: contact_number,
    _location: location || null,
    _still_using: still_using,
    _other_locker_numbers: other_locker_numbers,
    _ip: ip || null,
  });

  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("rate limit")) {
      return json({ error: "Too many requests. Please try again in a few minutes." }, 429);
    }
    console.error("submit_locker_identity_claim failed:", error.message);
    return json({ error: "Could not submit your response. Please try again shortly." }, 400);
  }

  const payload = (data ?? {}) as { id?: string };
  return json({ id: payload.id });
});
