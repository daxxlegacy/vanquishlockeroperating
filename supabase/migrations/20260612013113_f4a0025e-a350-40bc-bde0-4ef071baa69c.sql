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
  IF src.employee_name IS NULL AND src.badge_number IS NULL THEN
    RAISE EXCEPTION 'source locker has no occupant';
  END IF;
  IF tgt.status NOT IN ('empty','cleaning','repair') THEN
    RAISE EXCEPTION 'target locker is not available (status=%)', tgt.status;
  END IF;
  IF tgt.employee_name IS NOT NULL OR tgt.badge_number IS NOT NULL THEN
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

  UPDATE public.lockers
  SET employee_name = src.employee_name,
      badge_number = src.badge_number,
      batch_intake = src.batch_intake,
      remark = src.remark,
      status = 'active'::public.locker_status,
      updated_at = now()
  WHERE id = tgt.id
  RETURNING * INTO tgt;

  UPDATE public.lockers
  SET employee_name = NULL,
      badge_number = NULL,
      batch_intake = NULL,
      status = new_old_status,
      spare_key_status = new_spare,
      updated_at = now()
  WHERE id = src.id
  RETURNING * INTO src;

  RETURN jsonb_build_object(
    'from', to_jsonb(src),
    'to', to_jsonb(tgt)
  );
END;
$$;