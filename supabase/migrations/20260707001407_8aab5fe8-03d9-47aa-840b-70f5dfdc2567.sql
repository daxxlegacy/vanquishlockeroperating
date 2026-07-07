
DO $$ BEGIN
  CREATE TYPE public.locker_claim_type AS ENUM ('unknown_owner', 'multiple_locker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.locker_claim_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.locker_identity_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claim_type public.locker_claim_type NOT NULL,
  locker_number text NOT NULL,
  badge_number text NOT NULL,
  full_name text NOT NULL,
  still_using boolean,
  other_locker_numbers text[],
  location text,
  contact_number text NOT NULL,
  status public.locker_claim_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  admin_notes text,
  client_ip inet
);

GRANT SELECT, UPDATE ON public.locker_identity_claims TO authenticated;
GRANT ALL ON public.locker_identity_claims TO service_role;

ALTER TABLE public.locker_identity_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins & managers can view claims" ON public.locker_identity_claims
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission));

CREATE POLICY "Admins & managers can update claims" ON public.locker_identity_claims
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission));

CREATE TRIGGER trg_locker_identity_claims_updated
  BEFORE UPDATE ON public.locker_identity_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_locker_identity_claims_status ON public.locker_identity_claims(status, created_at DESC);
CREATE INDEX idx_locker_identity_claims_ip ON public.locker_identity_claims(client_ip, created_at DESC);

CREATE OR REPLACE FUNCTION public.submit_locker_identity_claim(
  _claim_type public.locker_claim_type,
  _locker_number text,
  _badge_number text,
  _full_name text,
  _contact_number text,
  _location text,
  _still_using boolean,
  _other_locker_numbers text[],
  _ip text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  ip_val inet := NULL;
  recent_count int;
  clean_locker text := upper(trim(coalesce(_locker_number, '')));
  clean_badge text := trim(coalesce(_badge_number, ''));
  clean_name text := trim(coalesce(_full_name, ''));
  clean_contact text := trim(coalesce(_contact_number, ''));
  clean_location text := nullif(trim(coalesce(_location, '')), '');
  clean_others text[];
BEGIN
  IF clean_locker !~ '^[0-9]+[A-Z]$' THEN
    RAISE EXCEPTION 'invalid locker_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_badge) = 0 OR char_length(clean_badge) > 60 THEN
    RAISE EXCEPTION 'invalid badge_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_name) = 0 OR char_length(clean_name) > 120 THEN
    RAISE EXCEPTION 'invalid full_name' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_contact) = 0 OR char_length(clean_contact) > 40 THEN
    RAISE EXCEPTION 'invalid contact_number' USING ERRCODE = '22023';
  END IF;

  IF _other_locker_numbers IS NOT NULL THEN
    SELECT array_agg(upper(trim(x))) INTO clean_others
      FROM unnest(_other_locker_numbers) x
      WHERE trim(x) <> '';
    IF clean_others IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM unnest(clean_others) y WHERE y !~ '^[0-9]+[A-Z]$') THEN
        RAISE EXCEPTION 'invalid other_locker_numbers' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  BEGIN
    ip_val := _ip::inet;
  EXCEPTION WHEN others THEN
    ip_val := NULL;
  END;

  IF ip_val IS NOT NULL THEN
    SELECT count(*) INTO recent_count
      FROM public.locker_identity_claims
      WHERE client_ip = ip_val
        AND created_at > now() - interval '10 minutes';
    IF recent_count >= 5 THEN
      RAISE EXCEPTION 'rate limit exceeded' USING ERRCODE = '42901';
    END IF;
  END IF;

  INSERT INTO public.locker_identity_claims
    (claim_type, locker_number, badge_number, full_name, contact_number,
     location, still_using, other_locker_numbers, client_ip)
  VALUES
    (_claim_type, clean_locker, clean_badge, clean_name, clean_contact,
     clean_location, _still_using, clean_others, ip_val)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('id', new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_locker_identity_claim(
  public.locker_claim_type, text, text, text, text, text, boolean, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_locker_identity_claim(
  public.locker_claim_type, text, text, text, text, text, boolean, text[], text
) TO anon, authenticated;

-- Update the cached view of "which pages/actions a user can access" so the new
-- claims-management permission doesn't fall outside of can_access_lockers.
