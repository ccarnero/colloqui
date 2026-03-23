// Orchestrates the full ingress pipeline for a single webhook event.
// Filters headers → builds envelope → builds subject → publishes to NATS.
// Returns ok({ eventId, subject, publishedAt, payloadBytes }) or err(reason).

import { ok, err } from '../../lib/result.js'
import { filterHeaders } from '../../bus/filter-headers.js'
import { buildEnvelope } from '../../bus/build-envelope.js'
import { buildSubject } from '../../bus/build-subject.js'
import { publishEvent } from '../../bus/publish-event.js'

const processIngress = async (request, config) => {
  const { rawBody, headers, tenant, accountid, correlationId } = request
  const { nc, producer, metrics } = config

  // Increment ingress received counter if metrics available
  if (metrics) metrics.increment('ingress.received', { tenant, producer })

  console.log(`  [BUS] processIngress: start — tenant=${tenant} accountid=${accountid}`)

  // Step: filterHeaders
  const filteredHeaders = filterHeaders(headers)
  console.log(`  [BUS] Step: filterHeaders → ok`)

  const transport = {
    method: 'webhook',
    protocol: 'https',
    headers: filteredHeaders,
  }

  const context = {
    tenant,
    accountid,
    producer,
    traceid: crypto.randomUUID(),
    correlationId,
    causationId: null,
    source: '/services/coexistance/ingress/meta/whatsapp',
    type: 'io.yoizen.messaging.ingress.received.v1',
    channel: 'whatsapp',
    provider: 'meta',
    domain: 'messaging',
  }

  // Step: buildEnvelope
  const envelopeResult = buildEnvelope(rawBody, transport, context)
  if (!envelopeResult.ok) {
    console.error(`  [BUS] Step: buildEnvelope → FAILED: ${envelopeResult.error}`)
    if (metrics) metrics.increment('ingress.publish_failed', { tenant, producer, reason: 'build_envelope' })
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
    kind: 'received',
    version: 1,
  })
  if (!subjectResult.ok) {
    console.error(`  [BUS] Step: buildSubject → FAILED: ${subjectResult.error}`)
    if (metrics) metrics.increment('ingress.publish_failed', { tenant, producer, reason: 'build_subject' })
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
    if (metrics) metrics.increment('ingress.publish_failed', { tenant, producer, reason: 'publish' })
    return err(publishResult.error)
  }
  console.log(`  [BUS] Step: publishEvent → ok (latency: ${latencyMs}ms)`)

  if (metrics) {
    metrics.increment('ingress.published', { tenant, producer })
    metrics.observe('ingress.publish_latency_ms', latencyMs, { tenant, producer })
    metrics.observe('ingress.payload_bytes', envelope.data.payload_bytes, { tenant, producer })
  }

  const result = {
    eventId: publishResult.data.eventId,
    subject,
    publishedAt: new Date().toISOString(),
    payloadBytes: envelope.data.payload_bytes,
  }

  console.log(`  [BUS] processIngress: done — eventId=${result.eventId}`)
  return ok(result)
}

export { processIngress }
