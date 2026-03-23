// Computes a deterministic idempotency key from a raw webhook body.
// Uses SHA-256 of a canonicalized JSON string (sorted keys).
// Returns "sha256:{hex}" — uses Bun.CryptoHasher, not Node's crypto.

const idempotencyKey = (rawBody) => {
  // Canonical form: keys sorted alphabetically at the top level
  const canonical = JSON.stringify(rawBody, Object.keys(rawBody).sort())
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(canonical)
  const hash = hasher.digest('hex')
  return `sha256:${hash}`
}

export { idempotencyKey }
