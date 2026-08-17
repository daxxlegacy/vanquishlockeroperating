CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_lockers_location ON public.lockers (location);
CREATE INDEX IF NOT EXISTS idx_lockers_status ON public.lockers (status);
CREATE INDEX IF NOT EXISTS idx_lockers_key_lock ON public.lockers (key_lock);
CREATE INDEX IF NOT EXISTS idx_lockers_deleted_at ON public.lockers (deleted_at);
CREATE INDEX IF NOT EXISTS idx_lockers_locker_number ON public.lockers (locker_number);
CREATE INDEX IF NOT EXISTS idx_lockers_locker_number_trgm ON public.lockers USING gin (locker_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lockers_employee_name_trgm ON public.lockers USING gin (employee_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lockers_badge_number_trgm ON public.lockers USING gin (badge_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_occ_category_locker ON public.locker_occupancy (category, locker_number);
CREATE INDEX IF NOT EXISTS idx_occ_status ON public.locker_occupancy (status);
CREATE INDEX IF NOT EXISTS idx_occ_locker_number_trgm ON public.locker_occupancy USING gin (locker_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_occ_employee_name_trgm ON public.locker_occupancy USING gin (employee_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_occ_badge_number_trgm ON public.locker_occupancy USING gin (badge_number gin_trgm_ops);