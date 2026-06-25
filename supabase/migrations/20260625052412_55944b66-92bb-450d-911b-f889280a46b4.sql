ALTER TABLE public.lockers ADD COLUMN IF NOT EXISTS custom_status TEXT;
CREATE INDEX IF NOT EXISTS idx_lockers_custom_status ON public.lockers (custom_status) WHERE custom_status IS NOT NULL;