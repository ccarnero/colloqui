// Generic NATS subject subscriber.
// Deserializes JSON envelopes and dispatches them to a handler function.
// Errors in the handler are logged but do not crash the subscription loop.

import { StringCodec } from 'nats'
import { ok, err } from '../lib/result.js'

const sc = StringCodec()

const subscribeToSubject = (nc, subject, handler) => {
  try {
    const sub = nc.subscribe(subject)
    console.log(`  [BUS] subscribeToSubject: subscribed to "${subject}"`)

    // Consume messages in background — do not await this
    ;(async () => {
      for await (const msg of sub) {
        try {
          const raw = sc.decode(msg.data)
          const envelope = JSON.parse(raw)
          await handler(envelope)
        } catch (e) {
          console.error(`  [BUS] subscribeToSubject: handler error on subject "${subject}": ${e.message}`)
        }
      }
      console.log(`  [BUS] subscribeToSubject: subscription closed for "${subject}"`)
    })()

    return ok({ subject, sub })
  } catch (e) {
    console.error(`  [BUS] subscribeToSubject: failed to subscribe to "${subject}": ${e.message}`)
    return err(e.message || String(e))
  }
}

export { subscribeToSubject }
