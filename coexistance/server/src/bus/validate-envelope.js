// Validates the structure of a CloudEvents-compatible envelope.
// Does NOT validate payload content — only envelope shape.
// Returns ok(true) if valid, err(reason) if not.

import { ok, err } from '../lib/result.js'

const validateEnvelope = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return err('envelope must be an object')
  }

  // Top-level string fields
  const requiredStrings = [
    'specversion', 'id', 'source', 'type', 'resource', 'time',
    'correlation_id', 'tenant', 'producer', 'domain', 'channel',
    'provider', 'accountid', 'idempotencykey',
  ]

  for (const field of requiredStrings) {
    if (typeof obj[field] !== 'string' || obj[field] === '') {
      return err(`missing required field: ${field}`)
    }
  }

  // causation_id: string or null
  if (obj.causation_id !== null && typeof obj.causation_id !== 'string') {
    return err('causation_id must be a string or null')
  }

  // transport: object with method and protocol strings
  if (!obj.transport || typeof obj.transport !== 'object') {
    return err('missing required field: transport')
  }
  if (typeof obj.transport.method !== 'string' || obj.transport.method === '') {
    return err('transport.method is required')
  }
  if (typeof obj.transport.protocol !== 'string' || obj.transport.protocol === '') {
    return err('transport.protocol is required')
  }

  // data: object with required fields
  if (!obj.data || typeof obj.data !== 'object') {
    return err('missing required field: data')
  }

  if (typeof obj.data.received_at !== 'string' || obj.data.received_at === '') {
    return err('data.received_at is required')
  }

  if (typeof obj.data.payload_inline !== 'boolean') {
    return err('data.payload_inline must be a boolean')
  }

  if (typeof obj.data.payload_bytes !== 'number') {
    return err('data.payload_bytes must be a number')
  }

  if (typeof obj.data.payload_checksum !== 'string' || obj.data.payload_checksum === '') {
    return err('data.payload_checksum is required')
  }

  // payload_ref: string or null
  if (obj.data.payload_ref !== null && typeof obj.data.payload_ref !== 'string') {
    return err('data.payload_ref must be a string or null')
  }

  // payload_inline true → payload must not be null
  if (obj.data.payload_inline === true && obj.data.payload === null) {
    return err('data.payload cannot be null when payload_inline is true')
  }

  // payload_inline false → payload_ref must not be null
  if (obj.data.payload_inline === false && obj.data.payload_ref === null) {
    return err('data.payload_ref cannot be null when payload_inline is false')
  }

  return ok(true)
}

export { validateEnvelope }
