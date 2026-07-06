
CREATE TABLE public.status_change_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  locker_id uuid,
  locker_number text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  source text NOT NULL DEFAULT 'bulk_upload',
  changed_by uuid NOT NULL,
  changed_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.status_change_log TO authenticated;
GRANT ALL ON public.status_change_log TO service_role;
ALTER TABLE public.status_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status_change_log_admin_select" ON public.status_change_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "status_change_log_admin_insert" ON public.status_change_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) AND changed_by = auth.uid());
CREATE INDEX idx_status_change_log_created_at ON public.status_change_log (created_at DESC);
CREATE INDEX idx_status_change_log_locker_number ON public.status_change_log (locker_number);
