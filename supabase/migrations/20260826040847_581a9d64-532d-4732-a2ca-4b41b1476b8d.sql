DROP FUNCTION IF EXISTS public.submit_locker_identity_claim(locker_claim_type, text, text, text, text, text, boolean, text[], text);

REVOKE ALL ON FUNCTION public.submit_locker_identity_claim(locker_claim_type, text, text, text, text, text, boolean, text[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_locker_identity_claim(locker_claim_type, text, text, text, text, text, boolean, text[], text, text) FROM anon;
REVOKE ALL ON FUNCTION public.submit_locker_identity_claim(locker_claim_type, text, text, text, text, text, boolean, text[], text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_locker_identity_claim(locker_claim_type, text, text, text, text, text, boolean, text[], text, text) TO service_role;