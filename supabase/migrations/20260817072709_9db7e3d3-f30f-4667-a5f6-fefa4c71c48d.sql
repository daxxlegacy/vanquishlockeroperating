REVOKE EXECUTE ON FUNCTION public.search_occupancy(text,text,text,text,text,text,integer,integer) FROM supabase_read_only_user;
REVOKE EXECUTE ON FUNCTION public.derive_occ_category(text) FROM supabase_read_only_user;
REVOKE EXECUTE ON FUNCTION public.locker_sort_text(text) FROM supabase_read_only_user;
REVOKE EXECUTE ON FUNCTION public.can_view_national_id(uuid) FROM supabase_read_only_user;