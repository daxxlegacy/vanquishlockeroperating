
CREATE OR REPLACE FUNCTION public.count_occupancy_drift()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  terminate_needed int := 0;
  activate_needed int := 0;
  duplicates int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.can_access_lockers(auth.uid())) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Duplicates: extra active occupancy rows per locker_number beyond the first
  SELECT COALESCE(SUM(cnt - 1), 0) INTO duplicates
  FROM (
    SELECT locker_number, COUNT(*) AS cnt
    FROM public.locker_occupancy
    WHERE status ILIKE 'active'
    GROUP BY locker_number
    HAVING COUNT(*) > 1
  ) d;

  -- Terminate-needed: active occupancy rows where the lockers page says
  -- otherwise. We only count ONE per (locker_number) — the duplicates are
  -- counted separately above.
  SELECT COUNT(*) INTO terminate_needed
  FROM (
    SELECT DISTINCT ON (o.locker_number) o.locker_number, o.employee_name, o.badge_number
    FROM public.locker_occupancy o
    WHERE o.status ILIKE 'active'
    ORDER BY o.locker_number, o.updated_at DESC NULLS LAST
  ) o
  JOIN public.lockers l
    ON l.locker_number = o.locker_number
   AND l.deleted_at IS NULL
  WHERE NOT (
    l.status::text ILIKE 'active'
    AND l.employee_name IS NOT NULL
    AND btrim(l.employee_name) <> ''
    AND lower(btrim(COALESCE(l.employee_name, ''))) = lower(btrim(COALESCE(o.employee_name, '')))
    AND lower(btrim(COALESCE(l.badge_number, ''))) = lower(btrim(COALESCE(o.badge_number, '')))
  );

  -- Activate-needed: lockers marked active with an employee, but NO active
  -- occupancy row for that locker_number in any category.
  SELECT COUNT(*) INTO activate_needed
  FROM public.lockers l
  WHERE l.deleted_at IS NULL
    AND l.status::text ILIKE 'active'
    AND (
      (l.employee_name IS NOT NULL AND btrim(l.employee_name) <> '')
      OR (l.badge_number IS NOT NULL AND btrim(l.badge_number) <> '')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.locker_occupancy o
      WHERE o.locker_number = l.locker_number
        AND o.status ILIKE 'active'
    );

  RETURN jsonb_build_object(
    'terminate_needed', terminate_needed,
    'activate_needed', activate_needed,
    'duplicates', duplicates
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_occupancy_drift() TO authenticated;
