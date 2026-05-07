
DROP POLICY IF EXISTS "Authenticated read upload history" ON public.upload_history;
CREATE POLICY "Admins read upload history"
  ON public.upload_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Remove terminations from realtime publication (table is admin-only via RLS,
-- but realtime broadcasts bypass that for subscribers). Safe if not present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'terminations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.terminations';
  END IF;
END $$;
