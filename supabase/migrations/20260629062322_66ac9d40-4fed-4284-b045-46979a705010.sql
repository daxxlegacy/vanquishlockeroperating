CREATE TABLE public.map_layouts (
  id text PRIMARY KEY,
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_layouts TO authenticated;
GRANT ALL ON public.map_layouts TO service_role;
ALTER TABLE public.map_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read map layout" ON public.map_layouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert map layout" ON public.map_layouts FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update map layout" ON public.map_layouts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete map layout" ON public.map_layouts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER map_layouts_set_updated_at BEFORE UPDATE ON public.map_layouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.map_layouts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.map_layouts;