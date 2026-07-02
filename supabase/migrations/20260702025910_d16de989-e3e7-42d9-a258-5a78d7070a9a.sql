-- Step 1: Add new permission label so it commits before being referenced.
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'view_national_id';