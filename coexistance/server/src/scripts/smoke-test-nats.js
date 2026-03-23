// Smoke test for NATS ingress pipeline.
// Connects to NATS, subscribes to the test subject, publishes via processIngress,
// waits 3 seconds for delivery, then verifies receipt.
//
// Usage: bun src/scripts/smoke-test-nats.js
// If NATS is not available, exits 0 with a clear message.

import { connectNats } from '../bus/connect-nats.js'
import { subscribeToSubject } from '../bus/subscribe.js'
import { processIngress } from '../bus/process-ingress.js'

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222'

const textMessageSample = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba_smoke',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'smoke_phone', display_phone_number: '+10000000000' },
            contacts: [{ profile: { name: 'Smoke Tester' }, wa_id: '15550001234' }],
            messages: [
              {
                id: `wamid.smoke.${Date.now()}`,
                from: '15550001234',
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: 'smoke test message' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
}

const run = async () => {
  console.log('\n[SMOKE] NATS Ingress Smoke Test')
  console.log(`[SMOKE] Connecting to ${NATS_URL}...`)

  const natsResult = await connectNats(NATS_URL)
  if (!natsResult.ok) {
    console.log(`[SMOKE] NATS not available: ${natsResult.error}`)
    console.log('[SMOKE] Skipping smoke test — exit 0')
    process.exit(0)
  }

  const nc = natsResult.data
  console.log('[SMOKE] Connected OK')

  // Track received messages
  const received = []

  // Subscribe to the subject we will publish to
  subscribeToSubject(nc, 'evt.smoketenant.coexistance.messaging.>', async (envelope) => {
    console.log(`[SMOKE] Received envelope: id=${envelope.id}`)
    received.push(envelope)
  })

  // Give subscription a moment to register
  await new Promise((r) => setTimeout(r, 200))

  // Publish via processIngress
  console.log('[SMOKE] Publishing test event via processIngress...')
  const result = await processIngress(
    {
      rawBody: textMessageSample,
      headers: { 'content-type': 'application/json' },
      tenant: 'smoketenant',
      accountid: 'smokeaccount',
      correlationId: `smoke-${Date.now()}`,
    },
    { nc, producer: 'coexistance' }
  )

  if (!result.ok) {
    console.error(`[SMOKE] processIngress failed: ${result.error}`)
    await nc.drain()
    process.exit(1)
  }

  console.log(`[SMOKE] Published: eventId=${result.data.eventId} subject=${result.data.subject}`)
  console.log('[SMOKE] Waiting 3s for delivery...')
  await new Promise((r) => setTimeout(r, 3000))

  if (received.length === 0) {
    console.error('[SMOKE] FAILED — no message received after 3 seconds')
    await nc.drain()
    process.exit(1)
  }

  const env = received[0]
  if (env.id !== result.data.eventId) {
    console.error(`[SMOKE] FAILED — received wrong eventId: expected ${result.data.eventId}, got ${env.id}`)
    await nc.drain()
    process.exit(1)
  }

  console.log('[SMOKE] PASSED — message received and verified')
  console.log(`[SMOKE]   eventId:  ${env.id}`)
  console.log(`[SMOKE]   tenant:   ${env.tenant}`)
  console.log(`[SMOKE]   subject:  ${result.data.subject}`)

  await nc.drain()
  console.log('[SMOKE] Connection drained. Done.\n')
  process.exit(0)
}

run().catch((e) => {
  console.error('[SMOKE] Unexpected error:', e.message)
  process.exit(1)
})
