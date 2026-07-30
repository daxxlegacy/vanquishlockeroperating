CREATE OR REPLACE FUNCTION public.find_duplicate_active_occupants()
RETURNS TABLE (
  id uuid,
  category text,
  locker_number text,
  employee_name text,
  badge_number text,
  national_id text,
  batch_intake_date date,
  status text,
  badge_key text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.can_access_lockers(auth.uid())) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH active AS (
    SELECT o.id, o.category, o.locker_number, o.employee_name, o.badge_number,
           o.national_id, o.batch_intake_date, o.status,
           lower(btrim(o.badge_number)) AS badge_key
    FROM public.locker_occupancy o
    WHERE o.status ILIKE 'active'
      AND COALESCE(btrim(o.badge_number), '') <> ''
  ),
  dup AS (
    SELECT a.badge_key FROM active a GROUP BY a.badge_key HAVING COUNT(*) > 1
  )
  SELECT a.id, a.category, a.locker_number, a.employee_name, a.badge_number,
         a.national_id, a.batch_intake_date, a.status, a.badge_key
  FROM active a
  JOIN dup d ON d.badge_key = a.badge_key
  WHERE NOT EXISTS (
    SELECT 1 FROM public.locker_identity_claims c
    WHERE c.claim_type = 'multiple_locker'::public.locker_claim_type
      AND c.status = 'approved'::public.locker_claim_status
      AND lower(btrim(c.badge_number)) = a.badge_key
  )
  ORDER BY a.badge_key, a.category, a.locker_number;
END;
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_active_occupants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_active_occupants() TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_multiple_locker_exception(
  _badge_number text,
  _full_name text,
  _locker_numbers text[],
  _notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id uuid;
  clean_badge text := btrim(coalesce(_badge_number, ''));
  clean_name text := btrim(coalesce(_full_name, ''));
  clean_lockers text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF char_length(clean_badge) = 0 THEN
    RAISE EXCEPTION 'invalid badge_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_name) = 0 THEN
    clean_name := clean_badge;
  END IF;

  SELECT array_agg(upper(btrim(x))) INTO clean_lockers
    FROM unnest(coalesce(_locker_numbers, ARRAY[]::text[])) x
   WHERE btrim(x) <> '';

  INSERT INTO public.locker_identity_claims
    (claim_type, locker_number, badge_number, full_name, contact_number,
     other_locker_numbers, still_using, status, reviewed_by, reviewed_at, admin_notes)
  VALUES
    ('multiple_locker'::public.locker_claim_type,
     COALESCE(clean_lockers[1], 'N/A'),
     clean_badge,
     clean_name,
     'N/A',
     clean_lockers,
     true,
     'approved'::public.locker_claim_status,
     auth.uid(),
     now(),
     COALESCE(nullif(btrim(_notes), ''), 'Approved via duplicate occupancy review'))
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_multiple_locker_exception(text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_multiple_locker_exception(text, text, text[], text) TO authenticated;