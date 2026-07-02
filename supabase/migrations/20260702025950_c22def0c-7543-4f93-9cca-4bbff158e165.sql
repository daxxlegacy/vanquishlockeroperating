-- =========================================================================
-- National ID protection: access log, reveal RPC (with rate limit), masking
-- helpers, and masked views.
-- =========================================================================

-- 1) Access log table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.national_id_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record_id    uuid NOT NULL,
  table_name   text NOT NULL,
  accessed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nid_log_user_time
  ON public.national_id_access_log (user_id, accessed_at DESC);

GRANT SELECT ON public.national_id_access_log TO authenticated;
GRANT ALL ON public.national_id_access_log TO service_role;

ALTER TABLE public.national_id_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view NID access log" ON public.national_id_access_log;
CREATE POLICY "Admins view NID access log"
  ON public.national_id_access_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Permission helper ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_national_id(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id
        AND permission = 'view_national_id'::public.app_permission
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_national_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_national_id(uuid) TO authenticated, service_role;

-- 3) Masking helper -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_national_id(_nid text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _nid IS NULL OR length(_nid) = 0 THEN _nid
    WHEN length(_nid) <= 4 THEN repeat('*', length(_nid))
    ELSE repeat('*', 6) || right(_nid, 4)
  END;
$$;

-- 4) Reveal RPC (rate-limited) -------------------------------------------
CREATE OR REPLACE FUNCTION public.reveal_national_id(_record_id uuid, _table_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid  uuid := auth.uid();
  recent_count int;
  nid text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.can_view_national_id(uid) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Best-effort rate limit: 20 reveals per 5 minutes per user.
  SELECT count(*) INTO recent_count
  FROM public.national_id_access_log
  WHERE user_id = uid
    AND accessed_at > now() - interval '5 minutes';

  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'rate limit exceeded: too many National ID reveals in the last 5 minutes'
      USING ERRCODE = '42901';
  END IF;

  IF _table_name = 'lockers' THEN
    SELECT national_id INTO nid FROM public.lockers WHERE id = _record_id;
  ELSIF _table_name = 'locker_occupancy' THEN
    SELECT national_id INTO nid FROM public.locker_occupancy WHERE id = _record_id;
  ELSE
    RAISE EXCEPTION 'unsupported table: %', _table_name;
  END IF;

  INSERT INTO public.national_id_access_log (user_id, record_id, table_name)
  VALUES (uid, _record_id, _table_name);

  RETURN nid;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_national_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reveal_national_id(uuid, text) TO authenticated;

-- 5) Masked views ---------------------------------------------------------
CREATE OR REPLACE VIEW public.lockers_masked
WITH (security_invoker = true) AS
SELECT
  l.id, l.locker_number, l.unit_type, l.key_lock, l.location, l.row_label,
  l.badge_number, l.employee_name, l.status, l.physical_key_status,
  l.spare_key_status, l.remark, l.batch_intake, l.created_at, l.updated_at,
  l.deleted_at, l.deletion_reason, l.deleted_by, l.work_location,
  CASE WHEN public.can_view_national_id(auth.uid())
       THEN l.national_id
       ELSE public.mask_national_id(l.national_id)
  END AS national_id,
  l.custom_status
FROM public.lockers l;

GRANT SELECT ON public.lockers_masked TO authenticated;
GRANT ALL ON public.lockers_masked TO service_role;

CREATE OR REPLACE VIEW public.locker_occupancy_masked
WITH (security_invoker = true) AS
SELECT
  o.id, o.category, o.locker_number, o.locker_row, o.locker_unit,
  o.locker_location_by_row, o.key_lock_type, o.badge_number, o.employee_name,
  o.contact, o.status, o.batch_intake_date, o.termination_date, o.gradeset,
  o.department, o.remarks, o.source_filename, o.created_at, o.updated_at,
  CASE WHEN public.can_view_national_id(auth.uid())
       THEN o.national_id
       ELSE public.mask_national_id(o.national_id)
  END AS national_id,
  o.work_location
FROM public.locker_occupancy o;

GRANT SELECT ON public.locker_occupancy_masked TO authenticated;
GRANT ALL ON public.locker_occupancy_masked TO service_role;