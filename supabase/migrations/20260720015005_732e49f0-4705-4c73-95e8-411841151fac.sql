
-- 1. Add attachment_path column to support_request_replies
ALTER TABLE public.support_request_replies
  ADD COLUMN IF NOT EXISTS attachment_path text;

-- 2. Storage policies: admins (with manage_support_requests permission or admin role) can upload/read/delete in ticket-attachments
CREATE POLICY "Admins can read ticket attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
       OR public.has_permission(auth.uid(), 'page_support_requests'::public.app_permission))
);

CREATE POLICY "Admins can upload ticket attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission))
);

CREATE POLICY "Admins can delete ticket attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission))
);

-- 3. Update public RPC to include attachment_path in replies JSON
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
$function$;
