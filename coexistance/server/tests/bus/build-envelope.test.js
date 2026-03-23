import { describe, it, expect } from 'vitest'
import { buildEnvelope } from '../../src/bus/build-envelope.js'
import { textMessage, statusUpdate } from './fixtures/meta-webhook-samples.js'

const validTransport = {
  method: 'webhook',
  protocol: 'https',
  headers: { 'content-type': 'application/json' },
}

const validContext = {
  tenant: 'acme',
  accountid: 'acc123',
  producer: 'coexistance',
  traceid: 'trace-001',
  correlationId: 'corr-001',
  causationId: null,
  source: '/services/coexistance/ingress/meta/whatsapp',
  type: 'io.yoizen.messaging.ingress.received.v1',
  channel: 'whatsapp',
  provider: 'meta',
  domain: 'messaging',
}

describe('buildEnvelope', () => {
  it('builds a valid envelope for a text message', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)

    const env = result.data
    expect(env.specversion).toBe('1.0')
    expect(typeof env.id).toBe('string')
    expect(env.id.length).toBeGreaterThan(0)
    expect(env.tenant).toBe('acme')
    expect(env.accountid).toBe('acc123')
    expect(env.channel).toBe('whatsapp')
    expect(env.provider).toBe('meta')
    expect(env.domain).toBe('messaging')
    expect(env.producer).toBe('coexistance')
  })

  it('sets resource in correct format', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.resource).toBe('tenant/acme/account/acc123/channel/whatsapp/provider/meta')
  })

  it('sets data.payload_inline to true', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.data.payload_inline).toBe(true)
    expect(result.data.data.payload_ref).toBeNull()
  })

  it('stores the raw body as data.payload', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.data.payload).toEqual(textMessage)
  })

  it('computes idempotencykey in sha256: format', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.idempotencykey.startsWith('sha256:')).toBe(true)
  })

  it('two calls with same input produce same idempotencykey', () => {
    const r1 = buildEnvelope(textMessage, validTransport, validContext)
    const r2 = buildEnvelope(textMessage, validTransport, validContext)
    expect(r1.data.idempotencykey).toBe(r2.data.idempotencykey)
  })

  it('two calls with same input produce different ULID ids', () => {
    const r1 = buildEnvelope(textMessage, validTransport, validContext)
    const r2 = buildEnvelope(textMessage, validTransport, validContext)
    // ULIDs are monotonically increasing, so they should differ
    expect(r1.data.id).not.toBe(r2.data.id)
  })

  it('sets causation_id from context.causationId', () => {
    const ctx = { ...validContext, causationId: 'cause-001' }
    const result = buildEnvelope(textMessage, validTransport, ctx)
    expect(result.ok).toBe(true)
    expect(result.data.causation_id).toBe('cause-001')
  })

  it('sets causation_id to null when not provided', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.causation_id).toBeNull()
  })

  it('computes payload_bytes correctly', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    const expected = Buffer.byteLength(JSON.stringify(textMessage))
    expect(result.data.data.payload_bytes).toBe(expected)
  })

  it('computes payload_checksum in sha256: format', () => {
    const result = buildEnvelope(textMessage, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.data.payload_checksum.startsWith('sha256:')).toBe(true)
  })

  it('works with statusUpdate sample', () => {
    const result = buildEnvelope(statusUpdate, validTransport, validContext)
    expect(result.ok).toBe(true)
    expect(result.data.data.payload).toEqual(statusUpdate)
  })
})
