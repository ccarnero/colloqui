// Publishes an envelope to a NATS subject.
// Sets Nats-Msg-Id header for future JetStream deduplication.
// Returns ok({ eventId, subject, payloadBytes }) or err(reason).
//
// Note: En v1, cambiará a js.publish() con ack wait.

import { StringCodec, headers } from 'nats'
import { ok, err } from '../lib/result.js'

const sc = StringCodec()

const publishEvent = (nc, subject, envelope) => {
  try {
    const payload = sc.encode(JSON.stringify(envelope))

    // Set deduplication header for future JetStream support
    const h = headers()
    h.set('Nats-Msg-Id', envelope.idempotencykey)

    nc.publish(subject, payload, { headers: h })

    const payloadBytes = envelope.data?.payload_bytes ?? payload.length
    console.log(`  [BUS] publishEvent: ok — subject=${subject} eventId=${envelope.id} bytes=${payloadBytes}`)

    return ok({ eventId: envelope.id, subject, payloadBytes })
  } catch (e) {
    console.error(`  [BUS] publishEvent: FAILED — ${e.message}`)
    return err(e.message || String(e))
  }
}

export { publishEvent }
