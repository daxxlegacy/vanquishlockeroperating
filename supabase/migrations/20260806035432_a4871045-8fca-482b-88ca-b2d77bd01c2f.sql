CREATE OR REPLACE FUNCTION public.skip_duplicate_transfer_swap_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.transfer_swap_history h
    WHERE h.event_type = NEW.event_type
      AND h.occurred_on = NEW.occurred_on
      AND h.created_at > now() - interval '10 seconds'
      AND upper(btrim(coalesce(h.locker_number, ''))) = upper(btrim(coalesce(NEW.locker_number, '')))
      AND upper(btrim(coalesce(h.other_locker_number, ''))) = upper(btrim(coalesce(NEW.other_locker_number, '')))
      AND lower(btrim(coalesce(h.badge_a, ''))) = lower(btrim(coalesce(NEW.badge_a, '')))
      AND lower(btrim(coalesce(h.badge_b, ''))) = lower(btrim(coalesce(NEW.badge_b, '')))
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_locker(_from_id uuid, _to_id uuid, _old_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src public.lockers;
  tgt public.lockers;
  new_old_status public.locker_status;
  new_spare public.key_status;
  actor_email text := auth.jwt() ->> 'email';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF _from_id < _to_id THEN
    SELECT * INTO src FROM public.lockers WHERE id = _from_id FOR UPDATE;
    SELECT * INTO tgt FROM public.lockers WHERE id = _to_id FOR UPDATE;
  ELSE
    SELECT * INTO tgt FROM public.lockers WHERE id = _to_id FOR UPDATE;
    SELECT * INTO src FROM public.lockers WHERE id = _from_id FOR UPDATE;
  END IF;

  IF src.id IS NULL THEN RAISE EXCEPTION 'source locker not found'; END IF;
  IF tgt.id IS NULL THEN RAISE EXCEPTION 'target locker not found'; END IF;
  IF src.deleted_at IS NOT NULL OR tgt.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'locker has been deleted';
  END IF;
  IF COALESCE(btrim(src.employee_name), '') = '' AND COALESCE(btrim(src.badge_number), '') = '' THEN
    RAISE EXCEPTION 'source locker has no occupant';
  END IF;
  IF tgt.status = 'active' THEN
    RAISE EXCEPTION 'target locker is not available (status=%)', tgt.status;
  END IF;
  IF COALESCE(btrim(tgt.employee_name), '') <> '' OR COALESCE(btrim(tgt.badge_number), '') <> '' THEN
    RAISE EXCEPTION 'target locker is already occupied';
  END IF;
  IF _old_action = 'active' THEN
    RAISE EXCEPTION 'old locker cannot be set to active';
  END IF;

  BEGIN
    new_old_status := _old_action::public.locker_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'unknown old action: %', _old_action;
  END;

  new_spare := src.spare_key_status;
  IF _old_action = 'find_spare_key' THEN
    new_spare := 'missing'::public.key_status;
  END IF;

  INSERT INTO public.transfer_swap_history (
    event_type, locker_number, other_locker_number, occurred_on,
    employee_a, badge_a, national_id_a, performed_by, performed_by_email
  ) VALUES (
    'transfer', tgt.locker_number, src.locker_number, CURRENT_DATE,
    src.employee_name, src.badge_number, src.national_id, auth.uid(), actor_email
  );

  UPDATE public.lockers
  SET employee_name = src.employee_name,
      badge_number = src.badge_number,
      national_id = src.national_id,
      work_location = src.work_location,
      batch_intake = src.batch_intake,
      remark = src.remark,
      status = 'active'::public.locker_status,
      updated_at = now()
  WHERE id = tgt.id
  RETURNING * INTO tgt;

  UPDATE public.lockers
  SET employee_name = NULL,
      badge_number = NULL,
      national_id = NULL,
      work_location = NULL,
      batch_intake = NULL,
      status = new_old_status,
      spare_key_status = new_spare,
      updated_at = now()
  WHERE id = src.id
  RETURNING * INTO src;

  RETURN jsonb_build_object('from', to_jsonb(src), 'to', to_jsonb(tgt));
END;
$$;

CREATE OR REPLACE FUNCTION public.swap_lockers(_a_id uuid, _b_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a public.lockers;
  b public.lockers;
  a_emp text; a_badge text; a_nid text; a_bi text; a_wl text; a_rem text;
  a_status public.locker_status;
  actor_email text := auth.jwt() ->> 'email';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  IF _a_id = _b_id THEN
    RAISE EXCEPTION 'cannot swap a locker with itself';
  END IF;

  IF _a_id < _b_id THEN
    SELECT * INTO a FROM public.lockers WHERE id = _a_id FOR UPDATE;
    SELECT * INTO b FROM public.lockers WHERE id = _b_id FOR UPDATE;
  ELSE
    SELECT * INTO b FROM public.lockers WHERE id = _b_id FOR UPDATE;
    SELECT * INTO a FROM public.lockers WHERE id = _a_id FOR UPDATE;
  END IF;

  IF a.id IS NULL THEN RAISE EXCEPTION 'locker A not found'; END IF;
  IF b.id IS NULL THEN RAISE EXCEPTION 'locker B not found'; END IF;
  IF a.deleted_at IS NOT NULL OR b.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'locker has been deleted';
  END IF;

  INSERT INTO public.transfer_swap_history (
    event_type, locker_number, other_locker_number, occurred_on,
    employee_a, badge_a, national_id_a,
    employee_b, badge_b, national_id_b,
    performed_by, performed_by_email
  ) VALUES (
    'swap', a.locker_number, b.locker_number, CURRENT_DATE,
    a.employee_name, a.badge_number, a.national_id,
    b.employee_name, b.badge_number, b.national_id,
    auth.uid(), actor_email
  );

  a_emp := a.employee_name;
  a_badge := a.badge_number;
  a_nid := a.national_id;
  a_bi := a.batch_intake;
  a_wl := a.work_location;
  a_rem := a.remark;
  a_status := a.status;

  UPDATE public.lockers SET
    employee_name = b.employee_name,
    badge_number = b.badge_number,
    national_id = b.national_id,
    batch_intake = b.batch_intake,
    work_location = b.work_location,
    remark = b.remark,
    status = b.status,
    updated_at = now()
  WHERE id = _a_id
  RETURNING * INTO a;

  UPDATE public.lockers SET
    employee_name = a_emp,
    badge_number = a_badge,
    national_id = a_nid,
    batch_intake = a_bi,
    work_location = a_wl,
    remark = a_rem,
    status = a_status,
    updated_at = now()
  WHERE id = _b_id
  RETURNING * INTO b;

  RETURN jsonb_build_object('a', to_jsonb(a), 'b', to_jsonb(b));
END;
$$;