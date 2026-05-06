
CREATE TABLE public.locker_occupancy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('main','staff','shoe')),
  locker_number TEXT NOT NULL,
  locker_row TEXT,
  locker_unit TEXT,
  locker_location_by_row TEXT,
  key_lock_type TEXT,
  badge_number TEXT,
  employee_name TEXT,
  contact TEXT,
  status TEXT,
  batch_intake_date DATE,
  termination_date DATE,
  gradeset TEXT,
  department TEXT,
  remarks TEXT,
  source_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locker_occupancy_cat_num ON public.locker_occupancy (category, locker_number);
CREATE INDEX idx_locker_occupancy_employee ON public.locker_occupancy (employee_name);
CREATE INDEX idx_locker_occupancy_badge ON public.locker_occupancy (badge_number);
CREATE INDEX idx_locker_occupancy_status ON public.locker_occupancy (status);

ALTER TABLE public.locker_occupancy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Occupancy readable by authenticated"
  ON public.locker_occupancy FOR SELECT TO authenticated USING (true);

CREATE POLICY "Occupancy insert by admin"
  ON public.locker_occupancy FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Occupancy update by admin"
  ON public.locker_occupancy FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Occupancy delete by admin"
  ON public.locker_occupancy FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_locker_occupancy_updated_at
  BEFORE UPDATE ON public.locker_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
