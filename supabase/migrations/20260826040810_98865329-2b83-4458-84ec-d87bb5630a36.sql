ALTER TABLE public.locker_identity_claims
  ADD COLUMN IF NOT EXISTS source text;

CREATE OR REPLACE FUNCTION public.submit_locker_identity_claim(_claim_type locker_claim_type, _locker_number text, _badge_number text, _full_name text, _contact_number text, _location text, _still_using boolean, _other_locker_numbers text[], _ip text, _source text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
  ip_val inet := NULL;
  recent_count int;
  clean_locker text := upper(trim(coalesce(_locker_number, '')));
  clean_badge text := trim(coalesce(_badge_number, ''));
  clean_name text := trim(coalesce(_full_name, ''));
  clean_contact text := trim(coalesce(_contact_number, ''));
  clean_location text := nullif(trim(coalesce(_location, '')), '');
  clean_source text := nullif(trim(coalesce(_source, '')), '');
  clean_others text[];
BEGIN
  IF clean_locker !~ '^([0-9]+[A-Z]+|[A-Z]+[0-9]+)$' THEN
    RAISE EXCEPTION 'invalid locker_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_badge) = 0 OR char_length(clean_badge) > 60 THEN
    RAISE EXCEPTION 'invalid badge_number' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_name) = 0 OR char_length(clean_name) > 120 THEN
    RAISE EXCEPTION 'invalid full_name' USING ERRCODE = '22023';
  END IF;
  IF char_length(clean_contact) = 0 OR char_length(clean_contact) > 40 THEN
    RAISE EXCEPTION 'invalid contact_number' USING ERRCODE = '22023';
  END IF;
  IF clean_source IS NOT NULL AND char_length(clean_source) > 60 THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  IF _other_locker_numbers IS NOT NULL THEN
    SELECT array_agg(upper(trim(x))) INTO clean_others
      FROM unnest(_other_locker_numbers) x
      WHERE trim(x) <> '';
    IF clean_others IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM unnest(clean_others) y WHERE y !~ '^([0-9]+[A-Z]+|[A-Z]+[0-9]+)$') THEN
        RAISE EXCEPTION 'invalid other_locker_numbers' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  BEGIN
    ip_val := _ip::inet;
  EXCEPTION WHEN others THEN
    ip_val := NULL;
  END;

  IF ip_val IS NOT NULL THEN
    SELECT count(*) INTO recent_count
      FROM public.locker_identity_claims
      WHERE client_ip = ip_val
        AND created_at > now() - interval '10 minutes';
    IF recent_count >= 5 THEN
      RAISE EXCEPTION 'rate limit exceeded' USING ERRCODE = '42901';
    END IF;
  END IF;

  INSERT INTO public.locker_identity_claims
    (claim_type, locker_number, badge_number, full_name, contact_number,
     location, still_using, other_locker_numbers, client_ip, source)
  VALUES
    (_claim_type, clean_locker, clean_badge, clean_name, clean_contact,
     clean_location, _still_using, clean_others, ip_val, clean_source)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('id', new_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_duplicate_resolution(_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  keep_locker text;
  others text[];
  affected text[] := ARRAY[]::text[];
  l text;
  prior text;
  today date := current_date;
  release_status public.locker_status;
  release_custom text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_permission(auth.uid(), 'manage_locker_claims'::app_permission)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM public.locker_identity_claims WHERE id = _claim_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(c.source, '') = 'duplicate_notice' THEN
    release_status := 'repair'::locker_status;
    release_custom := 'Blocked — duplicate resolved, pending repair check';
  ELSE
    release_status := 'empty'::locker_status;
    release_custom := NULL;
  END IF;

  keep_locker := upper(btrim(coalesce(c.locker_number, '')));

  SELECT array_agg(DISTINCT upper(btrim(x))) INTO others
    FROM unnest(coalesce(c.other_locker_numbers, ARRAY[]::text[])) x
   WHERE btrim(x) <> '' AND upper(btrim(x)) <> keep_locker;

  FOREACH l IN ARRAY coalesce(others, ARRAY[]::text[]) LOOP
    SELECT status::text INTO prior FROM public.lockers
     WHERE upper(btrim(locker_number)) = l AND deleted_at IS NULL LIMIT 1;

    UPDATE public.lockers
       SET status = release_status,
           custom_status = release_custom,
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
    VALUES (l, prior, release_status::text, 'duplicate_locker_resolution', auth.uid(),
            (SELECT email FROM public.profiles WHERE id = auth.uid()));

    affected := affected || l;
  END LOOP;

  UPDATE public.locker_identity_claims
     SET status = 'approved'::locker_claim_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         admin_notes = coalesce(nullif(btrim(admin_notes), '') || E'\n', '')
                       || 'Duplicate resolution approved: kept ' || keep_locker
                       || ', released to ' || release_status::text || ': '
                       || coalesce(array_to_string(affected, ', '), 'none')
   WHERE id = _claim_id;

  UPDATE public.duplicate_resolution_requests
     SET claim_id = _claim_id, resolved_at = now()
   WHERE btrim(lower(badge_number)) = btrim(lower(c.badge_number))
     AND resolved_at IS NULL;

  RETURN jsonb_build_object('kept', keep_locker, 'blocked', affected, 'release_status', release_status::text);
END;
$function$;