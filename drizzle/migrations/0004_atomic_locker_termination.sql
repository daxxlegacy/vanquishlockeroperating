CREATE UNIQUE INDEX IF NOT EXISTS locker_occupancy_terminate_unique ON public.locker_occupancy (locker_number, COALESCE(lower(trim(badge_number)),''), COALESCE(lower(trim(employee_name)),''), termination_date) WHERE lower(status) IN ('terminate','terminated');
CREATE UNIQUE INDEX IF NOT EXISTS terminations_active_identity_unique ON public.terminations (locker_number, COALESCE(lower(trim(badge_number)),''), termination_date) WHERE undone_at IS NULL;

CREATE OR REPLACE FUNCTION public.terminate_locker_atomic(_locker_id uuid, _termination_date date, _reason text, _new_status public.locker_status DEFAULT 'empty')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  l public.lockers;
  o public.locker_occupancy;
  keeper uuid;
  termination_id uuid;
  active_count integer := 0;
  removed uuid[] := ARRAY[]::uuid[];
  removed_now uuid[];
  badge text;
  employee text;
  locker_key text;
  clean_reason text := nullif(btrim(_reason), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can terminate a locker' USING ERRCODE = '42501';
  END IF;
  IF _termination_date IS NULL OR _new_status IS NULL THEN
    RAISE EXCEPTION 'Termination date and locker status are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM public.lockers WHERE id = _locker_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Locker not found' USING ERRCODE = 'P0002'; END IF;
  locker_key := lower(btrim(l.locker_number));
  badge := lower(btrim(coalesce(l.badge_number,'')));
  employee := lower(btrim(coalesce(l.employee_name,'')));
  IF badge = '' AND employee = '' THEN
    RETURN jsonb_build_object('status','noop','locker',to_jsonb(l),'removed_occupancy_ids',removed,
      'occupancy_rows',coalesce((SELECT jsonb_agg(x) FROM public.locker_occupancy x WHERE lower(btrim(x.locker_number))=locker_key),'[]'::jsonb));
  END IF;

  -- Serialize occupancy writes alongside the locked, authoritative locker snapshot.
  PERFORM id FROM public.locker_occupancy WHERE lower(btrim(locker_number))=locker_key FOR UPDATE;
  SELECT id INTO termination_id FROM public.terminations t
   WHERE lower(btrim(t.locker_number))=locker_key AND t.undone_at IS NULL AND t.termination_date=_termination_date
     AND ((badge<>'' AND lower(btrim(coalesce(t.badge_number,'')))=badge)
       OR (employee<>'' AND lower(btrim(coalesce(t.employee_name,'')))=employee))
   ORDER BY t.created_at DESC,t.id DESC LIMIT 1;
  IF termination_id IS NULL THEN
    INSERT INTO public.terminations (locker_id,locker_number,location,row_label,employee_name,badge_number,termination_date,reason,terminated_by,terminated_by_email,prior_status,prior_employee_name,prior_badge_number)
    VALUES (l.id,l.locker_number,l.location,l.row_label,l.employee_name,l.badge_number,_termination_date,clean_reason,auth.uid(),auth.jwt()->>'email',l.status,l.employee_name,l.badge_number)
    RETURNING id INTO termination_id;
  END IF;

  -- Flip active rows in any category, while avoiding conflicts with an already
  -- saved identical termination. Reused rows keep their source and intake date.
  FOR o IN SELECT * FROM public.locker_occupancy WHERE lower(btrim(locker_number))=locker_key AND lower(btrim(coalesce(status,'')))='active' ORDER BY updated_at DESC,created_at DESC,id DESC LOOP
    active_count := active_count + 1;
    SELECT id INTO keeper FROM public.locker_occupancy x
     WHERE lower(btrim(x.locker_number))=locker_key AND lower(btrim(coalesce(x.status,''))) IN ('terminate','terminated') AND x.termination_date=_termination_date
       AND ((nullif(btrim(o.badge_number),'') IS NOT NULL AND lower(btrim(x.badge_number))=lower(btrim(o.badge_number)))
         OR (nullif(btrim(o.employee_name),'') IS NOT NULL AND lower(btrim(x.employee_name))=lower(btrim(o.employee_name))))
     ORDER BY x.updated_at DESC,x.created_at DESC,x.id DESC LIMIT 1;
    IF keeper IS NULL THEN
      UPDATE public.locker_occupancy SET status='Terminate',termination_date=_termination_date,remarks=clean_reason WHERE id=o.id;
    ELSE
      DELETE FROM public.locker_occupancy WHERE id=o.id;
      removed := array_append(removed,o.id);
      UPDATE public.locker_occupancy SET remarks=clean_reason WHERE id=keeper;
    END IF;
  END LOOP;

  SELECT id INTO keeper FROM public.locker_occupancy x
   WHERE lower(btrim(x.locker_number))=locker_key AND lower(btrim(coalesce(x.status,''))) IN ('terminate','terminated') AND x.termination_date=_termination_date
     AND ((badge<>'' AND lower(btrim(coalesce(x.badge_number,'')))=badge)
       OR (employee<>'' AND lower(btrim(coalesce(x.employee_name,'')))=employee))
   ORDER BY x.updated_at DESC,x.created_at DESC,x.id DESC LIMIT 1;
  IF active_count=0 AND keeper IS NULL THEN
    INSERT INTO public.locker_occupancy (category,locker_number,locker_row,locker_location_by_row,key_lock_type,badge_number,employee_name,national_id,work_location,status,batch_intake_date,termination_date,remarks,source_filename)
    VALUES (coalesce(public.derive_occ_category(l.locker_number),'main'),l.locker_number,l.row_label,l.location,l.key_lock,l.badge_number,l.employee_name,l.national_id,l.work_location,'Terminate',
      CASE WHEN l.batch_intake ~ '^\d{4}-\d{2}-\d{2}$' THEN l.batch_intake::date ELSE NULL END,
      _termination_date,clean_reason,'manual-termination') RETURNING id INTO keeper;
  END IF;
  IF keeper IS NOT NULL THEN
    WITH deleted AS (
      DELETE FROM public.locker_occupancy x
       WHERE lower(btrim(x.locker_number))=locker_key AND lower(btrim(coalesce(x.status,''))) IN ('terminate','terminated') AND x.id<>keeper
         AND ((badge<>'' AND lower(btrim(coalesce(x.badge_number,'')))=badge)
           OR (employee<>'' AND lower(btrim(coalesce(x.employee_name,'')))=employee)) RETURNING id
    ) SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO removed_now FROM deleted;
    removed := removed || removed_now;
  END IF;
  UPDATE public.lockers SET employee_name=NULL,badge_number=NULL,national_id=NULL,batch_intake=NULL,remark=NULL,work_location=NULL,custom_status=NULL,status=_new_status WHERE id=l.id RETURNING * INTO l;
  RETURN jsonb_build_object('status','terminated','termination_id',termination_id,'locker',to_jsonb(l),'removed_occupancy_ids',removed,
    'occupancy_rows',coalesce((SELECT jsonb_agg(x ORDER BY x.created_at,x.id) FROM public.locker_occupancy x WHERE lower(btrim(x.locker_number))=locker_key),'[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.terminate_locker_atomic(uuid,date,text,public.locker_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminate_locker_atomic(uuid,date,text,public.locker_status) TO authenticated, service_role;
COMMENT ON FUNCTION public.terminate_locker_atomic(uuid,date,text,public.locker_status) IS 'Admin-only atomic termination. Locks current occupant, preserves unrelated history and spare keys, and returns final cache state. Errors roll back the whole operation.';