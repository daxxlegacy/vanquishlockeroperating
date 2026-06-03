ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'returning_locker';
ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'reset';
ALTER TYPE public.locker_status ADD VALUE IF NOT EXISTS 'done_reset';