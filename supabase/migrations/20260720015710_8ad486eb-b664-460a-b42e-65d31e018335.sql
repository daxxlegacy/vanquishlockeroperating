
ALTER TABLE public.support_request_replies
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'in_app';

CREATE OR REPLACE FUNCTION public.get_support_ticket_public(_ticket text, _badge text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'attachment_path', r.attachment_path,
      'created_at', r.created_at
    ) ORDER BY r.created_at), '[]'::jsonb)
    INTO reps
    FROM public.support_request_replies r
   WHERE r.request_id = req.id
     AND coalesce(r.channel, 'in_app') <> 'whatsapp_outbound';

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
$function$;
