// Dedicated Transfer & Swap history log shown on the Reconcile page.
// Intentionally separate from `terminations` and `locker_occupancy` so that
// clearing this history never touches termination or occupancy data.
import { supabase } from "@/integrations/supabase/client";

export type TransferSwapEventType = "transfer" | "swap";

export interface TransferSwapSide {
  employeeName?: string | null;
  badgeNumber?: string | null;
  nationalId?: string | null;
}

export interface TransferSwapEventInput {
  eventType: TransferSwapEventType;
  lockerNumber: string;
  otherLockerNumber?: string | null;
  occurredOn?: string; // yyyy-mm-dd
  /** Occupant snapshot for `lockerNumber` (side A). */
  sideA?: TransferSwapSide;
  /** Occupant snapshot for `otherLockerNumber` (side B) — swaps only. */
  sideB?: TransferSwapSide;
}

/**
 * Insert ONE history row per event. For a swap this single row carries both
 * lockers and both occupants — never one row per side. A database trigger
 * (`trg_skip_duplicate_transfer_swap_event`) silently drops an identical
 * insert made within 10 seconds as a safety net against double submits.
 */
export async function logTransferSwapEvent(input: TransferSwapEventInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("transfer_swap_history").insert({
    event_type: input.eventType,
    locker_number: input.lockerNumber,
    other_locker_number: input.otherLockerNumber ?? null,
    occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
    employee_a: input.sideA?.employeeName ?? null,
    badge_a: input.sideA?.badgeNumber ?? null,
    national_id_a: input.sideA?.nationalId ?? null,
    employee_b: input.sideB?.employeeName ?? null,
    badge_b: input.sideB?.badgeNumber ?? null,
    national_id_b: input.sideB?.nationalId ?? null,
    performed_by: auth.user?.id ?? null,
    performed_by_email: auth.user?.email ?? null,
  } as never);
  if (error) console.warn("[transfer-swap-history] log failed:", error.message);
}

