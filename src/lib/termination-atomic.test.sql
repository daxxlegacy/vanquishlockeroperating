-- Database integration rules. All fixture changes are rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub','79cdd08d-489c-403a-bfa8-452e6fb7ca25',true);
SELECT set_config('request.jwt.claims','{"sub":"79cdd08d-489c-403a-bfa8-452e6fb7ca25","email":"farid@vanquishcapitalsb.com"}',true);
DO $test$
DECLARE
  l public.lockers;
  result jsonb;
  before_key public.key_status;
  other_id uuid;
  n integer;
  baseline integer;
BEGIN
  SELECT * INTO l FROM public.lockers WHERE locker_number='1000D';
  IF l.status <> 'active' THEN RAISE EXCEPTION 'Test fixture 1000D must be active'; END IF;
  before_key := l.spare_key_status;
  SELECT id INTO other_id FROM public.locker_occupancy WHERE locker_number='1000D' AND badge_number='10172863' AND termination_date='2026-09-02';
  IF other_id IS NULL THEN RAISE EXCEPTION 'Other-person history fixture missing'; END IF;
  INSERT INTO public.locker_occupancy(category,locker_number,status,badge_number,employee_name,source_filename)
  VALUES ('staff',' 1000d ',' Active ',l.badge_number,l.employee_name,'atomic-rule-test');
  result := public.terminate_locker_atomic(l.id,'2026-11-03','Atomic rule test','empty','Voluntary','RESIGN','Another Job','Private verification note');
  IF NOT EXISTS(SELECT 1 FROM public.terminations WHERE id=(result->>'termination_id')::uuid AND termination_type='Voluntary' AND reason_code='RESIGN' AND reason_category='Another Job' AND reason_detail='Private verification note' AND reason='Atomic rule test') THEN RAISE EXCEPTION 'Termination metadata missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.locker_occupancy WHERE locker_number=l.locker_number AND badge_number=l.badge_number AND status='Terminate' AND termination_type='Voluntary' AND reason_code='RESIGN' AND reason_category='Another Job') THEN RAISE EXCEPTION 'Occupancy metadata missing'; END IF;
  IF public.get_termination_history_masked(l.locker_number)->0->>'reason_detail' IS DISTINCT FROM 'Private verification note' THEN RAISE EXCEPTION 'Admin detail missing'; END IF;
  SELECT count(*) INTO n FROM public.locker_occupancy WHERE lower(trim(locker_number))='1000d' AND lower(trim(status))='terminate' AND badge_number=l.badge_number;
  IF n<>1 THEN RAISE EXCEPTION 'Normalized multi-category termination expected one row, got %',n; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.locker_occupancy WHERE id=other_id AND termination_date='2026-09-02') THEN RAISE EXCEPTION 'Other-person history was removed'; END IF;
  IF (SELECT spare_key_status FROM public.lockers WHERE id=l.id) IS DISTINCT FROM before_key THEN RAISE EXCEPTION 'Spare key changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.lockers WHERE id=l.id AND (employee_name IS NOT NULL OR badge_number IS NOT NULL OR national_id IS NOT NULL OR batch_intake IS NOT NULL OR remark IS NOT NULL OR work_location IS NOT NULL OR custom_status IS NOT NULL OR status<>'empty')) THEN RAISE EXCEPTION 'Locker not cleared'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.terminations WHERE id=(result->>'termination_id')::uuid AND prior_employee_name=l.employee_name AND prior_badge_number=l.badge_number AND prior_status='active') THEN RAISE EXCEPTION 'Undo snapshot missing'; END IF;
  result := public.terminate_locker_atomic(l.id,'2026-11-03','Retry','empty');
  IF result->>'status'<>'noop' THEN RAISE EXCEPTION 'Retry must return noop'; END IF;
  SELECT count(*) INTO n FROM public.terminations WHERE locker_number=l.locker_number AND termination_date='2026-11-03' AND undone_at IS NULL;
  IF n<>1 THEN RAISE EXCEPTION 'Retry created extra termination'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.terminations WHERE locker_number=l.locker_number AND reason_detail='Private verification note') THEN RAISE EXCEPTION 'Retry lost private detail'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  INSERT INTO public.user_permissions(user_id,permission) VALUES('00000000-0000-0000-0000-000000000002','page_occupancy');
  IF public.get_termination_history_masked(l.locker_number)->0->>'reason_detail' IS NOT NULL THEN RAISE EXCEPTION 'Viewer detail leaked'; END IF;
  PERFORM set_config('request.jwt.claim.sub','79cdd08d-489c-403a-bfa8-452e6fb7ca25',true);

  -- Invalid fallback intake must fail after the history insert and roll it back.
  SELECT * INTO l FROM public.lockers WHERE locker_number='1001C';
  IF l.status <> 'active' THEN RAISE EXCEPTION 'Test fixture 1001C must be active'; END IF;
  DELETE FROM public.locker_occupancy WHERE locker_number=l.locker_number AND lower(trim(status))='active';
  UPDATE public.lockers SET batch_intake='2026-02-31' WHERE id=l.id;
  SELECT count(*) INTO baseline FROM public.terminations WHERE locker_number=l.locker_number;
  BEGIN
    PERFORM public.terminate_locker_atomic(l.id,'2026-11-03','Must fail','empty');
    RAISE EXCEPTION 'Invalid date did not fail';
  EXCEPTION WHEN datetime_field_overflow THEN NULL;
  END;
  IF (SELECT count(*) FROM public.terminations WHERE locker_number=l.locker_number)<>baseline THEN RAISE EXCEPTION 'Failed transaction left history'; END IF;
  IF (SELECT employee_name FROM public.lockers WHERE id=l.id) IS DISTINCT FROM l.employee_name THEN RAISE EXCEPTION 'Failed transaction cleared locker'; END IF;
  UPDATE public.lockers SET batch_intake=l.batch_intake WHERE id=l.id;
  result := public.terminate_locker_atomic(l.id,'2026-11-03','Fallback test','empty');
  IF (SELECT count(*) FROM public.locker_occupancy WHERE locker_number=l.locker_number AND lower(trim(status))='terminate')<>1 THEN RAISE EXCEPTION 'Fallback did not insert exactly one'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.locker_occupancy WHERE locker_number=l.locker_number AND source_filename='manual-termination') THEN RAISE EXCEPTION 'Fallback source missing'; END IF;

  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001"}',true);
  BEGIN
    PERFORM public.terminate_locker_atomic(l.id,'2026-11-03','Not admin','empty');
    RAISE EXCEPTION 'Non-admin was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;
ROLLBACK;