-- 1. Soft delete fields on lockers
ALTER TABLE public.lockers
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deletion_reason TEXT,
  ADD COLUMN deleted_by UUID;

CREATE INDEX idx_lockers_deleted_at ON public.lockers(deleted_at);

-- 2. deletion_audit table
CREATE TABLE public.deletion_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_by UUID NOT NULL,
  deleted_by_email TEXT,
  deletion_kind TEXT NOT NULL CHECK (deletion_kind IN ('locker', 'location')),
  locker_id UUID,
  locker_number TEXT,
  location TEXT NOT NULL,
  affected_count INTEGER NOT NULL DEFAULT 1,
  affected_locker_numbers TEXT[],
  reason TEXT NOT NULL,
  undone_at TIMESTAMPTZ,
  undone_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deletion_audit_created_at ON public.deletion_audit(created_at DESC);

ALTER TABLE public.deletion_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Audit readable by authenticated"
  ON public.deletion_audit FOR SELECT TO authenticated USING (true);

CREATE POLICY "Audit insert by admin"
  ON public.deletion_audit FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Audit update by admin"
  ON public.deletion_audit FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. terminations table
CREATE TABLE public.terminations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locker_id UUID,
  locker_number TEXT NOT NULL,
  location TEXT,
  row_label TEXT,
  employee_name TEXT,
  badge_number TEXT,
  termination_date DATE NOT NULL,
  reason TEXT,
  terminated_by UUID NOT NULL,
  terminated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_terminations_date ON public.terminations(termination_date DESC);
CREATE INDEX idx_terminations_employee ON public.terminations(employee_name);

ALTER TABLE public.terminations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Terminations readable by authenticated"
  ON public.terminations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Terminations insert by admin"
  ON public.terminations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Update locker SELECT policy: hide soft-deleted from non-admins
DROP POLICY IF EXISTS "Authenticated can read lockers" ON public.lockers;

CREATE POLICY "Read active lockers"
  ON public.lockers FOR SELECT TO authenticated
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'));