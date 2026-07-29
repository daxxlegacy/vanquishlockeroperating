DROP POLICY IF EXISTS "Support staff can delete requests" ON public.support_requests;
CREATE POLICY "Support staff can delete requests"
ON public.support_requests
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_permission(auth.uid(), 'manage_support_requests'::public.app_permission)
);