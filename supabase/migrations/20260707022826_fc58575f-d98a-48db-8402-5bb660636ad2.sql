REVOKE EXECUTE ON FUNCTION public.submit_locker_identity_claim(
  locker_claim_type, text, text, text, text, text, boolean, text[], text
) FROM anon;

DROP POLICY IF EXISTS "Block direct inserts on locker_identity_claims"
  ON public.locker_identity_claims;
CREATE POLICY "Block direct inserts on locker_identity_claims"
  ON public.locker_identity_claims
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Block direct inserts on locker_lookup_attempts"
  ON public.locker_lookup_attempts;
CREATE POLICY "Block direct inserts on locker_lookup_attempts"
  ON public.locker_lookup_attempts
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "Block direct inserts on support_requests"
  ON public.support_requests;
CREATE POLICY "Block direct inserts on support_requests"
  ON public.support_requests
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);