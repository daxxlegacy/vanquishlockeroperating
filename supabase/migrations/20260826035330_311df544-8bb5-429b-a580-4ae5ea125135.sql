-- Duplicate Locker Resolution: per-employee QR generation log + approval RPC.

CREATE TABLE IF NOT EXISTS public.duplicate_resolution_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_number text NOT NULL,
  employee_name text,
  locker_numbers text[] NOT NULL DEFAULT '{}',
  target_url text,
  generated_by uuid NOT NULL,
  generated_by_email text,
  claim_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS duplicate_resolution_requests_badge_idx
  ON public.duplicate_resolution_requests (badge_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.duplicate_resolution_requests TO authenticated;
GRANT ALL ON public.duplicate_resolution_requests TO service_role;

ALTER TABLE public.duplicate_resolution_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Claim managers can read duplicate resolution requests" ON public.duplicate_resolution_requests;
CREATE POLICY "Claim managers can read duplicate resolution requests"
  ON public.duplicate_resolution_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission));

DROP POLICY IF EXISTS "Claim managers can create duplicate resolution requests" ON public.duplicate_resolution_requests;
CREATE POLICY "Claim managers can create duplicate resolution requests"
  ON public.duplicate_resolution_requests FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(), 'admin'::app_role)
               OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission))
              AND generated_by = auth.uid());

DROP POLICY IF EXISTS "Claim managers can update duplicate resolution requests" ON public.duplicate_resolution_requests;
CREATE POLICY "Claim managers can update duplicate resolution requests"
  ON public.duplicate_resolution_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission));

DROP POLICY IF EXISTS "Admins can delete duplicate resolution requests" ON public.duplicate_resolution_requests;
CREATE POLICY "Admins can delete duplicate resolution requests"
  ON public.duplicate_resolution_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.approve_duplicate_resolution(_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c record;
  keep_locker text;
  others text[];
  affected text[] := ARRAY[]::text[];
  l text;
  prior text;
  today date := current_date;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM public.locker_identity_claims WHERE id = _claim_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;

  keep_locker := upper(btrim(coalesce(c.locker_number, '')));

  SELECT array_agg(DISTINCT upper(btrim(x))) INTO others
    FROM unnest(coalesce(c.other_locker_numbers, ARRAY[]::text[])) x
   WHERE btrim(x) <> '' AND upper(btrim(x)) <> keep_locker;

  FOREACH l IN ARRAY coalesce(others, ARRAY[]::text[]) LOOP
    SELECT status::text INTO prior FROM public.lockers
     WHERE upper(btrim(locker_number)) = l AND deleted_at IS NULL LIMIT 1;

    UPDATE public.lockers
       SET status = 'repair'::locker_status,
           custom_status = 'Blocked — duplicate resolved, pending repair check',
           badge_number = NULL,
           employee_name = NULL,
           national_id = NULL,
           remark = 'Released via duplicate locker resolution',
           updated_at = now()
     WHERE upper(btrim(locker_number)) = l AND deleted_at IS NULL;

    UPDATE public.locker_occupancy
       SET status = 'Terminate',
           termination_date = today,
           remarks = 'Released via duplicate locker resolution',
           updated_at = now()
     WHERE upper(btrim(locker_number)) = l
       AND lower(coalesce(status, '')) = 'active';

    INSERT INTO public.status_change_log
      (locker_number, previous_status, new_status, source, changed_by, changed_by_email)
    VALUES (l, prior, 'repair', 'duplicate_locker_resolution', auth.uid(),
            (SELECT email FROM public.profiles WHERE id = auth.uid()));

    affected := affected || l;
  END LOOP;

  UPDATE public.locker_identity_claims
     SET status = 'approved'::locker_claim_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_notes = coalesce(nullif(btrim(admin_notes), '') || E'\n', '')
                       || 'Duplicate resolution approved: kept ' || keep_locker
                       || ', blocked ' || coalesce(array_to_string(affected, ', '), 'none')
     WHERE id = _claim_id;

  UPDATE public.duplicate_resolution_requests
     SET claim_id = _claim_id, resolved_at = now()
   WHERE btrim(lower(badge_number)) = btrim(lower(c.badge_number))
     AND resolved_at IS NULL;

  RETURN jsonb_build_object('kept', keep_locker, 'blocked', affected);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_duplicate_resolution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_duplicate_resolution(uuid) TO authenticated;