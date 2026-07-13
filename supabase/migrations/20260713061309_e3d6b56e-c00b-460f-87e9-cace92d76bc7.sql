
-- 1. Delete "empty" duplicate rows where a richer sibling exists with same
--    (category, locker_number, status). "Richer" = has badge_number populated.
DELETE FROM public.locker_occupancy a
USING public.locker_occupancy b
WHERE a.id <> b.id
  AND a.category = b.category
  AND a.locker_number = b.locker_number
  AND coalesce(a.status,'') = coalesce(b.status,'')
  AND a.badge_number IS NULL
  AND b.badge_number IS NOT NULL;

-- 2. Delete remaining true duplicates keeping the earliest id per
--    (category, locker_number, status, badge_number, employee_name, termination_date)
DELETE FROM public.locker_occupancy o
USING (
  SELECT category, locker_number, coalesce(status,'') AS s,
         coalesce(badge_number,'') AS b, coalesce(employee_name,'') AS e,
         coalesce(termination_date::text,'') AS t,
         min(id::text) AS keep_id
  FROM public.locker_occupancy
  GROUP BY 1,2,3,4,5,6
  HAVING count(*) > 1
) d
WHERE o.category = d.category
  AND o.locker_number = d.locker_number
  AND coalesce(o.status,'') = d.s
  AND coalesce(o.badge_number,'') = d.b
  AND coalesce(o.employee_name,'') = d.e
  AND coalesce(o.termination_date::text,'') = d.t
  AND o.id::text <> d.keep_id;

-- 3. Any leftover collisions on (category, locker_number, status) for active
--    rows — keep the one with the most recent updated_at.
DELETE FROM public.locker_occupancy o
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY category, locker_number
           ORDER BY updated_at DESC, created_at DESC, id
         ) AS rn
  FROM public.locker_occupancy
  WHERE status ILIKE 'active'
) d
WHERE o.id = d.id AND d.rn > 1;

-- 4. Prevent recurrence: at most one Active row per (category, locker_number).
CREATE UNIQUE INDEX IF NOT EXISTS locker_occupancy_active_unique
  ON public.locker_occupancy (category, locker_number)
  WHERE status ILIKE 'active';
