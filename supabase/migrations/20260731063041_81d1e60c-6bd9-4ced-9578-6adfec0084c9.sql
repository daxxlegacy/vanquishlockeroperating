GRANT UPDATE, DELETE ON public.support_request_replies TO authenticated;

CREATE POLICY "Support staff can edit admin replies"
  ON public.support_request_replies FOR UPDATE
  TO authenticated
  USING (author_role = 'admin' AND (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'manage_support_requests'::app_permission)))
  WITH CHECK (author_role = 'admin' AND (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'manage_support_requests'::app_permission)));

CREATE POLICY "Support staff can delete admin replies"
  ON public.support_request_replies FOR DELETE
  TO authenticated
  USING (author_role = 'admin' AND (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'manage_support_requests'::app_permission)));