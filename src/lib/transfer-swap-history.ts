// Dedicated Transfer & Swap history log shown on the Reconcile page.
// Intentionally separate from `terminations` and `locker_occupancy` so that
// clearing this history never touches termination or occupancy data.
import { supabase } from "@/integrations/supabase/client";

export type TransferSwapEventType = "transfer" | "swap";

export interface TransferSwapEventInput {
  eventType: TransferSwapEventType;
  lockerNumber: string;
  otherLockerNumber?: string | null;
  occurredOn?: string; // yyyy-mm-dd
}

export async function logTransferSwapEvent(input: TransferSwapEventInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("transfer_swap_history").insert({
    event_type: input.eventType,
    locker_number: input.lockerNumber,
    other_locker_number: input.otherLockerNumber ?? null,
    occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
    performed_by: auth.user?.id ?? null,
    performed_by_email: auth.user?.email ?? null,
  });
  if (error) console.warn("[transfer-swap-history] log failed:", error.message);
}
