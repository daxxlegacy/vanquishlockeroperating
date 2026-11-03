CREATE TABLE public.locker_number_rename_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 description text NOT NULL,
 performed_by uuid NOT NULL,
 performed_by_email text NOT NULL,
 locker_count integer NOT NULL,
 mapping jsonb NOT NULL,
 verification jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.locker_number_rename_audit TO authenticated;
GRANT ALL ON public.locker_number_rename_audit TO service_role;
ALTER TABLE public.locker_number_rename_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read locker rename audits" ON public.locker_number_rename_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
COMMENT ON TABLE public.locker_number_rename_audit IS 'Immutable locker number rename mapping and verification; data changes performed atomically through maintenance tools.';