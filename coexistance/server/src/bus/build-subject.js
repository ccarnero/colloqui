// Builds a NATS subject string from envelope routing fields.
// Format: evt.{tenant}.{producer}.{domain}.{channel}.{provider}.{kind}.v{version}
// All fields must be non-empty and must not contain dots (NATS separator).

import { ok, err } from '../lib/result.js'

const buildSubject = ({ tenant, producer, domain, channel, provider, kind, version = 1 }) => {
  const fields = { tenant, producer, domain, channel, provider, kind }

  for (const [name, value] of Object.entries(fields)) {
    if (!value || typeof value !== 'string' || value === '') {
      return err(`buildSubject: ${name} is required`)
    }
    if (value.includes('.')) {
      return err(`buildSubject: ${name} must not contain dots — got "${value}"`)
    }
  }

  if (String(version).includes('.')) {
    return err(`buildSubject: version must not contain dots — got "${version}"`)
  }

  const subject = `evt.${tenant}.${producer}.${domain}.${channel}.${provider}.${kind}.v${version}`
  return ok(subject)
}

export { buildSubject }
