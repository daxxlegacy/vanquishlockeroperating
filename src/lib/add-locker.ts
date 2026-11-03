import { deriveOccCategory, OCC_CATEGORY_SHORT } from "@/lib/locker-category";

export function normalizedNewLockerNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

export function validNewLockerNumber(raw: string): boolean {
  return /^([0-9]+[A-Z]+|[A-Z]+[0-9]+)$/.test(normalizedNewLockerNumber(raw));
}

export function newLockerPayload(number: string, location: string, keyLock: string | null) {
  const locker_number = normalizedNewLockerNumber(number);
  const category = deriveOccCategory(locker_number);
  return {
    locker_number,
    location,
    key_lock: keyLock,
    unit_type: category ? OCC_CATEGORY_SHORT[category] : null,
    status: "empty" as const,
    employee_name: null,
    badge_number: null,
    national_id: null,
    batch_intake: null,
    remark: null,
    row_label: null,
  };
}