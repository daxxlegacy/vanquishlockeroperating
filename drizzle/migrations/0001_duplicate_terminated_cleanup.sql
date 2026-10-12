ALTER TABLE public.deletion_audit ADD COLUMN IF NOT EXISTS details jsonb;
ALTER TABLE public.deletion_audit DROP CONSTRAINT IF EXISTS deletion_audit_deletion_kind_check;
ALTER TABLE public.deletion_audit ADD CONSTRAINT deletion_audit_deletion_kind_check
  CHECK (deletion_kind = ANY (ARRAY['locker'::text, 'location'::text, 'occupancy_row'::text]));

CREATE INDEX IF NOT EXISTS idx_occ_status_badge_norm ON public.locker_occupancy (status, (upper(btrim(badge_number))));
CREATE INDEX IF NOT EXISTS idx_occ_status_name_norm ON public.locker_occupancy (status, (upper(btrim(regexp_replace(coalesce(employee_name,''), '\s+', ' ', 'g')))));

CREATE OR REPLACE FUNCTION public.find_duplicate_terminated(match_by text DEFAULT 'badge')
RETURNS TABLE(group_key text, id uuid, locker_number text, employee_name text, badge_number text,
              national_id_masked text, termination_date date, created_at timestamptz, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH term AS (
    SELECT o.*, upper(btrim(o.badge_number)) AS bk,
           upper(btrim(regexp_replace(coalesce(o.employee_name,''), '\s+', ' ', 'g'))) AS nk
    FROM public.locker_occupancy o
    WHERE lower(coalesce(o.status,'')) IN ('terminate','terminated')
  ), badge_dups AS (
    SELECT bk FROM term WHERE coalesce(bk,'') <> '' GROUP BY bk HAVING count(*) > 1
  ), in_badge AS (
    SELECT t.id FROM term t JOIN badge_dups b ON b.bk = t.bk
  ), name_pool AS (
    SELECT * FROM term t WHERE t.nk <> '' AND NOT EXISTS (SELECT 1 FROM in_badge i WHERE i.id = t.id)
  ), name_dups AS (
    SELECT nk FROM name_pool GROUP BY nk HAVING count(*) > 1
  )
  SELECT t.bk, t.id, t.locker_number, t.employee_name, t.badge_number,
         public.mask_national_id(t.national_id), t.termination_date, t.created_at, t.source_filename
  FROM term t JOIN badge_dups b ON b.bk = t.bk
  WHERE coalesce(match_by,'badge') <> 'name'
  UNION ALL
  SELECT t.nk, t.id, t.locker_number, t.employee_name, t.badge_number,
         public.mask_national_id(t.national_id), t.termination_date, t.created_at, t.source_filename
  FROM name_pool t JOIN name_dups n ON n.nk = t.nk
  WHERE match_by = 'name'
  ORDER BY 1, 7 DESC NULLS LAST, 8 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_terminated_occupancy_rows(ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  n_bad int;
  n int;
  actor_email text := (SELECT email FROM public.profiles WHERE id = auth.uid());
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF ids IS NULL OR array_length(ids, 1) IS NULL THEN RETURN 0; END IF;

  SELECT count(*) INTO n_bad FROM unnest(ids) x
   WHERE NOT EXISTS (SELECT 1 FROM public.locker_occupancy o
                      WHERE o.id = x AND lower(coalesce(o.status,'')) IN ('terminate','terminated'));
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'rejected: % id(s) are not terminated occupancy rows', n_bad USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.deletion_audit (deleted_by, deleted_by_email, deletion_kind, locker_number, location,
                                     affected_count, affected_locker_numbers, reason, details)
  SELECT auth.uid(), actor_email, 'occupancy_row', o.locker_number,
         coalesce(o.locker_location_by_row, ''), 1, ARRAY[o.locker_number],
         'duplicate_terminated_cleanup',
         to_jsonb(o) || jsonb_build_object('national_id', public.mask_national_id(o.national_id))
  FROM public.locker_occupancy o WHERE o.id = ANY(ids);

  DELETE FROM public.locker_occupancy o
   WHERE o.id = ANY(ids) AND lower(coalesce(o.status,'')) IN ('terminate','terminated');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_terminated(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_terminated_occupancy_rows(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_terminated(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_terminated_occupancy_rows(uuid[]) TO authenticated;