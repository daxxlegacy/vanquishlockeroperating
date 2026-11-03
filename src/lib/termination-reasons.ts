export const REASON_CODES = ["RESIGN", "AWOL", "RTV", "OTHER"] as const;
export type ReasonCode = typeof REASON_CODES[number];
export type TerminationType = "Voluntary" | "Involuntary";
export const REASON_CATEGORIES = ["Another Job", "Personal Problem", "Attendance Issue", "Further Education", "Medical Reason", "Others"] as const;
export type TerminationMetadata = {
  termination_type?: TerminationType | null;
  reason_code?: ReasonCode | null;
  reason_category?: string | null;
  reason_detail?: string | null;
};
export function mapHrReason(value: unknown): ReasonCode {
  const s = String(value ?? "").trim().toLowerCase();
  if (s.includes("resignation")) return "RESIGN";
  if (s.includes("awol") || s.includes("absence without")) return "AWOL";
  if (s.includes("rtv") || s.includes("return to vendor")) return "RTV";
  return "OTHER";
}
export function mapTerminationType(value: unknown): TerminationType | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (s.includes("involuntary")) return "Involuntary";
  return s.includes("voluntary") ? "Voluntary" : null;
}
export function suggestedType(reason: string): TerminationType | null {
  return reason === "RESIGN" ? "Voluntary" : reason === "AWOL" ? "Involuntary" : null;
}
export function reasonClash(type: TerminationType | null | undefined, code: string | null | undefined): boolean {
  return (type === "Involuntary" && code === "RESIGN") || (type === "Voluntary" && code === "AWOL");
}
export function validTerminationMetadata(meta: TerminationMetadata): boolean {
  return meta.reason_code !== "OTHER" || !!meta.termination_type;
}
export function localDateIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}