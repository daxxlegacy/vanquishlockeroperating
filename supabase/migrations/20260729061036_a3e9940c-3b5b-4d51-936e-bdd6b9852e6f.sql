CREATE OR REPLACE FUNCTION public.reject_blank_occupancy_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(btrim(NEW.employee_name), '') = ''
     AND COALESCE(btrim(NEW.badge_number), '') = ''
     AND COALESCE(btrim(NEW.status), '') = '' THEN
    RAISE EXCEPTION 'blank occupancy row rejected for locker % (no employee name, badge number or status)', NEW.locker_number
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_blank_occupancy_row ON public.locker_occupancy;
CREATE TRIGGER trg_reject_blank_occupancy_row
BEFORE INSERT OR UPDATE ON public.locker_occupancy
FOR EACH ROW EXECUTE FUNCTION public.reject_blank_occupancy_row();