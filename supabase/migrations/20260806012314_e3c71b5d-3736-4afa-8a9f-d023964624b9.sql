ALTER TABLE public.transfer_swap_history
  ADD COLUMN IF NOT EXISTS employee_a text,
  ADD COLUMN IF NOT EXISTS badge_a text,
  ADD COLUMN IF NOT EXISTS national_id_a text,
  ADD COLUMN IF NOT EXISTS employee_b text,
  ADD COLUMN IF NOT EXISTS badge_b text,
  ADD COLUMN IF NOT EXISTS national_id_b text;

CREATE OR REPLACE FUNCTION public.skip_duplicate_transfer_swap_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a text := upper(btrim(coalesce(NEW.locker_number, '')));
  b text := upper(btrim(coalesce(NEW.other_locker_number, '')));
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.transfer_swap_history h
    WHERE h.event_type = NEW.event_type
      AND h.occurred_on = NEW.occurred_on
      AND h.created_at > now() - interval '10 seconds'
      AND least(upper(btrim(coalesce(h.locker_number,''))), upper(btrim(coalesce(h.other_locker_number,''))))
          = least(a, b)
      AND greatest(upper(btrim(coalesce(h.locker_number,''))), upper(btrim(coalesce(h.other_locker_number,''))))
          = greatest(a, b)
      AND lower(btrim(coalesce(h.badge_a,''))) = lower(btrim(coalesce(NEW.badge_a,'')))
      AND lower(btrim(coalesce(h.badge_b,''))) = lower(btrim(coalesce(NEW.badge_b,'')))
  ) THEN
    RETURN NULL; -- silently skip duplicate write
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skip_duplicate_transfer_swap_event ON public.transfer_swap_history;
CREATE TRIGGER trg_skip_duplicate_transfer_swap_event
  BEFORE INSERT ON public.transfer_swap_history
  FOR EACH ROW EXECUTE FUNCTION public.skip_duplicate_transfer_swap_event();