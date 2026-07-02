
CREATE TABLE public.locker_lookup_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address TEXT,
  locker_number TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.locker_lookup_attempts TO authenticated;
GRANT ALL ON public.locker_lookup_attempts TO service_role;

ALTER TABLE public.locker_lookup_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view lookup attempts"
ON public.locker_lookup_attempts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX idx_locker_lookup_attempts_ip_time
  ON public.locker_lookup_attempts (ip_address, attempted_at DESC);
CREATE INDEX idx_locker_lookup_attempts_time
  ON public.locker_lookup_attempts (attempted_at DESC);
