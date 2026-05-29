
CREATE OR REPLACE FUNCTION public.can_access_lockers(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_permissions
      WHERE user_id = _user_id
        AND permission IN (
          'page_lockers','page_map','page_spare_keys','page_occupancy',
          'page_duplicates','page_reconcile','page_operations',
          'locker_management','termination_actions'
        )
    )
$$;

GRANT EXECUTE ON FUNCTION public.can_access_lockers(uuid) TO authenticated;

DROP POLICY IF EXISTS "Read active lockers" ON public.lockers;
CREATE POLICY "Read active lockers"
ON public.lockers
FOR SELECT
TO authenticated
USING (
  (deleted_at IS NULL AND public.can_access_lockers(auth.uid()))
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Occupancy readable by authenticated" ON public.locker_occupancy;
CREATE POLICY "Occupancy readable by authorized"
ON public.locker_occupancy
FOR SELECT
TO authenticated
USING (public.can_access_lockers(auth.uid()));
