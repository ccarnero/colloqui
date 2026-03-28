const PHONE_REGEX = /^\+?\d{10,15}$/;

/**
 * Argentine mobile: Meta webhooks send "549XXXXXXXXXX" (with 9)
 * but the Cloud API send endpoint expects "54XXXXXXXXXX" (without 9).
 * Pattern: 549 + 10 digits = 13 digits total.
 */
function normalizeArgentineNumber(digits: string): string {
  if (/^549\d{10}$/.test(digits)) {
    return `54${digits.slice(3)}`;
  }
  return digits;
}

export type SenderIdType = "phone" | "bsuid" | "unknown";

export interface ParsedSenderId {
  value: string;
  type: SenderIdType;
  normalized: string;
}

/**
 * Determines whether a WhatsApp sender/recipient ID is
 * a phone number (E.164) or a BSUID (Business-Scoped User ID).
 *
 * With WhatsApp Usernames (rolling out June 2026), `from` / `to`
 * fields in webhook payloads may contain a BSUID instead of a phone.
 * BSUID: alphanumeric, up to 128 chars, unique per business+user pair.
 * Phone: digits only, optionally prefixed with +, 10-15 digits.
 *
 * For phone numbers, country-specific normalization is applied
 * (e.g. Argentine 549→54 conversion).
 */
export function parseSenderId(rawId: string | undefined | null): ParsedSenderId {
  if (!rawId || typeof rawId !== "string") {
    return { value: rawId ?? "", type: "unknown", normalized: rawId ?? "" };
  }

  const cleaned = rawId.trim();

  if (PHONE_REGEX.test(cleaned)) {
    const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
    const normalized = normalizeArgentineNumber(digits);
    return { value: normalized, type: "phone", normalized: `+${normalized}` };
  }

  return { value: cleaned, type: "bsuid", normalized: cleaned };
}

/**
 * Normalizes a recipient identifier for outbound messages.
 * Strips leading +, applies country-specific rules, returns
 * digits-only string ready for the Meta Cloud API.
 */
export function normalizeRecipient(rawTo: string): string {
  const { type, value } = parseSenderId(rawTo);
  if (type === "phone") return value;
  return rawTo.trim();
}
