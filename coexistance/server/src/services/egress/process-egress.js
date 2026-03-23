// Orchestrates the egress pipeline for an outbound message.
// Builds envelope + subject → publishes to NATS with kind: 'sent'.
// Returns ok({ eventId, subject, publishedAt, payloadBytes }) or err(reason).

import { ok, err } from '../../lib/result.js'
import { buildEnvelope } from '../../bus/build-envelope.js'
import { buildSubject } from '../../bus/build-subject.js'
import { publishEvent } from '../../bus/publish-event.js'

const processEgress = async (payload, config) => {
  const { tenant, accountid, correlationId } = payload
  const { nc, producer, metrics } = config

  // Increment egress received counter if metrics available
  if (metrics) metrics.increment('egress.received', { tenant, producer })

  console.log(`  [BUS] processEgress: start — tenant=${tenant} accountid=${accountid}`)

  const transport = {
    method: 'api',
    protocol: 'https',
    headers: {},
  }

  const context = {
    tenant,
    accountid,
    producer,
    traceid: crypto.randomUUID(),
    correlationId,
    causationId: null,
    source: '/services/coexistance/egress/meta/whatsapp',
    type: 'io.yoizen.messaging.egress.sent.v1',
    channel: 'whatsapp',
    provider: 'meta',
    domain: 'messaging',
  }

  // Step: buildEnvelope
  const envelopeResult = buildEnvelope(payload.body, transport, context)
  if (!envelopeResult.ok) {
    console.error(`  [BUS] Step: buildEnvelope → FAILED: ${envelopeResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer, reason: 'build_envelope' })
    return err(envelopeResult.error)
  }
  console.log(`  [BUS] Step: buildEnvelope → ok (id: ${envelopeResult.data.id})`)

  const envelope = envelopeResult.data

  // Step: buildSubject
  const subjectResult = buildSubject({
    tenant,
    producer,
    domain: context.domain,
    channel: context.channel,
    provider: context.provider,
    kind: 'sent',
    version: 1,
  })
  if (!subjectResult.ok) {
    console.error(`  [BUS] Step: buildSubject → FAILED: ${subjectResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer, reason: 'build_subject' })
    return err(subjectResult.error)
  }
  console.log(`  [BUS] Step: buildSubject → ok (${subjectResult.data})`)

  const subject = subjectResult.data

  // Step: publishEvent
  const publishStart = Date.now()
  const publishResult = publishEvent(nc, subject, envelope)
  const latencyMs = Date.now() - publishStart

  if (!publishResult.ok) {
    console.error(`  [BUS] Step: publishEvent → FAILED: ${publishResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer, reason: 'publish' })
    return err(publishResult.error)
  }
  console.log(`  [BUS] Step: publishEvent → ok (latency: ${latencyMs}ms)`)

  if (metrics) {
    metrics.increment('egress.published', { tenant, producer })
    metrics.observe('egress.publish_latency_ms', latencyMs, { tenant, producer })
    metrics.observe('egress.payload_bytes', envelope.data.payload_bytes, { tenant, producer })
  }

  const result = {
    eventId: publishResult.data.eventId,
    subject,
    publishedAt: new Date().toISOString(),
    payloadBytes: envelope.data.payload_bytes,
  }

  console.log(`  [BUS] processEgress: done — eventId=${result.eventId}`)
  return ok(result)
}

export { processEgress }
