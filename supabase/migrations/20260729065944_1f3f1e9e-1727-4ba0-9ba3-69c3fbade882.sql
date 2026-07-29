UPDATE public.locker_occupancy
SET category = CASE
  WHEN locker_number ~ '^LK(0[1-9]|[1-3][0-9]|40)$' THEN 'hr'
  WHEN locker_number ~ '^[0-9]+[A-Z]+$' THEN 'main'
  WHEN locker_number ~ '^[A-Z]{2,3}[0-9]+$' THEN 'staff'
  WHEN locker_number ~ '^[A-Y][0-9]+$' THEN 'shoe'
  ELSE category
END,
updated_at = now()
WHERE category IS DISTINCT FROM (CASE
  WHEN locker_number ~ '^LK(0[1-9]|[1-3][0-9]|40)$' THEN 'hr'
  WHEN locker_number ~ '^[0-9]+[A-Z]+$' THEN 'main'
  WHEN locker_number ~ '^[A-Z]{2,3}[0-9]+$' THEN 'staff'
  WHEN locker_number ~ '^[A-Y][0-9]+$' THEN 'shoe'
  ELSE category
END);