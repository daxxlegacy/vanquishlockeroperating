-- Switch to 5-digit ticket numbers
CREATE OR REPLACE FUNCTION public.gen_support_ticket_number()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  SELECT lpad(nextval('public.support_request_ticket_seq')::text, 5, '0');
$function$;

-- Restart sequence at 1 (only affects new tickets)
ALTER SEQUENCE public.support_request_ticket_seq RESTART WITH 1;