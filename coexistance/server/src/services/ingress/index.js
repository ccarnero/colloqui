// Ingress service — webhook Meta → parse → publish to NATS.
// Registers the webhook routes on the Express app.

import { registerWebhookRoutes } from './routes.js'

const registerIngress = (app, { db, env, nc, metrics }) => {
  registerWebhookRoutes(app, db, env, { nc, metrics })
  console.log('  [SERVICE] Ingress registered — POST /api/webhooks/whatsapp')
}

export { registerIngress }
