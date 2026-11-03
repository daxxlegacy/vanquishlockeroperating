ALTER TABLE public.terminations ADD COLUMN termination_type text, ADD COLUMN reason_code text, ADD COLUMN reason_category text, ADD COLUMN reason_detail text;
ALTER TABLE public.locker_occupancy ADD COLUMN termination_type text, ADD COLUMN reason_code text, ADD COLUMN reason_category text;
ALTER TABLE public.terminations ADD CONSTRAINT termination_reason_code_valid CHECK (reason_code IS NULL OR reason_code IN ('RESIGN','AWOL','RTV','OTHER')), ADD CONSTRAINT termination_type_valid CHECK (termination_type IS NULL OR termination_type IN ('Voluntary','Involuntary'));
ALTER TABLE public.locker_occupancy ADD CONSTRAINT occupancy_reason_code_valid CHECK (reason_code IS NULL OR reason_code IN ('RESIGN','AWOL','RTV','OTHER'));
UPDATE public.terminations SET reason_code=reason WHERE reason IN ('AWOL','RESIGN','RTV');
UPDATE public.locker_occupancy o SET reason_code=t.reason_code FROM public.terminations t WHERE o.locker_number=t.locker_number AND o.badge_number=t.badge_number AND o.termination_date=t.termination_date AND lower(o.status) IN ('terminate','terminated') AND t.reason_code IS NOT NULL;
CREATE OR REPLACE VIEW public.locker_occupancy_masked WITH (security_invoker=true) AS SELECT id,category,locker_number,locker_row,locker_unit,locker_location_by_row,key_lock_type,badge_number,employee_name,contact,status,batch_intake_date,termination_date,gradeset,department,remarks,source_filename,created_at,updated_at,CASE WHEN (SELECT public.can_view_national_id(auth.uid())) THEN national_id ELSE public.mask_national_id(national_id) END AS national_id,work_location,termination_type,reason_code,reason_category FROM public.locker_occupancy;
GRANT SELECT ON public.locker_occupancy_masked TO authenticated,service_role;
CREATE INDEX occupancy_reason_terminated_idx ON public.locker_occupancy(reason_code,locker_number) WHERE lower(status) IN ('terminate','terminated');
DO $migration$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.terminate_locker_atomic(uuid,date,text,public.locker_status)'::regprocedure) INTO def;
 ALTER FUNCTION public.terminate_locker_atomic(uuid,date,text,public.locker_status) RENAME TO terminate_locker_atomic_legacy;
 def:=replace(def,'_new_status locker_status DEFAULT ''empty''::locker_status)', '_new_status locker_status DEFAULT ''empty''::locker_status, _termination_type text DEFAULT NULL, _reason_code text DEFAULT NULL, _reason_category text DEFAULT NULL, _reason_detail text DEFAULT NULL)');
 def:=replace(def,'IF _termination_date IS NULL OR _new_status IS NULL THEN', 'IF _termination_type IS NOT NULL AND _termination_type NOT IN (''Voluntary'',''Involuntary'') THEN RAISE EXCEPTION ''Invalid termination type'' USING ERRCODE=''22023''; END IF;
 IF _reason_code IS NOT NULL AND _reason_code NOT IN (''RESIGN'',''AWOL'',''RTV'',''OTHER'') THEN RAISE EXCEPTION ''Invalid reason code'' USING ERRCODE=''22023''; END IF;
 IF _reason_code=''OTHER'' AND _termination_type IS NULL THEN RAISE EXCEPTION ''Termination type is required for OTHER'' USING ERRCODE=''22023''; END IF;
 IF _termination_date IS NULL OR _new_status IS NULL THEN');
 def:=replace(def,'prior_status,prior_employee_name,prior_badge_number)', 'prior_status,prior_employee_name,prior_badge_number,termination_type,reason_code,reason_category,reason_detail)');
 def:=replace(def,'l.status,l.employee_name,l.badge_number)', 'l.status,l.employee_name,l.badge_number,_termination_type,_reason_code,_reason_category,nullif(btrim(_reason_detail),''''))');
 def:=replace(def,'remarks=clean_reason WHERE id=', 'remarks=clean_reason,termination_type=_termination_type,reason_code=_reason_code,reason_category=_reason_category WHERE id=');
 def:=replace(def,'termination_date,remarks,source_filename)', 'termination_date,remarks,source_filename,termination_type,reason_code,reason_category)');
 def:=replace(def,'''manual-termination'') RETURNING', '''manual-termination'',_termination_type,_reason_code,_reason_category) RETURNING');
 def:=replace(def,'IF keeper IS NOT NULL THEN', 'IF keeper IS NOT NULL THEN
 UPDATE public.locker_occupancy SET termination_type=_termination_type,reason_code=_reason_code,reason_category=_reason_category WHERE id=keeper;');
 IF def NOT LIKE '%_termination_type text DEFAULT NULL%' THEN RAISE EXCEPTION 'Atomic signature extension did not apply'; END IF;
 EXECUTE def;
END $migration$;
REVOKE ALL ON FUNCTION public.terminate_locker_atomic_legacy(uuid,date,text,public.locker_status) FROM authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.terminate_locker_atomic(uuid,date,text,public.locker_status,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.terminate_locker_atomic(uuid,date,text,public.locker_status,text,text,text,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.terminate_locker_atomic_legacy(uuid,date,text,public.locker_status) IS 'DEPRECATED: replaced by terminate_locker_atomic with optional reason metadata; not callable by application users.';
DO $migration$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.search_occupancy(text,text,text,text,text,text,integer,integer)'::regprocedure) INTO def;
 ALTER FUNCTION public.search_occupancy(text,text,text,text,text,text,integer,integer) RENAME TO search_occupancy_legacy;
 def:=replace(def,'_offset integer DEFAULT 0)', '_offset integer DEFAULT 0, _reason text DEFAULT ''all''::text)');
 def:=replace(def,'o.remarks, o.source_filename,', 'o.remarks, o.source_filename, o.termination_type,o.reason_code,o.reason_category,');
 def:=replace(def,'NULL::text AS source_filename, true AS __synthetic', 'NULL::text AS source_filename,NULL::text AS termination_type,NULL::text AS reason_code,NULL::text AS reason_category, true AS __synthetic');
 def:=replace(def,'AND ($3 = ''all'' OR category = $3)', 'AND ($5 = ''all'' OR (lower(coalesce(status,'''')) IN (''terminate'',''terminated'') AND reason_code=$5)) AND ($3 = ''all'' OR category = $3)');
 def:=replace(def,'coalesce(_location, ''all'');', 'coalesce(_location, ''all''),coalesce(_reason,''all'');');
 IF def NOT LIKE '%_reason text DEFAULT%' OR def NOT LIKE '%o.reason_code%' THEN RAISE EXCEPTION 'Search extension did not apply'; END IF;
 EXECUTE def;
END $migration$;
REVOKE ALL ON FUNCTION public.search_occupancy_legacy(text,text,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.search_occupancy(text,text,text,text,text,text,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_occupancy(text,text,text,text,text,text,integer,integer,text) TO authenticated,service_role;
COMMENT ON FUNCTION public.search_occupancy_legacy(text,text,text,text,text,text,integer,integer) IS 'DEPRECATED: replaced by reason-filtered search_occupancy preserving the original grouping, sorting and paging.';
CREATE FUNCTION public.get_termination_history_masked(_locker_number text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'page_occupancy')) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('reason_detail',CASE WHEN public.has_role(auth.uid(),'admin') THEN t.reason_detail ELSE NULL END) ORDER BY t.termination_date DESC) FROM public.terminations t WHERE t.locker_number=_locker_number AND t.undone_at IS NULL),'[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.get_termination_history_masked(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_termination_history_masked(text) TO authenticated,service_role;
COMMENT ON COLUMN public.terminations.reason_detail IS 'Admin-only free text. Base table remains admin-only; viewer history RPC always returns null.';