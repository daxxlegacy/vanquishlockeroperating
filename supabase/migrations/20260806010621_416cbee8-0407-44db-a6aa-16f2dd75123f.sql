CREATE TABLE public.transfer_swap_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('transfer','swap')),
  locker_number text NOT NULL,
  other_locker_number text,
  occurred_on date NOT NULL DEFAULT (now()::date),
  performed_by uuid,
  performed_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transfer_swap_history TO authenticated;
GRANT ALL ON public.transfer_swap_history TO service_role;

ALTER TABLE public.transfer_swap_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Locker staff can view transfer/swap history"
ON public.transfer_swap_history FOR SELECT TO authenticated
USING (public.can_access_lockers(auth.uid()));

CREATE POLICY "Locker staff can add transfer/swap history"
ON public.transfer_swap_history FOR INSERT TO authenticated
WITH CHECK (public.can_access_lockers(auth.uid()));

CREATE POLICY "Admins can update transfer/swap history"
ON public.transfer_swap_history FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete transfer/swap history"
ON public.transfer_swap_history FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX transfer_swap_history_occurred_on_idx ON public.transfer_swap_history (occurred_on DESC);

CREATE TRIGGER transfer_swap_history_set_updated_at
BEFORE UPDATE ON public.transfer_swap_history
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.transfer_swap_history_clears (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_date date NOT NULL,
  to_date date NOT NULL,
  removed_count integer NOT NULL DEFAULT 0,
  performed_by uuid NOT NULL,
  performed_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.transfer_swap_history_clears TO authenticated;
GRANT ALL ON public.transfer_swap_history_clears TO service_role;

ALTER TABLE public.transfer_swap_history_clears ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view history clears"
ON public.transfer_swap_history_clears FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can log history clears"
ON public.transfer_swap_history_clears FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND performed_by = auth.uid());

-- Backfill: existing swap events recorded in occupancy remarks
INSERT INTO public.transfer_swap_history (event_type, locker_number, other_locker_number, occurred_on, created_at)
SELECT 'swap',
       o.locker_number,
       NULLIF(regexp_replace(o.remarks, '^Swapped (to|from) ', ''), ''),
       COALESCE(o.termination_date, o.batch_intake_date, o.updated_at::date, o.created_at::date),
       o.created_at
FROM public.locker_occupancy o
WHERE o.remarks ILIKE 'Swapped %';

-- Backfill: completed transfer requests
INSERT INTO public.transfer_swap_history (event_type, locker_number, occurred_on, created_at)
SELECT 'transfer',
       COALESCE(NULLIF(btrim(s.locker_number), ''), '—'),
       COALESCE(s.resolved_at, s.updated_at, s.created_at)::date,
       s.created_at
FROM public.support_requests s
WHERE s.request_type = 'transfer_locker'::public.support_request_type
  AND s.status = 'resolved'::public.support_request_status;