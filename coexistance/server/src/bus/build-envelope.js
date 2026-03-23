// Builds a complete CloudEvents-compatible envelope from a raw webhook body.
// In v0, payload is always inlined (payload_inline: true).
// In v1 (JetStream), large payloads will be stored by reference.

import { ulid } from 'ulid'
import { ok, err } from '../lib/result.js'
import { idempotencyKey } from './idempotency-key.js'
import { checkPayloadSize } from './check-payload-size.js'
import { validateEnvelope } from './validate-envelope.js'

const buildEnvelope = (rawBody, transport, context) => {
  const {
    tenant,
    accountid,
    producer,
    traceid,
    correlationId,
    causationId,
    source,
    type,
    channel,
    provider,
    domain,
  } = context

  const id = ulid()
  const time = new Date().toISOString()
  const ikey = idempotencyKey(rawBody)

  const { bytes: payload_bytes } = checkPayloadSize(rawBody)

  // Compute payload checksum
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(JSON.stringify(rawBody))
  const payload_checksum = `sha256:${hasher.digest('hex')}`

  const resource = `tenant/${tenant}/account/${accountid}/channel/${channel}/provider/${provider}`

  const envelope = {
    specversion: '1.0',
    id,
    source,
    type,
    resource,
    time,
    traceid,
    causation_id: causationId || null,
    correlation_id: correlationId,
    tenant,
    producer,
    domain,
    channel,
    provider,
    accountid,
    idempotencykey: ikey,
    transport,
    data: {
      received_at: time,
      payload_inline: true,
      payload_ref: null,
      payload_bytes,
      payload_checksum,
      payload: rawBody,
    },
  }

  const validation = validateEnvelope(envelope)
  if (!validation.ok) {
    console.error(`  [BUS] buildEnvelope: validation failed — ${validation.error}`)
    return err(validation.error)
  }

  console.log(`  [BUS] buildEnvelope: ok (id: ${id})`)
  return ok(envelope)
}

export { buildEnvelope }
