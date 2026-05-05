ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'cleaning';
ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'broken_door';
ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'reserved';