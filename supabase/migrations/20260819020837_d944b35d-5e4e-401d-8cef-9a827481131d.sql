ALTER VIEW public.lockers_masked SET (security_invoker = true);
ALTER VIEW public.locker_occupancy_masked SET (security_invoker = true);
GRANT SELECT ON public.lockers_masked TO authenticated;
GRANT SELECT ON public.locker_occupancy_masked TO authenticated;