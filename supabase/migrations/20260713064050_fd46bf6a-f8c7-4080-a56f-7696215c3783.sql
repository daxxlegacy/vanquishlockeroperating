-- Dedupe active occupancy: only one row per locker_number (across all categories) for active status.
-- Keep the most recently updated row.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY locker_number
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS rn
  FROM public.locker_occupancy
  WHERE status ILIKE 'active'
)
DELETE FROM public.locker_occupancy
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Drop the old per-category unique index; replace with a stricter one on locker_number alone.
DROP INDEX IF EXISTS public.locker_occupancy_active_unique;

CREATE UNIQUE INDEX locker_occupancy_active_locker_unique
  ON public.locker_occupancy (locker_number)
  WHERE status ILIKE 'active';