CREATE OR REPLACE VIEW public.locker_occupancy_masked AS
  SELECT id, category, locker_number, locker_row, locker_unit,
    locker_location_by_row, key_lock_type, badge_number, employee_name,
    contact, status, batch_intake_date, termination_date, gradeset,
    department, remarks, source_filename, created_at, updated_at,
    CASE
      WHEN (SELECT public.can_view_national_id(auth.uid())) THEN national_id
      ELSE public.mask_national_id(national_id)
    END AS national_id,
    work_location
  FROM public.locker_occupancy o;

CREATE OR REPLACE VIEW public.lockers_masked AS
  SELECT id, locker_number, unit_type, key_lock, location, row_label,
    badge_number, employee_name, status, physical_key_status,
    spare_key_status, remark, batch_intake, created_at, updated_at,
    deleted_at, deletion_reason, deleted_by, work_location,
    CASE
      WHEN (SELECT public.can_view_national_id(auth.uid())) THEN national_id
      ELSE public.mask_national_id(national_id)
    END AS national_id,
    custom_status
  FROM public.lockers l;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_occ_work_location_trgm
  ON public.locker_occupancy USING gin (work_location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_occ_national_id_trgm
  ON public.locker_occupancy USING gin (national_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_occ_locker_row_trgm
  ON public.locker_occupancy USING gin (locker_row gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lockers_key_lock_trgm
  ON public.lockers USING gin (key_lock gin_trgm_ops);