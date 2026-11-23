CREATE OR REPLACE FUNCTION public.bulk_spare_key_status(_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; l public.lockers%ROWTYPE; next_status public.key_status; outcomes jsonb := '[]'::jsonb; email text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(_changes) > 500 THEN RAISE EXCEPTION 'Expected at most 500 changes'; END IF;
  SELECT p.email INTO email FROM public.profiles p WHERE p.id = auth.uid();
  FOR item IN SELECT value FROM jsonb_array_elements(_changes) ORDER BY value->>'id' LOOP
    SELECT * INTO l FROM public.lockers WHERE id = (item->>'id')::uuid AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',item->>'id','outcome','skipped','reason','Locker not found')); CONTINUE; END IF;
    IF coalesce(l.key_lock,'') ~* 'numeric' THEN outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',l.id,'outcome','skipped','reason','Skipped – numeric lock (no spare key)')); CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.key_status)) s WHERE s::text = item->>'new_status') THEN outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',l.id,'outcome','error','reason','Invalid status')); CONTINUE; END IF;
    next_status := (item->>'new_status')::public.key_status;
    IF l.spare_key_status = next_status THEN outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',l.id,'outcome','skipped','reason','Already that status')); CONTINUE; END IF;
    IF l.spare_key_status::text IS DISTINCT FROM item->>'previous_status' THEN outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',l.id,'outcome','skipped','reason','Status changed since preview; upload again')); CONTINUE; END IF;
    INSERT INTO public.status_change_log (locker_id,locker_number,previous_status,new_status,source,changed_by,changed_by_email) VALUES (l.id,l.locker_number,l.spare_key_status::text,next_status::text,'bulk_spare_key',auth.uid(),email);
    UPDATE public.lockers SET spare_key_status = next_status WHERE id = l.id RETURNING * INTO l;
    outcomes := outcomes || jsonb_build_array(jsonb_build_object('id',l.id,'outcome','updated','locker',to_jsonb(l)));
  END LOOP;
  RETURN outcomes;
END $$;
REVOKE ALL ON FUNCTION public.bulk_spare_key_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_spare_key_status(jsonb) TO authenticated;
COMMENT ON FUNCTION public.bulk_spare_key_status(jsonb) IS 'Admin-only spare-key changes with numeric-lock and optimistic-concurrency guards; audit and updates commit atomically.';