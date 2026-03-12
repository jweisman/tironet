/**
 * Phone number utilities for Israeli numbers.
 * Storage format: E.164 (e.g. +972501234567)
 * Display format: Israeli (e.g. 050-123-4567)
 */

/** Convert Israeli display format to E.164 for storage/Twilio. */
export function toE164(phone: string): string | null {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // Already has country code
  if (digits.startsWith("972") && digits.length === 12) {
    return `+${digits}`;
  }
  // Local Israeli format: 05x... (10 digits)
  if (digits.startsWith("0") && digits.length === 10) {
    return `+972${digits.slice(1)}`;
  }
  return null;
}

/** Convert E.164 to Israeli display format. */
export function toIsraeliDisplay(e164: string): string {
  // +972501234567 → 050-123-4567
  const digits = e164.replace(/^\+972/, "0");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return e164;
}

/** Validate that a string is a valid Israeli phone number (any format). */
export function isValidIsraeliPhone(phone: string): boolean {
  return toE164(phone) !== null;
}
