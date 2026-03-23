// Egress service — outbound messages → publish to NATS bus.
// Registers the message send routes on the Express app.

import { registerMessageRoutes } from './routes.js'

const registerEgress = (app, { db, env, nc, metrics }) => {
  registerMessageRoutes(app, db, env, { nc, metrics })
  console.log('  [SERVICE] Egress registered — POST /api/accounts/:accountId/messages/send{,-template}')
}

export { registerEgress }
