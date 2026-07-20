
-- 1) map_layouts: restrict SELECT to users with locker access instead of every authenticated user
DROP POLICY IF EXISTS "Authenticated can read map layout" ON public.map_layouts;
CREATE POLICY "Locker-authorized can read map layout"
  ON public.map_layouts
  FOR SELECT
  TO authenticated
  USING (public.can_access_lockers(auth.uid()));

-- 2) Remove sensitive tables from the realtime publication.
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_permissions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.deletion_audit;
ALTER PUBLICATION supabase_realtime DROP TABLE public.terminations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.automation_runs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.automation_run_items;
