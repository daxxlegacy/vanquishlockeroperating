# Support Requests — /find-locker help flow + admin review

Extends /find-locker with a button-driven help menu, adds a lightweight support-ticket table, and gives admins (and holders of a new `manage_support_requests` permission) a place to review and resolve them.

## 1. Database migration

New enums:
- `support_request_type`: `transfer_locker`, `cant_find_locker`, `other`
- `support_request_status`: `new`, `in_progress`, `resolved` (default `new`)

Add to existing `app_permission` enum: `manage_support_requests`.

New table `public.support_requests`:
- request_type, name, badge_number, locker_number (nullable), contact_number, message, status, resolved_by (uuid → auth.users), resolved_at, plus id/created_at/updated_at.

Grants + RLS:
- `GRANT INSERT ON public.support_requests TO anon, authenticated` is NOT given — writes only via RPC.
- `GRANT SELECT, UPDATE ON public.support_requests TO authenticated` (RLS still gates it).
- `GRANT ALL ... TO service_role`.
- RLS enabled. Policies:
  - SELECT: `has_role(auth.uid(),'admin') OR has_permission(auth.uid(),'manage_support_requests')`
  - UPDATE: same predicate, `WITH CHECK` same.
  - No INSERT/DELETE policies (RPC bypasses via SECURITY DEFINER; deletes forbidden).

New RPC `public.submit_support_request(...)` — SECURITY DEFINER, returns the new row's id:
- Validates lengths (name ≤ 120, badge ≤ 60, locker ≤ 60, contact ≤ 40, message ≤ 2000, request_type in enum).
- Rate limit reusing the existing `locker_lookup_attempts` pattern: max 5 rows inserted into `support_requests` for the same client IP in the last 10 minutes (record IP via `request.headers` inside the edge function that calls the RPC — see below).
- Inserts the row and returns id.

Because Postgres can't read the caller's IP directly on the browser publishable path, the RPC accepts an `_ip text` argument and is only exposed through a thin **`submit-support-request` edge function** that resolves the IP (`x-forwarded-for` / `cf-connecting-ip`) and forwards it to the RPC. Anon calls to the RPC without going through the function are still blocked because we do NOT `GRANT EXECUTE ... TO anon` on the RPC — only `service_role` can execute it, which the edge function uses via `SUPABASE_SERVICE_ROLE_KEY`. This matches the existing `locker-lookup` function's pattern.

## 2. `/find-locker` UI

Keep the existing badge-number lookup form. Below it add a "How can we help you?" card with four buttons that swap the panel below:

- **Find my locker** — no-op (already the form above).
- **I want to transfer my locker** — scripted preamble + short form (name, badge number, current locker number, reason) → submit.
- **I can't find my locker number** — scripted guidance + "Still can't find it — contact us" button → same short form (locker_number optional, message = "Can't find locker").
- **Something else** — free-text textarea + name/contact + "Send to support" button → submits with `request_type='other'`.

All three submission paths call the new `submit-support-request` edge function with `{ request_type, name, badge_number, locker_number?, contact_number, message }`, then show:

> Your request has been received. Reference #{id}. Our team will contact you at {contact_number} shortly.

Client-side zod validation before calling. Errors return generic message ("Couldn't submit right now — please try again or contact the admin office.") without leaking rate-limit vs validation details.

## 3. Admin panel

- Add `manage_support_requests` permission to `src/lib/permissions.ts` with label "Manage Support Requests".
- New route `src/routes/support-requests.tsx` guarded by `PageGuard permission="manage_support_requests"`. (Simpler than shoehorning into `operations.tsx` — operations was just trimmed.)
- Nav item in `AppHeader.tsx` with a red badge showing the count of `status='new'` requests. Uses a small `useSupportRequestsCount()` hook that subscribes via Supabase realtime.
- Page: filter tabs (New / In progress / Resolved / All), card list sorted by `created_at desc`. Each card shows type, name, badge, locker, contact, message, timestamps. Actions: **Mark in progress**, **Mark resolved**, with `resolved_by = auth.uid()` and `resolved_at = now()` set on resolve.

## Files to add / modify

Add:
- `supabase/functions/submit-support-request/index.ts` — validates payload, resolves IP, calls RPC, returns `{ id }` or 429/400.
- `src/routes/support-requests.tsx` — admin list & actions.
- `src/components/support/HelpMenu.tsx` — the four-button help section for /find-locker.
- `src/components/support/SupportRequestForm.tsx` — shared short form.
- `src/lib/support-requests.ts` — small typed wrapper + realtime count hook.

Modify:
- `src/routes/find-locker.tsx` — mount `<HelpMenu />` below the existing form.
- `src/lib/permissions.ts` — add `manage_support_requests`.
- `src/components/AppHeader.tsx` — add nav item + count badge.
- `supabase/config.toml` — register the new edge function (no JWT verification, matches `locker-lookup`).

## Technical notes

- Rate-limit query counts rows in `support_requests` by `created_at > now() - interval '10 minutes' AND client_ip = _ip` (we add a private `client_ip inet` column, not exposed in the app types beyond admin view). Insert then re-check count and raise `rate limit exceeded` on the 6th hit.
- The `submit_support_request` RPC only accepts the enum type (Postgres enforces), and normalises string trims + length caps server-side too.
- The AI fallback flow mentioned for "Something else" is left as a placeholder button on the UI — it will be wired to the AI gateway in the follow-up step.
- No joins to `lockers` / `locker_occupancy`. `locker_number` is stored as plain text exactly as typed.
- The AppHeader badge uses the `useSupportRequestsCount` hook, which returns 0 for users without the permission (guarded by RLS — the SELECT count query simply returns 0 rows).
