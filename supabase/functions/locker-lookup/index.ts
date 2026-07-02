// Public "Find My Locker" lookup. Requires badge_number and optionally
// last-4 of national_id. Rate-limited per IP.
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

const digitsOnly = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const clean = (value: unknown) => String(value ?? "").trim();
const compact = (value: unknown) => clean(value).toLowerCase().replace(/[\s_-]+/g, "");
const hasNoNationalId = (value: unknown) => {
  const raw = clean(value).toLowerCase();
  return !raw || raw === "-" || raw === "n/a" || raw === "na" || raw === "nil" || digitsOnly(raw).length === 0;
};

const activeRank = (source: string, status: unknown) => {
  const s = clean(status).toLowerCase();
  if (source === "lockers" && s === "active") return 0;
  if (source === "locker_occupancy" && s === "active") return 1;
  if (source === "lockers") return 2;
  return 3;
};

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

  // Rate limit: 10 failed attempts / 10 min per IP. Successful lookups should
  // not block users who scan/check again.
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

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const badge_number = clean(body.badge_number);
  const badge_digits = digitsOnly(badge_number);
  const nid_last4 = digitsOnly(body.national_id_last4).slice(-4);

  const logAttempt = async (success: boolean, locker_number: string | null) => {
    await supabase.from("locker_lookup_attempts").insert({
      ip_address: ip, locker_number, success,
    });
  };

  // Badge is required. NID last-4 is optional (some users don't have one on file).
  const hasNid = /^\d{4}$/.test(nid_last4);
  if (!badge_number) {
    await logAttempt(false, null);
    return json({ error: "No matching record found" }, 404);
  }

  // Check both authoritative tables. Page through the full dataset and normalize
  // in code so formatted badge/NID values still match (spaces, dashes, etc.).
  const findIn = async (table: "lockers" | "locker_occupancy") => {
    const pageSize = 1000;
    const allRows: any[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from(table)
        .select("employee_name,badge_number,locker_number,national_id,status")
        .range(from, from + pageSize - 1);
      if (error) {
        console.error(`locker lookup ${table} query failed`, error.message);
        return [];
      }
      allRows.push(...(data ?? []).map((row: any) => ({ ...row, source: table })));
      if (!data || data.length < pageSize) break;
    }

    const rows = allRows.filter((r: any) => {
      const storedBadge = clean(r.badge_number);
      return (
        compact(storedBadge) === compact(badge_number) ||
        (!!badge_digits && digitsOnly(storedBadge) === badge_digits)
      );
    });
    if (hasNid) {
      // Match by NID when provided.
      return rows.filter(
        (r: any) => !hasNoNationalId(r.national_id) && digitsOnly(r.national_id).slice(-4) === nid_last4,
      );
    }
    // No NID provided → badge-only lookup is allowed when it uniquely matches.
    return rows;
  };

  const all = [...(await findIn("lockers")), ...(await findIn("locker_occupancy"))];

  // De-duplicate across the two tables (same locker/badge pair) and prefer the
  // current active assignment when the upload history also contains old rows.
  const seen = new Set<string>();
  const matches: any[] = [];
  for (const r of all.sort((a, b) => activeRank(a.source, a.status) - activeRank(b.source, b.status))) {
    const key = `${compact(r.locker_number)}|${digitsOnly(r.badge_number) || compact(r.badge_number)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(r);
  }

  const bestRank = matches.length ? activeRank(matches[0].source, matches[0].status) : 99;
  const bestMatches = matches.filter((r) => activeRank(r.source, r.status) === bestRank);

  if (bestMatches.length !== 1) {
    await logAttempt(false, bestMatches[0]?.locker_number ?? matches[0]?.locker_number ?? null);
    return json({ error: "No matching record found" }, 404);
  }

  const m = bestMatches[0];
  await logAttempt(true, m.locker_number ?? null);
  return json({
    employee_name: m.employee_name ?? null,
    badge_number: m.badge_number ?? null,
    locker_number: m.locker_number ?? null,
  });
});
