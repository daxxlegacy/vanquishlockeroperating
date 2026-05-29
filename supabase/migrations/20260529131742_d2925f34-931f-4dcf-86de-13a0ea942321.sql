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