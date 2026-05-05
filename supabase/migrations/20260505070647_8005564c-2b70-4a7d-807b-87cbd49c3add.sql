ALTER TABLE public.lockers REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lockers;