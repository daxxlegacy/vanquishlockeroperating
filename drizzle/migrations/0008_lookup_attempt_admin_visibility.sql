ALTER TABLE public.locker_lookup_attempts ADD COLUMN entered_badge text, ADD COLUMN owner_name_snapshot text, ADD COLUMN owner_badge_snapshot text, ADD COLUMN failure_reason text;
REVOKE ALL ON public.locker_lookup_attempts FROM anon;
GRANT SELECT ON public.locker_lookup_attempts TO authenticated;
GRANT ALL ON public.locker_lookup_attempts TO service_role;
CREATE OR REPLACE FUNCTION public.validate_lookup_attempt_log() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.entered_badge := left(btrim(NEW.entered_badge),30);
 IF NEW.success THEN NEW.failure_reason := NULL; END IF;
 IF NEW.failure_reason IS NOT NULL AND NEW.failure_reason NOT IN ('locker_not_found','badge_mismatch','id_mismatch','rate_limited','empty_locker') THEN RAISE EXCEPTION 'Invalid lookup failure reason'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_lookup_attempt_log BEFORE INSERT OR UPDATE ON public.locker_lookup_attempts FOR EACH ROW EXECUTE FUNCTION public.validate_lookup_attempt_log();
CREATE OR REPLACE FUNCTION public.lookup_ip_needs_review(_ip text, _at timestamptz) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT _ip IS NOT NULL AND _ip NOT IN ('','unknown') AND (count(*) FILTER (WHERE NOT success) >= 3 OR count(DISTINCT nullif(upper(btrim(locker_number)),'')) >= 5)
 FROM public.locker_lookup_attempts WHERE ip_address=_ip AND attempted_at BETWEEN _at - interval '1 hour' AND _at;
$$;
REVOKE ALL ON FUNCTION public.lookup_ip_needs_review(text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lookup_ip_needs_review(text,timestamptz) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.search_lookup_attempts(_search text DEFAULT '', _result text DEFAULT 'all', _from timestamptz DEFAULT NULL, _before timestamptz DEFAULT NULL, _offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF _result NOT IN ('all','success','failed') THEN RAISE EXCEPTION 'Invalid result filter'; END IF;
 WITH filtered AS (
 SELECT id,attempted_at,ip_address,locker_number,success,entered_badge,owner_name_snapshot,owner_badge_snapshot,failure_reason
 FROM public.locker_lookup_attempts
 WHERE (_result='all' OR success=(_result='success')) AND (_from IS NULL OR attempted_at>=_from) AND (_before IS NULL OR attempted_at<_before)
 AND (coalesce(_search,'')='' OR strpos(lower(concat_ws(' ',locker_number,entered_badge,owner_name_snapshot,owner_badge_snapshot,ip_address)),lower(_search))>0)
 ), page AS (SELECT * FROM filtered ORDER BY attempted_at DESC,id DESC LIMIT 50 OFFSET greatest(coalesce(_offset,0),0))
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('review',public.lookup_ip_needs_review(p.ip_address,p.attempted_at)) ORDER BY p.attempted_at DESC,p.id DESC) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.search_lookup_attempts(text,text,timestamptz,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_lookup_attempts(text,text,timestamptz,timestamptz,integer) TO authenticated;
CREATE EXTENSION IF NOT EXISTS pg_cron;
