import { describe, it, expect, vi } from 'vitest'
import { processIngress } from '../../../src/services/ingress/process-ingress.js'
import { textMessage, statusUpdate } from '../../bus/fixtures/meta-webhook-samples.js'

const buildMockNc = () => ({
  publish: vi.fn(),
})

const buildRequest = (rawBody = textMessage) => ({
  rawBody,
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': 'sha256=test',
    'x-request-id': 'req-001',
  },
  tenant: 'acme',
  accountid: 'acc123',
  correlationId: 'corr-001',
})

const buildConfig = (nc) => ({
  nc,
  producer: 'coexistance',
})

describe('processIngress', () => {
  it('returns ok with eventId, subject, publishedAt, payloadBytes', async () => {
    const nc = buildMockNc()
    const result = await processIngress(buildRequest(), buildConfig(nc))

    expect(result.ok).toBe(true)
    expect(typeof result.data.eventId).toBe('string')
    expect(typeof result.data.subject).toBe('string')
    expect(typeof result.data.publishedAt).toBe('string')
    expect(typeof result.data.payloadBytes).toBe('number')
  })

  it('builds subject with correct format', async () => {
    const nc = buildMockNc()
    const result = await processIngress(buildRequest(), buildConfig(nc))

    expect(result.ok).toBe(true)
    expect(result.data.subject).toBe('evt.acme.coexistance.messaging.whatsapp.meta.received.v1')
  })

  it('calls nc.publish exactly once', async () => {
    const nc = buildMockNc()
    await processIngress(buildRequest(), buildConfig(nc))
    expect(nc.publish).toHaveBeenCalledOnce()
  })

  it('works with statusUpdate body', async () => {
    const nc = buildMockNc()
    const result = await processIngress(buildRequest(statusUpdate), buildConfig(nc))
    expect(result.ok).toBe(true)
    expect(nc.publish).toHaveBeenCalledOnce()
  })

  it('returns err when nc.publish throws', async () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('NATS down')
      }),
    }
    const result = await processIngress(buildRequest(), buildConfig(nc))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('NATS down')
  })

  it('calls metrics when provided', async () => {
    const nc = buildMockNc()
    const metrics = {
      increment: vi.fn(),
      observe: vi.fn(),
    }
    await processIngress(buildRequest(), { nc, producer: 'coexistance', metrics })

    expect(metrics.increment).toHaveBeenCalledWith('ingress.received', expect.any(Object))
    expect(metrics.increment).toHaveBeenCalledWith('ingress.published', expect.any(Object))
    expect(metrics.observe).toHaveBeenCalledWith('ingress.publish_latency_ms', expect.any(Number), expect.any(Object))
    expect(metrics.observe).toHaveBeenCalledWith('ingress.payload_bytes', expect.any(Number), expect.any(Object))
  })

  it('increments publish_failed metric when publish fails', async () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => { throw new Error('fail') }),
    }
    const metrics = {
      increment: vi.fn(),
      observe: vi.fn(),
    }
    await processIngress(buildRequest(), { nc, producer: 'coexistance', metrics })

    const failCalls = metrics.increment.mock.calls.filter(([name]) => name === 'ingress.publish_failed')
    expect(failCalls.length).toBeGreaterThan(0)
  })
})
