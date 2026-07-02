
-- Enums
DO $$ BEGIN
  CREATE TYPE public.support_request_type AS ENUM ('transfer_locker', 'cant_find_locker', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.support_request_status AS ENUM ('new', 'in_progress', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  request_type public.support_request_type NOT NULL,
  name text NOT NULL,
  badge_number text NOT NULL,
  locker_number text,
  contact_number text NOT NULL,
  message text NOT NULL,
  status public.support_request_status NOT NULL DEFAULT 'new',
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  client_ip inet
);

CREATE INDEX IF NOT EXISTS support_requests_status_created_idx
  ON public.support_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_ip_created_idx
  ON public.support_requests (client_ip, created_at DESC);

GRANT SELECT, UPDATE ON public.support_requests TO authenticated;
GRANT ALL ON public.support_requests TO service_role;

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Support staff can view requests" ON public.support_requests;
CREATE POLICY "Support staff can view requests"
  ON public.support_requests
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
  );

DROP POLICY IF EXISTS "Support staff can update requests" ON public.support_requests;
CREATE POLICY "Support staff can update requests"
  ON public.support_requests
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
  );

DROP TRIGGER IF EXISTS support_requests_set_updated_at ON public.support_requests;
CREATE TRIGGER support_requests_set_updated_at
  BEFORE UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Submission RPC — executable only by service_role (edge function).
CREATE OR REPLACE FUNCTION public.submit_support_request(
  _request_type public.support_request_type,
  _name text,
  _badge_number text,
  _locker_number text,
  _contact_number text,
  _message text,
  _ip text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  ip_val inet := NULL;
  recent_count int;
  clean_name text := trim(coalesce(_name, ''));
  clean_badge text := trim(coalesce(_badge_number, ''));
  clean_locker text := nullif(trim(coalesce(_locker_number, '')), '');
  clean_contact text := trim(coalesce(_contact_number, ''));
  clean_message text := trim(coalesce(_message, ''));
BEGIN
  IF char_length(clean_name) = 0 OR char_length(clean_name) > 120 THEN
    RAISE EXCEPTION 'invalid name' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_badge) = 0 OR char_length(clean_badge) > 60 THEN
    RAISE EXCEPTION 'invalid badge_number' USING ERRCODE = '22023';
  END IF;
  IF clean_locker IS NOT NULL AND char_length(clean_locker) > 60 THEN
    RAISE EXCEPTION 'invalid locker_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_contact) = 0 OR char_length(clean_contact) > 40 THEN
    RAISE EXCEPTION 'invalid contact_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_message) = 0 OR char_length(clean_message) > 2000 THEN
    RAISE EXCEPTION 'invalid message' USING ERRCODE = '22023';
  END IF;

  BEGIN
    ip_val := _ip::inet;
  EXCEPTION WHEN others THEN
    ip_val := NULL;
  END;

  IF ip_val IS NOT NULL THEN
    SELECT count(*) INTO recent_count
    FROM public.support_requests
    WHERE client_ip = ip_val
      AND created_at > now() - interval '10 minutes';
    IF recent_count >= 5 THEN
      RAISE EXCEPTION 'rate limit exceeded' USING ERRCODE = '42901';
    END IF;
  END IF;

  INSERT INTO public.support_requests
    (request_type, name, badge_number, locker_number, contact_number, message, client_ip)
  VALUES
    (_request_type, clean_name, clean_badge, clean_locker, clean_contact, clean_message, ip_val)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_support_request(
  public.support_request_type, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_support_request(
  public.support_request_type, text, text, text, text, text, text
) TO service_role;
