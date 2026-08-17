-- Natural sort key for locker numbers, mirroring the app's lockerSortKey().
CREATE OR REPLACE FUNCTION public.locker_sort_text(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  s text := upper(btrim(coalesce(_raw, '')));
  m text[];
BEGIN
  IF s = '' THEN RETURN '9'; END IF;

  m := regexp_match(s, '^([0-9]+)([A-Z]*)$');
  IF m IS NOT NULL THEN
    RETURN '0' || lpad(m[1], 8, '0') || m[2];
  END IF;

  m := regexp_match(s, '^(LK)([0-9]+)$');
  IF m IS NOT NULL THEN
    RETURN '2LK' || lpad(m[2], 8, '0');
  END IF;

  m := regexp_match(s, '^([A-Z])([0-9]+)$');
  IF m IS NOT NULL THEN
    RETURN '1' || m[1] || lpad(m[2], 8, '0');
  END IF;

  m := regexp_match(s, '^([A-Z]{2,})([0-9]+)$');
  IF m IS NOT NULL THEN
    RETURN '3' || lpad(length(m[1])::text, 2, '0') || m[1] || lpad(m[2], 8, '0');
  END IF;

  RETURN '9' || s;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_lockers_sort_text ON public.lockers (public.locker_sort_text(locker_number));

-- Category derivation, mirroring deriveOccCategory() in the app.
CREATE OR REPLACE FUNCTION public.derive_occ_category(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n text := upper(regexp_replace(coalesce(_raw, ''), '\s', '', 'g'));
  m text[];
BEGIN
  IF n = '' THEN RETURN NULL; END IF;

  m := regexp_match(n, '^LK([0-9]{2})$');
  IF m IS NOT NULL THEN
    IF m[1]::int BETWEEN 1 AND 40 THEN RETURN 'hr'; ELSE RETURN NULL; END IF;
  END IF;

  IF n ~ '^[0-9]+[A-Z]+$' THEN RETURN 'main'; END IF;

  m := regexp_match(n, '^([A-Z]+)([0-9]+)$');
  IF m IS NOT NULL THEN
    IF length(m[1]) = 1 THEN
      IF m[1] = 'Z' THEN RETURN NULL; ELSE RETURN 'shoe'; END IF;
    ELSIF length(m[1]) BETWEEN 2 AND 3 THEN
      RETURN 'staff';
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------- Lockers page
CREATE OR REPLACE FUNCTION public.search_lockers(
  _search text DEFAULT '',
  _status text DEFAULT 'all',
  _location text DEFAULT 'all',
  _key_lock text DEFAULT 'all',
  _missing_nid boolean DEFAULT false,
  _missing_badge boolean DEFAULT false,
  _status_in text[] DEFAULT NULL,
  _location_in text[] DEFAULT NULL,
  _sort_col text DEFAULT 'num',
  _sort_dir text DEFAULT 'asc',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order text;
  v_where text;
  v_where_noflags text;
  v_sql text;
  v_res jsonb;
BEGIN
  _limit := least(greatest(coalesce(_limit, 100), 1), 1000);
  _offset := greatest(coalesce(_offset, 0), 0);

  v_order := CASE _sort_col
    WHEN 'loc' THEN 'location'
    WHEN 'key_lock' THEN 'key_lock'
    WHEN 'badge' THEN 'badge_number'
    WHEN 'nid' THEN 'national_id'
    WHEN 'emp' THEN 'employee_name'
    WHEN 'work' THEN 'work_location'
    WHEN 'status' THEN 'status::text'
    WHEN 'batch' THEN 'batch_intake'
    WHEN 'row' THEN 'row_label'
    ELSE 'public.locker_sort_text(locker_number)'
  END;
  v_order := v_order || CASE WHEN lower(coalesce(_sort_dir, 'asc')) = 'desc'
    THEN ' DESC NULLS LAST' ELSE ' ASC NULLS LAST' END;

  v_where := $w$
    deleted_at IS NULL
    AND (coalesce($1, '') = ''
         OR locker_number ILIKE '%' || $1 || '%'
         OR coalesce(employee_name, '') ILIKE '%' || $1 || '%'
         OR coalesce(badge_number, '') ILIKE '%' || $1 || '%'
         OR coalesce(key_lock, '') ILIKE '%' || $1 || '%')
    AND ($2 = 'all'
         OR ($2 LIKE 'custom:%' AND coalesce(btrim(custom_status), '') = substr($2, 8))
         OR ($2 NOT LIKE 'custom:%' AND status::text = $2 AND coalesce(btrim(custom_status), '') = ''))
    AND ($3 = 'all' OR location = $3)
    AND ($4 = 'all'
         OR ($4 = '__none__' AND coalesce(btrim(key_lock), '') = '')
         OR ($4 <> '__none__' AND btrim(coalesce(key_lock, '')) = $4))
    AND (NOT $5 OR (status::text = 'active' AND coalesce(btrim(national_id), '') = ''))
    AND (NOT $6 OR (status::text = 'active' AND coalesce(btrim(badge_number), '') = ''))
    AND ($7 IS NULL OR status::text = ANY($7))
    AND ($8 IS NULL OR location = ANY($8))
  $w$;

  v_where_noflags := replace(replace(v_where, 'NOT $5', 'NOT false'), 'NOT $6', 'NOT false');

  v_sql :=
    'WITH base AS (SELECT * FROM public.lockers_masked WHERE ' || v_where || '), '
    || 'base_all AS (SELECT * FROM public.lockers_masked WHERE ' || v_where_noflags || '), '
    || 'page AS (SELECT b.*, row_number() OVER (ORDER BY ' || v_order || ') AS __rn '
    || '         FROM base b ORDER BY ' || v_order || ' LIMIT ' || _limit || ' OFFSET ' || _offset || ') '
    || 'SELECT jsonb_build_object('
    || '  ''rows'', coalesce((SELECT jsonb_agg(to_jsonb(p) - ''__rn'' ORDER BY p.__rn) FROM page p), ''[]''::jsonb),'
    || '  ''total'', (SELECT count(*) FROM base),'
    || '  ''missing_nid'', (SELECT count(*) FROM base_all WHERE status::text = ''active'' AND coalesce(btrim(national_id), '''') = ''''),'
    || '  ''missing_badge'', (SELECT count(*) FROM base_all WHERE status::text = ''active'' AND coalesce(btrim(badge_number), '''') = '''')'
    || ')';

  EXECUTE v_sql
    INTO v_res
    USING coalesce(_search, ''), coalesce(_status, 'all'), coalesce(_location, 'all'),
          coalesce(_key_lock, 'all'), coalesce(_missing_nid, false), coalesce(_missing_badge, false),
          _status_in, _location_in;

  RETURN v_res;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.locker_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'locations', coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT location AS v FROM public.lockers WHERE deleted_at IS NULL AND location IS NOT NULL
      ) s), '[]'::jsonb),
    'key_locks', coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT btrim(key_lock) AS v FROM public.lockers
        WHERE deleted_at IS NULL AND coalesce(btrim(key_lock), '') <> ''
      ) s), '[]'::jsonb),
    'custom_statuses', coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT btrim(custom_status) AS v FROM public.lockers
        WHERE deleted_at IS NULL AND coalesce(btrim(custom_status), '') <> ''
      ) s), '[]'::jsonb),
    'total', (SELECT count(*) FROM public.lockers WHERE deleted_at IS NULL)
  );
$$;

-- ------------------------------------------------------------- Spare keys page
CREATE OR REPLACE FUNCTION public.search_spare_keys(
  _search text DEFAULT '',
  _spare text DEFAULT 'all',
  _location text DEFAULT 'all',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH eligible AS (
    SELECT * FROM public.lockers_masked
    WHERE deleted_at IS NULL
      AND coalesce(key_lock, '') !~* 'numeric'
  ), base AS (
    SELECT * FROM eligible
    WHERE (coalesce(_search, '') = ''
           OR locker_number ILIKE '%' || _search || '%'
           OR location ILIKE '%' || _search || '%')
      AND (coalesce(_spare, 'all') = 'all'
           OR coalesce(spare_key_status::text, 'unknown') = _spare)
      AND (coalesce(_location, 'all') = 'all' OR location = _location)
  ), page AS (
    SELECT b.*, row_number() OVER (ORDER BY public.locker_sort_text(locker_number)) AS __rn
    FROM base b
    ORDER BY public.locker_sort_text(locker_number)
    LIMIT least(greatest(coalesce(_limit, 100), 1), 1000)
    OFFSET greatest(coalesce(_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - '__rn' ORDER BY p.__rn) FROM page p), '[]'::jsonb),
    'total', (SELECT count(*) FROM base),
    'eligible_total', (SELECT count(*) FROM eligible),
    'counts', coalesce((SELECT jsonb_object_agg(k, c) FROM (
        SELECT coalesce(spare_key_status::text, 'unknown') AS k, count(*) AS c
        FROM eligible GROUP BY 1
      ) s), '{}'::jsonb),
    'locations', coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT location AS v FROM eligible WHERE location IS NOT NULL
      ) s), '[]'::jsonb)
  );
$$;

-- -------------------------------------------------------------- Occupancy page
CREATE OR REPLACE FUNCTION public.search_occupancy(
  _search text DEFAULT '',
  _status text DEFAULT 'all',
  _category text DEFAULT 'all',
  _location text DEFAULT 'all',
  _sort_col text DEFAULT 'locker',
  _sort_dir text DEFAULT 'asc',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sort text;
  v_dir text;
  v_sql text;
  v_res jsonb;
BEGIN
  _limit := least(greatest(coalesce(_limit, 100), 1), 1000);
  _offset := greatest(coalesce(_offset, 0), 0);

  v_sort := CASE _sort_col
    WHEN 'status' THEN 'max(coalesce(status, ''''))'
    WHEN 'badge' THEN 'max(coalesce(badge_number, ''''))'
    WHEN 'emp' THEN 'max(coalesce(employee_name, ''''))'
    WHEN 'nid' THEN 'max(coalesce(national_id, ''''))'
    WHEN 'intake' THEN 'max(coalesce(batch_intake_date::text, ''''))'
    WHEN 'term' THEN 'max(coalesce(termination_date::text, ''''))'
    WHEN 'work' THEN 'max(coalesce(work_location, ''''))'
    WHEN 'cat' THEN 'max(coalesce(category, ''''))'
    ELSE 'max(public.locker_sort_text(locker_number))'
  END;
  v_dir := CASE WHEN lower(coalesce(_sort_dir, 'asc')) = 'desc' THEN ' DESC' ELSE ' ASC' END;

  v_sql :=
  $q$
  WITH occ AS (
    SELECT o.id::text AS id, o.category, o.locker_number, o.locker_row, o.locker_unit,
           o.locker_location_by_row, o.key_lock_type, o.badge_number, o.employee_name,
           o.national_id, o.work_location, o.contact, o.status, o.batch_intake_date,
           o.termination_date, o.gradeset, o.department, o.remarks, o.source_filename,
           false AS __synthetic
    FROM public.locker_occupancy_masked o
  ), synth AS (
    SELECT 'synthetic-' || l.id::text AS id,
           coalesce(public.derive_occ_category(l.locker_number), 'main') AS category,
           l.locker_number, l.row_label AS locker_row, NULL::text AS locker_unit,
           l.location AS locker_location_by_row, l.key_lock AS key_lock_type,
           CASE WHEN l.status::text = 'active' THEN l.badge_number END AS badge_number,
           CASE WHEN l.status::text = 'active' THEN l.employee_name END AS employee_name,
           CASE WHEN l.status::text = 'active' THEN l.national_id END AS national_id,
           CASE WHEN l.status::text = 'active' THEN l.work_location END AS work_location,
           NULL::text AS contact,
           CASE WHEN l.status::text = 'active' THEN 'Active' ELSE coalesce(l.status::text, 'vacant') END AS status,
           NULL::date AS batch_intake_date, NULL::date AS termination_date,
           NULL::text AS gradeset, NULL::text AS department, l.remark AS remarks,
           NULL::text AS source_filename, true AS __synthetic
    FROM public.lockers_masked l
    WHERE l.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.locker_occupancy o2 WHERE o2.locker_number = l.locker_number)
  ), all_rows AS (
    SELECT * FROM occ UNION ALL SELECT * FROM synth
  ), base AS (
    SELECT * FROM all_rows
    WHERE ($2 = 'all'
           OR ($2 = 'active' AND lower(coalesce(status, '')) = 'active')
           OR ($2 = 'terminate' AND lower(coalesce(status, '')) IN ('terminate', 'terminated'))
           OR ($2 = 'vacant' AND lower(coalesce(status, '')) IN ('', 'vacant', 'empty')))
      AND ($3 = 'all' OR category = $3)
      AND ($4 = 'all' OR coalesce(locker_location_by_row, '') = $4)
      AND (coalesce($1, '') = ''
           OR locker_number ILIKE '%' || $1 || '%'
           OR coalesce(employee_name, '') ILIKE '%' || $1 || '%'
           OR coalesce(badge_number, '') ILIKE '%' || $1 || '%'
           OR coalesce(national_id, '') ILIKE '%' || $1 || '%'
           OR coalesce(work_location, '') ILIKE '%' || $1 || '%'
           OR coalesce(locker_row, '') ILIKE '%' || $1 || '%'
           OR coalesce(locker_location_by_row, '') ILIKE '%' || $1 || '%')
  ), kinds AS (
    SELECT b.*,
           CASE WHEN lower(coalesce(status, '')) = 'active' THEN 1
                WHEN lower(coalesce(status, '')) IN ('terminate', 'terminated') THEN 2
                ELSE 3 END AS kind
    FROM base b
  ), ranked AS (
    SELECT k.*, row_number() OVER (
      PARTITION BY locker_number, kind
      ORDER BY termination_date DESC NULLS LAST, id
    ) AS rn
    FROM kinds k
  ), picked AS (
    SELECT r.* FROM ranked r
    WHERE r.rn = 1
      AND (r.kind <= 2
           OR NOT EXISTS (SELECT 1 FROM ranked r2
                          WHERE r2.locker_number = r.locker_number AND r2.kind <= 2))
  ), pages AS (
    SELECT locker_number, %SORT% AS sk
    FROM picked GROUP BY locker_number
    ORDER BY sk %DIR%
    LIMIT %LIMIT% OFFSET %OFFSET%
  ), page_rows AS (
    SELECT p.*, g.sk FROM picked p JOIN pages g USING (locker_number)
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(x) - 'sk' - 'kind' - 'rn'
                                       ORDER BY x.sk %DIR%, x.kind, x.termination_date DESC NULLS LAST)
                      FROM page_rows x), '[]'::jsonb),
    'total', (SELECT count(DISTINCT locker_number) FROM picked),
    'stats', (SELECT jsonb_build_object(
        'total', count(*),
        'unique_lockers', count(DISTINCT locker_number),
        'active', count(*) FILTER (WHERE lower(coalesce(status, '')) = 'active'),
        'terminated', count(*) FILTER (WHERE lower(coalesce(status, '')) IN ('terminate', 'terminated'))
      ) FROM all_rows)
  )
  $q$;

  v_sql := replace(v_sql, '%SORT%', v_sort);
  v_sql := replace(v_sql, '%DIR%', v_dir);
  v_sql := replace(v_sql, '%LIMIT%', _limit::text);
  v_sql := replace(v_sql, '%OFFSET%', _offset::text);

  EXECUTE v_sql
    INTO v_res
    USING coalesce(_search, ''), coalesce(_status, 'all'), coalesce(_category, 'all'), coalesce(_location, 'all');

  RETURN v_res;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.occupancy_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'locations', coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (
        SELECT DISTINCT locker_location_by_row AS v FROM public.locker_occupancy
        WHERE coalesce(btrim(locker_location_by_row), '') <> ''
        UNION
        SELECT DISTINCT location AS v FROM public.lockers
        WHERE deleted_at IS NULL AND coalesce(btrim(location), '') <> ''
      ) s), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.search_lockers(text, text, text, text, boolean, boolean, text[], text[], text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.locker_facets() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_spare_keys(text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_occupancy(text, text, text, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.occupancy_facets() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.locker_sort_text(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.derive_occ_category(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_lockers(text, text, text, text, boolean, boolean, text[], text[], text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.locker_facets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_spare_keys(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_occupancy(text, text, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.occupancy_facets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.locker_sort_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.derive_occ_category(text) TO authenticated, service_role;