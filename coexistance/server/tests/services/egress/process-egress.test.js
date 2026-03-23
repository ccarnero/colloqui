import { describe, it, expect, vi } from 'vitest'
import { processEgress } from '../../../src/services/egress/process-egress.js'

const buildMockNc = () => ({
  publish: vi.fn(),
})

const buildPayload = (overrides = {}) => ({
  body: { to: '+15551234567', text: 'Hello!', type: 'text' },
  tenant: 'acme',
  accountid: 'acc123',
  correlationId: 'msg-001',
  ...overrides,
})

const buildConfig = (nc, extras = {}) => ({
  nc,
  producer: 'coexistance',
  ...extras,
})

describe('processEgress', () => {
  it('returns ok with eventId, subject, publishedAt, payloadBytes', async () => {
    const nc = buildMockNc()
    const result = await processEgress(buildPayload(), buildConfig(nc))

    expect(result.ok).toBe(true)
    expect(typeof result.data.eventId).toBe('string')
    expect(typeof result.data.subject).toBe('string')
    expect(typeof result.data.publishedAt).toBe('string')
    expect(typeof result.data.payloadBytes).toBe('number')
  })

  it('builds subject with kind: sent (not received)', async () => {
    const nc = buildMockNc()
    const result = await processEgress(buildPayload(), buildConfig(nc))

    expect(result.ok).toBe(true)
    expect(result.data.subject).toBe('evt.acme.coexistance.messaging.whatsapp.meta.sent.v1')
  })

  it('uses transport.method: api (not webhook)', async () => {
    const nc = buildMockNc()
    await processEgress(buildPayload(), buildConfig(nc))

    expect(nc.publish).toHaveBeenCalledOnce()
    const raw = nc.publish.mock.calls[0][1]
    const publishedPayload = JSON.parse(new TextDecoder().decode(raw))
    expect(publishedPayload.transport.method).toBe('api')
  })

  it('calls nc.publish exactly once', async () => {
    const nc = buildMockNc()
    await processEgress(buildPayload(), buildConfig(nc))
    expect(nc.publish).toHaveBeenCalledOnce()
  })

  it('returns err when nc.publish throws', async () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('NATS down')
      }),
    }
    const result = await processEgress(buildPayload(), buildConfig(nc))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('NATS down')
  })

  it('calls metrics when provided', async () => {
    const nc = buildMockNc()
    const metrics = {
      increment: vi.fn(),
      observe: vi.fn(),
    }
    await processEgress(buildPayload(), buildConfig(nc, { metrics }))

    expect(metrics.increment).toHaveBeenCalledWith('egress.received', expect.any(Object))
    expect(metrics.increment).toHaveBeenCalledWith('egress.published', expect.any(Object))
    expect(metrics.observe).toHaveBeenCalledWith('egress.publish_latency_ms', expect.any(Number), expect.any(Object))
    expect(metrics.observe).toHaveBeenCalledWith('egress.payload_bytes', expect.any(Number), expect.any(Object))
  })

  it('increments publish_failed metric when publish fails', async () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => { throw new Error('fail') }),
    }
    const metrics = {
      increment: vi.fn(),
      observe: vi.fn(),
    }
    await processEgress(buildPayload(), buildConfig(nc, { metrics }))

    const failCalls = metrics.increment.mock.calls.filter(([name]) => name === 'egress.publish_failed')
    expect(failCalls.length).toBeGreaterThan(0)
  })

  it('works with template body', async () => {
    const nc = buildMockNc()
    const result = await processEgress(
      buildPayload({ body: { to: '+15551234567', template_name: 'hello_world', type: 'template' } }),
      buildConfig(nc)
    )
    expect(result.ok).toBe(true)
    expect(nc.publish).toHaveBeenCalledOnce()
  })
})
