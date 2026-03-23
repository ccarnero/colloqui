// GET  /api/webhooks/whatsapp  — Meta verification challenge
// POST /api/webhooks/whatsapp  — Incoming messages (parsed and published to NATS)
//
// Ingress is decoupled: webhook parses, finds account, publishes to NATS.
// Persistence and broadcasting are handled by NATS consumers (see services/).

import { verifyWebhook } from '../../meta/verify-webhook.js'
import { parseWebhook } from '../../meta/parse-webhook.js'
import { processIngress } from './process-ingress.js'

const registerWebhookRoutes = (app, db, env, busConfig = {}) => {
  // Verification challenge — Meta sends this when you register the webhook URL
  app.get('/api/webhooks/whatsapp', (req, res) => {
    console.log('  [WEBHOOK] GET verification request')
    console.log('    mode:', req.query['hub.mode'])
    console.log('    token:', req.query['hub.verify_token'] ? '***' + req.query['hub.verify_token'].slice(-4) : 'MISSING')
    console.log('    challenge:', req.query['hub.challenge'] ? 'present' : 'MISSING')

    const result = verifyWebhook(req.query, env.META_VERIFY_TOKEN)

    if (result.verified) {
      console.log('  [WEBHOOK] Verified OK — responding with challenge')
      return res.status(200).send(result.challenge)
    }

    console.warn('  [WEBHOOK] Verification FAILED — token mismatch or missing params')
    res.status(403).send('Forbidden')
  })

  // Incoming events — respond 200 immediately, publish to NATS async
  app.post('/api/webhooks/whatsapp', async (req, res) => {
    console.log('  [WEBHOOK] POST incoming event')
    console.log('    object:', req.body?.object)
    console.log('    entries:', req.body?.entry?.length || 0)

    // Always respond 200 fast — Meta retries on timeout
    res.status(200).send('EVENT_RECEIVED')

    try {
      const rawBody = req.body
      const event = parseWebhook(rawBody)
      console.log('    parsed type:', event.type)

      if (event.type === 'unknown') {
        console.log('    unknown event — raw keys:', Object.keys(rawBody || {}))
        return
      }

      // Find the account by phone_number_id
      const phoneNumberId = event.data?.phone_number_id
      if (!phoneNumberId) {
        console.warn('  [WEBHOOK] No phone_number_id in event — skipping ingress')
        return
      }

      const account = await db.collection('accounts').findOne({
        phone_number_id: phoneNumberId,
      })

      if (!account) {
        console.warn(`  [WEBHOOK] NO ACCOUNT FOUND for phone_number_id: "${phoneNumberId}"`)
        console.warn(`    Check that your account in MongoDB has this exact phone_number_id`)
        return
      }

      console.log(`  [WEBHOOK] Matched account: ${account.business_name} (${account._id})`)

      const { nc, metrics } = busConfig

      if (!nc) {
        console.warn('  [WEBHOOK] NATS not available — event not published (nc is null)')
        return
      }

      const correlationId = req.headers['x-request-id'] || crypto.randomUUID()

      await processIngress(
        {
          rawBody,
          headers: req.headers,
          tenant: account.tenant || 'default',
          accountid: account._id.toString(),
          correlationId,
        },
        {
          nc,
          producer: 'coexistance',
          metrics,
        }
      )
    } catch (e) {
      // Log but don't crash — the 200 is already sent
      console.error('  [WEBHOOK] Processing error:', e.message)
      console.error('    stack:', e.stack?.split('\n')[1]?.trim())
    }
  })
}

export { registerWebhookRoutes }
