
REVOKE EXECUTE ON FUNCTION public.count_occupancy_drift() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_occupancy_drift() FROM anon;
GRANT EXECUTE ON FUNCTION public.count_occupancy_drift() TO authenticated;
