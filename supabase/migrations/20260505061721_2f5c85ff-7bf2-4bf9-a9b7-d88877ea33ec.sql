-- Termination undo support: snapshot prior state, mark when undone
ALTER TABLE public.terminations
  ADD COLUMN IF NOT EXISTS prior_status public.locker_status,
  ADD COLUMN IF NOT EXISTS prior_employee_name text,
  ADD COLUMN IF NOT EXISTS prior_badge_number text,
  ADD COLUMN IF NOT EXISTS undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by uuid;

-- Allow admins to update terminations (needed to mark undone)
DO $$ BEGIN
  CREATE POLICY "Terminations update by admin"
    ON public.terminations FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helpful indexes for audit search
CREATE INDEX IF NOT EXISTS idx_terminations_locker_number ON public.terminations (locker_number);
CREATE INDEX IF NOT EXISTS idx_terminations_employee_name ON public.terminations (employee_name);
CREATE INDEX IF NOT EXISTS idx_terminations_termination_date ON public.terminations (termination_date);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_locker_number ON public.deletion_audit (locker_number);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_location ON public.deletion_audit (location);