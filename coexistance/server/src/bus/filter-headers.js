// Filters HTTP headers to a known-safe allowlist.
// Normalizes all header keys to lowercase before filtering.
// Returns a new object — does not mutate the input.

const DEFAULT_ALLOWLIST = [
  'content-type',
  'x-hub-signature-256',
  'x-hub-signature',
  'x-request-id',
  'user-agent',
]

const filterHeaders = (headers, allowlist = DEFAULT_ALLOWLIST) => {
  const result = {}

  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase()
    if (allowlist.includes(normalized)) {
      result[normalized] = value
    }
  }

  return result
}

export { filterHeaders }
