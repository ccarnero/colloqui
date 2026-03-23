import { describe, it, expect } from 'vitest'
import { validateEnvelope } from '../../src/bus/validate-envelope.js'

// A complete valid envelope for use as base in tests
const validEnvelope = () => ({
  specversion: '1.0',
  id: 'test-id-001',
  source: '/services/coexistance/ingress/meta/whatsapp',
  type: 'io.yoizen.messaging.ingress.received.v1',
  resource: 'tenant/acme/account/acc123/channel/whatsapp/provider/meta',
  time: '2024-01-01T00:00:00.000Z',
  traceid: 'trace-abc',
  causation_id: null,
  correlation_id: 'corr-123',
  tenant: 'acme',
  producer: 'coexistance',
  domain: 'messaging',
  channel: 'whatsapp',
  provider: 'meta',
  accountid: 'acc123',
  idempotencykey: 'sha256:abc123',
  transport: {
    method: 'webhook',
    protocol: 'https',
  },
  data: {
    received_at: '2024-01-01T00:00:00.000Z',
    payload_inline: true,
    payload_bytes: 512,
    payload_checksum: 'sha256:def456',
    payload_ref: null,
    payload: { object: 'whatsapp_business_account' },
  },
})

describe('validateEnvelope', () => {
  it('accepts a valid envelope', () => {
    const result = validateEnvelope(validEnvelope())
    expect(result.ok).toBe(true)
    expect(result.data).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateEnvelope(null).ok).toBe(false)
    expect(validateEnvelope('string').ok).toBe(false)
    expect(validateEnvelope(42).ok).toBe(false)
  })

  const requiredStringFields = [
    'specversion', 'id', 'source', 'type', 'resource', 'time',
    'correlation_id', 'tenant', 'producer', 'domain', 'channel',
    'provider', 'accountid', 'idempotencykey',
  ]

  for (const field of requiredStringFields) {
    it(`rejects envelope missing field: ${field}`, () => {
      const env = validEnvelope()
      delete env[field]
      const result = validateEnvelope(env)
      expect(result.ok).toBe(false)
      expect(result.error).toContain(field)
    })

    it(`rejects envelope with empty string for field: ${field}`, () => {
      const env = validEnvelope()
      env[field] = ''
      const result = validateEnvelope(env)
      expect(result.ok).toBe(false)
    })
  }

  it('accepts causation_id as null', () => {
    const env = validEnvelope()
    env.causation_id = null
    expect(validateEnvelope(env).ok).toBe(true)
  })

  it('accepts causation_id as string', () => {
    const env = validEnvelope()
    env.causation_id = 'cause-001'
    expect(validateEnvelope(env).ok).toBe(true)
  })

  it('rejects causation_id as number', () => {
    const env = validEnvelope()
    env.causation_id = 123
    expect(validateEnvelope(env).ok).toBe(false)
  })

  it('rejects missing transport', () => {
    const env = validEnvelope()
    delete env.transport
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('transport')
  })

  it('rejects missing transport.method', () => {
    const env = validEnvelope()
    delete env.transport.method
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('transport.method')
  })

  it('rejects missing transport.protocol', () => {
    const env = validEnvelope()
    delete env.transport.protocol
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('transport.protocol')
  })

  it('rejects missing data', () => {
    const env = validEnvelope()
    delete env.data
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('data')
  })

  it('rejects missing data.received_at', () => {
    const env = validEnvelope()
    delete env.data.received_at
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('received_at')
  })

  it('rejects data.payload_inline non-boolean', () => {
    const env = validEnvelope()
    env.data.payload_inline = 'true'
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('payload_inline')
  })

  it('rejects data.payload_bytes non-number', () => {
    const env = validEnvelope()
    env.data.payload_bytes = '512'
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('payload_bytes')
  })

  it('rejects missing data.payload_checksum', () => {
    const env = validEnvelope()
    delete env.data.payload_checksum
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('payload_checksum')
  })

  it('rejects payload_inline:true with payload:null', () => {
    const env = validEnvelope()
    env.data.payload_inline = true
    env.data.payload = null
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('payload')
  })

  it('rejects payload_inline:false with payload_ref:null', () => {
    const env = validEnvelope()
    env.data.payload_inline = false
    env.data.payload_ref = null
    env.data.payload = null
    const result = validateEnvelope(env)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('payload_ref')
  })

  it('accepts payload_inline:false with a payload_ref string', () => {
    const env = validEnvelope()
    env.data.payload_inline = false
    env.data.payload_ref = 's3://bucket/key'
    env.data.payload = null
    expect(validateEnvelope(env).ok).toBe(true)
  })
})
