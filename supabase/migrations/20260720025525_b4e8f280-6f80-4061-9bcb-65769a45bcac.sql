
CREATE TABLE public.support_bulk_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action text NOT NULL,
  ticket_ids uuid[] NOT NULL DEFAULT '{}',
  ticket_numbers text[] NOT NULL DEFAULT '{}',
  affected_count int NOT NULL DEFAULT 0,
  previous_status text,
  new_status text,
  notify_requested boolean NOT NULL DEFAULT false,
  performed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_bulk_actions TO authenticated;
GRANT ALL ON public.support_bulk_actions TO service_role;

ALTER TABLE public.support_bulk_actions ENABLE ROW LEVEL SECURITY;

-- Anyone who can manage support requests can see the audit trail.
CREATE POLICY "Support managers can view bulk actions"
  ON public.support_bulk_actions
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'manage_support_requests'::app_permission)
  );

-- Insert is limited to the acting user, and only if they can manage support.
CREATE POLICY "Support managers can insert own bulk actions"
  ON public.support_bulk_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    performed_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_permission(auth.uid(), 'manage_support_requests'::app_permission)
    )
  );

CREATE INDEX support_bulk_actions_created_at_idx ON public.support_bulk_actions (created_at DESC);
