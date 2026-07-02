
-- 1) Ticket numbers on support_requests
CREATE SEQUENCE IF NOT EXISTS public.support_request_ticket_seq;

CREATE OR REPLACE FUNCTION public.gen_support_ticket_number()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'TKT-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.support_request_ticket_seq')::text, 5, '0');
$$;

ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS ticket_number text;

UPDATE public.support_requests
   SET ticket_number = public.gen_support_ticket_number()
 WHERE ticket_number IS NULL;

ALTER TABLE public.support_requests
  ALTER COLUMN ticket_number SET NOT NULL,
  ALTER COLUMN ticket_number SET DEFAULT public.gen_support_ticket_number();

CREATE UNIQUE INDEX IF NOT EXISTS support_requests_ticket_number_key
  ON public.support_requests (ticket_number);

-- 2) Replies table
CREATE TABLE IF NOT EXISTS public.support_request_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.support_requests(id) ON DELETE CASCADE,
  author_role text NOT NULL CHECK (author_role IN ('admin','user')),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_request_replies_request_created_idx
  ON public.support_request_replies (request_id, created_at);

GRANT SELECT, INSERT ON public.support_request_replies TO authenticated;
GRANT ALL ON public.support_request_replies TO service_role;

ALTER TABLE public.support_request_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Support staff can view replies" ON public.support_request_replies;
CREATE POLICY "Support staff can view replies"
  ON public.support_request_replies
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
  );

DROP POLICY IF EXISTS "Support staff can add replies" ON public.support_request_replies;
CREATE POLICY "Support staff can add replies"
  ON public.support_request_replies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_role = 'admin'
    AND author_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
    )
  );

-- Bump support_requests.updated_at when a reply is added / status touched
CREATE OR REPLACE FUNCTION public.touch_support_request_on_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.support_requests
     SET updated_at = now()
   WHERE id = NEW.request_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_request_replies_touch ON public.support_request_replies;
CREATE TRIGGER support_request_replies_touch
  AFTER INSERT ON public.support_request_replies
  FOR EACH ROW EXECUTE FUNCTION public.touch_support_request_on_reply();

-- 3) Update submit RPC to also return the ticket number
DROP FUNCTION IF EXISTS public.submit_support_request(
  public.support_request_type, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.submit_support_request(
  _request_type public.support_request_type,
  _name text,
  _badge_number text,
  _locker_number text,
  _contact_number text,
  _message text,
  _ip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  new_ticket text;
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
  RETURNING id, ticket_number INTO new_id, new_ticket;

  RETURN jsonb_build_object('id', new_id, 'ticket_number', new_ticket);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_support_request(
  public.support_request_type, text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_support_request(
  public.support_request_type, text, text, text, text, text, text
) TO service_role;

-- 4) Public ticket lookup (service_role only — edge fn) — matches ticket + badge (case-insensitive)
CREATE OR REPLACE FUNCTION public.get_support_ticket_public(
  _ticket text,
  _badge text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req record;
  reps jsonb;
BEGIN
  SELECT id, ticket_number, created_at, updated_at, request_type, name,
         badge_number, locker_number, contact_number, message, status,
         resolved_at
    INTO req
    FROM public.support_requests
   WHERE upper(ticket_number) = upper(trim(coalesce(_ticket, '')))
     AND lower(badge_number) = lower(trim(coalesce(_badge, '')))
   LIMIT 1;

  IF req.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'author_role', r.author_role,
      'author_name', r.author_name,
      'message', r.message,
      'created_at', r.created_at
    ) ORDER BY r.created_at), '[]'::jsonb)
    INTO reps
    FROM public.support_request_replies r
   WHERE r.request_id = req.id;

  RETURN jsonb_build_object(
    'id', req.id,
    'ticket_number', req.ticket_number,
    'created_at', req.created_at,
    'updated_at', req.updated_at,
    'request_type', req.request_type,
    'name', req.name,
    'badge_number', req.badge_number,
    'locker_number', req.locker_number,
    'contact_number', req.contact_number,
    'message', req.message,
    'status', req.status,
    'resolved_at', req.resolved_at,
    'replies', reps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_support_ticket_public(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_public(text, text) TO service_role;

-- 5) Public reply from user (service_role only)
CREATE OR REPLACE FUNCTION public.add_support_ticket_reply_public(
  _ticket text,
  _badge text,
  _message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_id uuid;
  req_name text;
  new_id uuid;
  clean_message text := trim(coalesce(_message, ''));
BEGIN
  IF char_length(clean_message) = 0 OR char_length(clean_message) > 4000 THEN
    RAISE EXCEPTION 'invalid message' USING ERRCODE = '22023';
  END IF;

  SELECT id, name INTO req_id, req_name
    FROM public.support_requests
   WHERE upper(ticket_number) = upper(trim(coalesce(_ticket, '')))
     AND lower(badge_number) = lower(trim(coalesce(_badge, '')))
   LIMIT 1;

  IF req_id IS NULL THEN
    RAISE EXCEPTION 'ticket not found' USING ERRCODE = '02000';
  END IF;

  INSERT INTO public.support_request_replies (request_id, author_role, author_name, message)
  VALUES (req_id, 'user', req_name, clean_message)
  RETURNING id INTO new_id;

  -- Re-open ticket if admin had marked it resolved
  UPDATE public.support_requests
     SET status = CASE WHEN status = 'resolved' THEN 'in_progress'::public.support_request_status ELSE status END,
         updated_at = now()
   WHERE id = req_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_support_ticket_reply_public(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_support_ticket_reply_public(text, text, text) TO service_role;
