// Health service — exposes bus metrics and NATS status.
// Creates metrics internally and registers health routes on the Express app.

import { createBusMetrics } from './metrics.js'
import { registerBusHealthRoutes } from './routes.js'

const registerHealth = (app, { nc, sseBridge }) => {
  const metrics = nc ? createBusMetrics() : null
  registerBusHealthRoutes(app, nc, metrics, sseBridge)
  console.log('  [SERVICE] Health registered — GET /api/bus/health, /api/bus/metrics')
  return metrics
}

export { registerHealth }
