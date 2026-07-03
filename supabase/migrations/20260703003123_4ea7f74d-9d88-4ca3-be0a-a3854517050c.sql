
-- Revoke anon/PUBLIC EXECUTE on SECURITY DEFINER functions; keep only required grants.

-- Trigger functions: only owner/service_role need EXECUTE
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_support_request_on_reply() FROM PUBLIC, anon, authenticated;

-- Authorization helpers: authenticated only
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_permission(uuid, public.app_permission) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.app_permission) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_view_national_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_national_id(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_access_lockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_lockers(uuid) TO authenticated, service_role;

-- Admin/user-facing RPCs: authenticated only (function enforces role checks)
REVOKE ALL ON FUNCTION public.reveal_national_id(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_national_id(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.transfer_locker(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_locker(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.swap_lockers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_lockers(uuid, uuid) TO authenticated, service_role;

-- Public-facing support RPCs are only invoked via edge functions using service_role
REVOKE ALL ON FUNCTION public.submit_support_request(public.support_request_type, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_support_request(public.support_request_type, text, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.get_support_ticket_public(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_public(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.add_support_ticket_reply_public(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_support_ticket_reply_public(text, text, text) TO service_role;
