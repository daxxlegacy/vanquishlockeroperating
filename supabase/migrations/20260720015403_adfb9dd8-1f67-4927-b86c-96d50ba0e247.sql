
CREATE OR REPLACE FUNCTION public.submit_support_request(_request_type support_request_type, _name text, _badge_number text, _locker_number text, _contact_number text, _message text, _ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  existing_ticket text;
  existing_status public.support_request_status;
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

  -- Reject if this badge already has an unresolved ticket
  SELECT ticket_number, status
    INTO existing_ticket, existing_status
    FROM public.support_requests
   WHERE lower(badge_number) = lower(clean_badge)
     AND status IN ('new'::public.support_request_status, 'in_progress'::public.support_request_status)
   ORDER BY created_at DESC
   LIMIT 1;

  IF existing_ticket IS NOT NULL THEN
    RAISE EXCEPTION 'open_ticket_exists:%:%', existing_ticket, existing_status
      USING ERRCODE = '23505';
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
$function$;
