-- Revoke broad EXECUTE on SECURITY DEFINER functions, then re-grant only to the roles that need to call them.
-- Trigger-only functions (called by Postgres internally, never by clients): revoke from everyone.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- RLS helper functions (must remain callable by authenticated for policy evaluation; not needed by anon).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_access_lockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_lockers(uuid) TO authenticated;

-- Admin RPCs (internal has_role check enforces admin; only authenticated users should reach them).
REVOKE EXECUTE ON FUNCTION public.transfer_locker(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_locker(uuid, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.swap_lockers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_lockers(uuid, uuid) TO authenticated;