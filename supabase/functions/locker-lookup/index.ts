// Public "Find My Locker" lookup. Requires badge_number. Optionally accepts
// locker_number to disambiguate when only one locker is wanted. Returns ALL
// active lockers assigned to that badge (an employee may have 2+). Rate-limited
// per IP based on failed attempts.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { attemptLog, type FailureReason } from './logging.ts';

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

  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const badge_number = clean(body.badge_number);
  const badge_digits = digitsOnly(badge_number);
  const locker_number = clean(body.locker_number);
  const logAttempt = async (success: boolean, locker_num: string | null, reason: FailureReason | null, matched?: any) => {
    let owner = matched ?? null;
    if (locker_num) {
      const { data } = await supabase.from('lockers').select('employee_name,badge_number,status').eq('locker_number',locker_num).is('deleted_at',null).maybeSingle();
      if (data) owner = data;
    }
    const failure = reason === 'badge_mismatch' && locker_num
      ? !owner ? 'locker_not_found' : owner.status === 'empty' ? 'empty_locker' : reason
      : reason;
    await supabase.from('locker_lookup_attempts').insert(attemptLog({ip,locker:locker_num,badge:badge_number,success,owner,reason:failure}));
  };

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("locker_lookup_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_address", ip)
    .eq("success", false)
    // Throttled requests were previously unlogged; exclude them to keep the same lockout window.
    .or('failure_reason.is.null,failure_reason.neq.rate_limited')
    .gte("attempted_at", since);
  if ((count ?? 0) >= 10) {
    await logAttempt(false, locker_number || null, 'rate_limited');
    return json({ error: "Too many attempts, try again later" }, 429);
  }

  if (!badge_number) {
    await logAttempt(false, null, 'badge_mismatch');
    return json({ error: "No matching record found" }, 404);
  }

  const findIn = async (table: "lockers" | "locker_occupancy") => {
    const pageSize = 1000;
    const allRows: any[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from(table)
        .select("employee_name,badge_number,locker_number,status")
        .range(from, from + pageSize - 1);
      if (error) {
        console.error(`locker lookup ${table} query failed`, error.message);
        return [];
      }
      allRows.push(...(data ?? []).map((row: any) => ({ ...row, source: table })));
      if (!data || data.length < pageSize) break;
    }

    return allRows.filter((r: any) => {
      const storedBadge = clean(r.badge_number);
      return (
        compact(storedBadge) === compact(badge_number) ||
        (!!badge_digits && digitsOnly(storedBadge) === badge_digits)
      );
    });
  };

  let all = [...(await findIn("lockers")), ...(await findIn("locker_occupancy"))];

  // Optional locker_number filter (narrow to one specific locker).
  if (locker_number) {
    all = all.filter((r: any) => compact(r.locker_number) === compact(locker_number));
  }

  // De-duplicate by locker+badge pair, prefer active/lockers rows.
  const seen = new Map<string, any>();
  for (const r of all.sort((a, b) => activeRank(a.source, a.status) - activeRank(b.source, b.status))) {
    const key = `${compact(r.locker_number)}|${digitsOnly(r.badge_number) || compact(r.badge_number)}`;
    if (!seen.has(key)) seen.set(key, r);
  }

  // Prefer active rows if any exist; otherwise return whatever matched.
  const deduped = [...seen.values()];
  const actives = deduped.filter((r) => activeRank(r.source, r.status) <= 1);
  const results = actives.length ? actives : deduped;

  if (results.length === 0) {
    await logAttempt(false, locker_number || null, 'badge_mismatch');
    return json({ error: "No matching record found" }, 404);
  }

  // Log a single successful attempt per search request.
  await logAttempt(true, results[0].locker_number ?? null, null, results[0]);

  const payload = results.map((m: any) => ({
    employee_name: m.employee_name ?? null,
    badge_number: m.badge_number ?? null,
    locker_number: m.locker_number ?? null,
  }));

  return json({ results: payload });
});
