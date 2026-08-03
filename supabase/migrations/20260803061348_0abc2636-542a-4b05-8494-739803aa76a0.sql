DROP POLICY IF EXISTS "Roles viewable by self or admin" ON public.user_roles;
CREATE POLICY "Roles viewable by self or admin"
ON public.user_roles FOR SELECT TO authenticated
USING ((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.user_roles FROM anon;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;