CREATE OR REPLACE FUNCTION public.mask_national_id(_nid text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _nid IS NULL OR length(_nid) = 0 THEN _nid
    WHEN length(_nid) <= 4 THEN repeat('*', length(_nid))
    ELSE repeat('*', 6) || right(_nid, 4)
  END;
$$;