CREATE TABLE public.faq_assistant_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet,
  question text NOT NULL,
  answer text,
  asked_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.faq_assistant_log TO authenticated;
GRANT ALL ON public.faq_assistant_log TO service_role;

ALTER TABLE public.faq_assistant_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and support managers can view FAQ log"
  ON public.faq_assistant_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'manage_support_requests'::app_permission)
  );

CREATE INDEX faq_assistant_log_ip_time_idx
  ON public.faq_assistant_log (ip_address, asked_at DESC);