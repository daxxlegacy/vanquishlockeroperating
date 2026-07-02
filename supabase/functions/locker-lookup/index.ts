// Public "Find My Locker" lookup. Requires locker_number + badge_number
// + last-4 of national_id to all match. Rate-limited per IP.
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

  // Derive caller IP (best-effort).
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();

  // Rate limit: 5 attempts / 10 min per IP.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("locker_lookup_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gte("attempted_at", since);
  if ((count ?? 0) >= 5) {
    return json({ error: "Too many attempts, try again later" }, 429);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const locker_number = String(body.locker_number ?? "").trim();
  const badge_number = String(body.badge_number ?? "").trim();
  const nid_last4 = String(body.national_id_last4 ?? "").trim();

  const logAttempt = async (success: boolean) => {
    await supabase.from("locker_lookup_attempts").insert({
      ip_address: ip, locker_number: locker_number || null, success,
    });
  };

  if (!locker_number || !badge_number || !/^\d{4}$/.test(nid_last4)) {
    await logAttempt(false);
    return json({ error: "No matching record found" }, 404);
  }

  // Check both authoritative tables.
  const findIn = async (table: "lockers" | "locker_occupancy") => {
    const { data } = await supabase
      .from(table)
      .select("employee_name,badge_number,locker_number,national_id")
      .eq("locker_number", locker_number)
      .eq("badge_number", badge_number)
      .limit(5);
    return (data ?? []).filter(
      (r: any) => r.national_id && String(r.national_id).slice(-4) === nid_last4,
    );
  };

  const matches = [...(await findIn("lockers")), ...(await findIn("locker_occupancy"))];

  if (matches.length !== 1) {
    await logAttempt(false);
    return json({ error: "No matching record found" }, 404);
  }

  const m = matches[0] as any;
  await logAttempt(true);
  return json({
    employee_name: m.employee_name ?? null,
    badge_number: m.badge_number ?? null,
    locker_number: m.locker_number ?? null,
  });
});
