// Support Requests helpers: typed row + realtime count hook for the AppHeader badge.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";

export type SupportRequestType = "transfer_locker" | "cant_find_locker" | "other";
export type SupportRequestStatus = "new" | "in_progress" | "resolved";

export type SupportRequest = {
  id: string;
  ticket_number: string;
  created_at: string;
  updated_at: string;
  request_type: SupportRequestType;
  name: string;
  badge_number: string;
  locker_number: string | null;
  contact_number: string;
  message: string;
  status: SupportRequestStatus;
  resolved_by: string | null;
  resolved_at: string | null;
};

export type SupportRequestReply = {
  id: string;
  request_id: string;
  author_role: "admin" | "user";
  author_id: string | null;
  author_name: string | null;
  message: string;
  created_at: string;
};

export const REQUEST_TYPE_LABEL: Record<SupportRequestType, string> = {
  transfer_locker: "Locker transfer",
  cant_find_locker: "Can't find locker",
  other: "Other",
};

export const STATUS_LABEL: Record<SupportRequestStatus, string> = {
  new: "New",
  in_progress: "In progress",
  resolved: "Resolved",
};

/** Live count of `status='new'` support requests. Returns 0 for users
 *  without permission — RLS makes the count query return no rows. */
export function useNewSupportRequestsCount() {
  const { user } = useAuth();
  const { has, loaded } = usePermissions();
  const canView = has("page_support_requests") || has("manage_support_requests");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user || !loaded || !canView) { setCount(0); return; }
    let cancelled = false;

    const refetch = async () => {
      const { count: c } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string, o: { count: "exact"; head: true }) => {
            eq: (col: string, v: string) => Promise<{ count: number | null }>;
          };
        };
      })
        .from("support_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "new");
      if (!cancelled) setCount(c ?? 0);
    };

    refetch();

    const channel = supabase
      .channel("support-requests-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_requests" },
        () => { refetch(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, loaded, canView]);

  return count;
}
