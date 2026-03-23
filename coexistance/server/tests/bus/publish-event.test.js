import { describe, it, expect, vi } from 'vitest'
import { publishEvent } from '../../src/bus/publish-event.js'
import { textMessage } from './fixtures/meta-webhook-samples.js'
import { buildEnvelope } from '../../src/bus/build-envelope.js'

const validTransport = { method: 'webhook', protocol: 'https', headers: {} }
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

const buildMockNc = () => ({
  publish: vi.fn(),
})

describe('publishEvent', () => {
  it('publishes to the given subject and returns ok', () => {
    const nc = buildMockNc()
    const envelopeResult = buildEnvelope(textMessage, validTransport, validContext)
    expect(envelopeResult.ok).toBe(true)

    const subject = 'evt.acme.coexistance.messaging.whatsapp.meta.received.v1'
    const result = publishEvent(nc, subject, envelopeResult.data)

    expect(result.ok).toBe(true)
    expect(result.data.eventId).toBe(envelopeResult.data.id)
    expect(result.data.subject).toBe(subject)
    expect(typeof result.data.payloadBytes).toBe('number')
    expect(nc.publish).toHaveBeenCalledOnce()
  })

  it('passes the subject as first arg to nc.publish', () => {
    const nc = buildMockNc()
    const envelopeResult = buildEnvelope(textMessage, validTransport, validContext)
    const subject = 'evt.test.coexistance.messaging.whatsapp.meta.received.v1'

    publishEvent(nc, subject, envelopeResult.data)

    const [calledSubject] = nc.publish.mock.calls[0]
    expect(calledSubject).toBe(subject)
  })

  it('returns err when nc.publish throws', () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('NATS publish failed')
      }),
    }
    const envelopeResult = buildEnvelope(textMessage, validTransport, validContext)
    const subject = 'evt.acme.test.messaging.whatsapp.meta.received.v1'

    const result = publishEvent(nc, subject, envelopeResult.data)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('NATS publish failed')
  })
})
