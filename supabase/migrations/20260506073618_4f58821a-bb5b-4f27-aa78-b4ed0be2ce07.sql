ALTER TABLE public.locker_occupancy REPLICA IDENTITY FULL;
ALTER TABLE public.terminations REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.locker_occupancy; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.terminations; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;