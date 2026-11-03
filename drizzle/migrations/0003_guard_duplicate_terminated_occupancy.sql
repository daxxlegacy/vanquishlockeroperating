CREATE UNIQUE INDEX IF NOT EXISTS locker_occupancy_terminate_unique
ON public.locker_occupancy (locker_number, COALESCE(lower(trim(badge_number)),''), COALESCE(lower(trim(employee_name)),''), termination_date)
WHERE lower(status) IN ('terminate','terminated');

CREATE OR REPLACE FUNCTION public.insert_terminated_occupancy_if_absent(_row jsonb)
RETURNS SETOF public.locker_occupancy
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE r public.locker_occupancy;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  r := jsonb_populate_record(NULL::public.locker_occupancy, _row);
  IF NOT (coalesce(lower(r.status),'') IN ('terminate','terminated')) THEN RAISE EXCEPTION 'Only terminated occupancy may be inserted'; END IF;
  IF EXISTS (SELECT 1 FROM public.locker_occupancy o WHERE o.locker_number=r.locker_number AND lower(o.status) IN ('terminate','terminated') AND o.termination_date IS NOT DISTINCT FROM r.termination_date AND ((nullif(lower(trim(r.badge_number)),'') IS NOT NULL AND lower(trim(o.badge_number))=lower(trim(r.badge_number))) OR (nullif(lower(trim(r.employee_name)),'') IS NOT NULL AND lower(trim(o.employee_name))=lower(trim(r.employee_name))))) THEN RETURN; END IF;
  RETURN QUERY INSERT INTO public.locker_occupancy(category,locker_number,locker_row,locker_location_by_row,key_lock_type,badge_number,employee_name,national_id,work_location,status,batch_intake_date,termination_date,remarks,source_filename)
  VALUES(r.category,r.locker_number,r.locker_row,r.locker_location_by_row,r.key_lock_type,r.badge_number,r.employee_name,r.national_id,r.work_location,'Terminate',r.batch_intake_date,r.termination_date,r.remarks,r.source_filename)
  ON CONFLICT DO NOTHING RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.insert_terminated_occupancy_if_absent(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_terminated_occupancy_if_absent(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_terminated_occupancy_if_absent(jsonb) TO service_role;