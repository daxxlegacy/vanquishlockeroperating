DO $migration$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.terminate_locker_atomic(uuid,date,text,public.locker_status,text,text,text,text)'::regprocedure) INTO def;
 def:=replace(def,'IF _reason_code=''OTHER'' AND _termination_type IS NULL THEN RAISE EXCEPTION ''Termination type is required for OTHER'' USING ERRCODE=''22023''; END IF;','-- Type is required for OTHER only by manual termination forms; HR metadata remains faithful to the file.');
 EXECUTE def;
END $migration$;