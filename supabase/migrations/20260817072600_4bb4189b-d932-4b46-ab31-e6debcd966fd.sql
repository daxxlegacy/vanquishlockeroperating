CREATE OR REPLACE FUNCTION public.search_occupancy(_search text DEFAULT ''::text, _status text DEFAULT 'all'::text, _category text DEFAULT 'all'::text, _location text DEFAULT 'all'::text, _sort_col text DEFAULT 'locker'::text, _sort_dir text DEFAULT 'asc'::text, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      ) FROM picked)
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
$function$;

GRANT EXECUTE ON FUNCTION public.search_occupancy(text,text,text,text,text,text,integer,integer) TO supabase_read_only_user;