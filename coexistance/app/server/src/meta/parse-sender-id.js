// Determines whether a WhatsApp sender ID is a phone number (E.164) or a BSUID.
//
// With WhatsApp Usernames (rolling out June 2026), the `from` and `to` fields
// in webhook payloads may contain a BSUID instead of a phone number.
// BSUID: alphanumeric, up to 128 chars, unique per business+user pair.
// Phone: digits only, optionally prefixed with +, 10-15 digits.
//
// This function NEVER assumes format — it detects and returns a tagged result.

const PHONE_REGEX = /^\+?\d{10,15}$/

// Argentine mobile numbers: Meta webhooks send "549XXXXXXXXXX" (with 9)
// but the send API expects "54XXXXXXXXXX" (without 9).
// 549 + 2-4 digit area code + 8-6 digit number = always 13 digits total.
const normalizeArgentineNumber = (num) => {
  // Match: 549 followed by 10 digits (area code + number without the leading 15)
  if (/^549\d{10}$/.test(num)) {
    return '54' + num.slice(3)
  }
  return num
}

const parseSenderId = (rawId) => {
  if (!rawId || typeof rawId !== 'string') {
    return { value: rawId, type: 'unknown' }
  }

  const cleaned = rawId.trim()

  if (PHONE_REGEX.test(cleaned)) {
    const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned
    const normalized = normalizeArgentineNumber(digits)

    return {
      value: normalized,
      type: 'phone',
      normalized: `+${normalized}`,
    }
  }

  // Anything that isn't a clean phone number is treated as BSUID
  return {
    value: cleaned,
    type: 'bsuid',
    normalized: cleaned,
  }
}

export { parseSenderId }
