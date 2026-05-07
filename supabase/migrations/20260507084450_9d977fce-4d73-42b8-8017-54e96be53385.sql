
-- Restrict SELECT on sensitive audit/PII tables to admins only
DROP POLICY IF EXISTS "Audit readable by authenticated" ON public.deletion_audit;
CREATE POLICY "Audit readable by admin"
  ON public.deletion_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Runs readable by authenticated" ON public.automation_runs;
CREATE POLICY "Runs readable by admin"
  ON public.automation_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Items readable by authenticated" ON public.automation_run_items;
CREATE POLICY "Items readable by admin"
  ON public.automation_run_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Terminations readable by authenticated" ON public.terminations;
CREATE POLICY "Terminations readable by admin"
  ON public.terminations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
