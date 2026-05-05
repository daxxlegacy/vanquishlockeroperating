-- Automation run history + per-user admin permissions

CREATE TYPE public.app_permission AS ENUM (
  'locker_management',
  'termination_actions',
  'upload_roster',
  'run_automation'
);

CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL DEFAULT 'auto_terminate',
  filename text,
  candidates_count integer NOT NULL DEFAULT 0,
  terminated_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT false,
  reason text,
  termination_date date,
  executed_by uuid NOT NULL,
  executed_by_email text,
  undone_at timestamptz,
  undone_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Runs readable by authenticated" ON public.automation_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Runs insert by admin" ON public.automation_runs
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Runs update by admin" ON public.automation_runs
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.automation_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  termination_id uuid,
  locker_id uuid,
  locker_number text,
  location text,
  row_label text,
  employee_name text,
  badge_number text,
  prior_status text,
  succeeded boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_run_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Items readable by authenticated" ON public.automation_run_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Items insert by admin" ON public.automation_run_items
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Items update by admin" ON public.automation_run_items
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_run_items_run_id ON public.automation_run_items(run_id);

-- Per-user granular permissions (additive on top of role)
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission app_permission NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permissions viewable by self or admin" ON public.user_permissions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage permissions" ON public.user_permissions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission app_permission)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_permissions
    WHERE user_id = _user_id AND permission = _permission
  ) OR public.has_role(_user_id, 'admin'::app_role);
$$;