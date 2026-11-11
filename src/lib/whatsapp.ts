// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Normalize a phone number to E.164-ish digits for wa.me links.
// Defaults to Malaysia (60) when no country code is present.
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D+/g, "");
  if (!digits) return null;

  if (hadPlus) {
    // Already international.
    return digits;
  }
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  // Assume Malaysian local number.
  return `60${digits}`;
}

export function buildWhatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
