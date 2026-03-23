// SSE service — subscribes to NATS and streams events to browser clients.
// Creates the bridge + registers the SSE route.

import { createSseBridge } from './sse-bridge.js'
import { registerSseRoutes } from './routes.js'

const registerSse = (app, { nc, db, env }) => {
  const sseBridge = createSseBridge(nc)
  registerSseRoutes(app, db, env, sseBridge)
  console.log('  [SERVICE] SSE registered — GET /api/events/stream')
  return sseBridge
}

export { registerSse }
