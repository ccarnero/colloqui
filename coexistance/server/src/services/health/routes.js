// GET /api/bus/health  — NATS connection status, SSE client count, and metrics snapshot
// GET /api/bus/metrics — Raw metrics snapshot

const registerBusHealthRoutes = (app, nc, busMetrics, sseBridge) => {
  app.get('/api/bus/health', (_req, res) => {
    const natsStatus = nc ? 'connected' : 'disabled'
    const sseClients = sseBridge ? sseBridge.getClientCount() : 0
    const metrics = busMetrics ? busMetrics.snapshot() : null

    res.json({
      status: 'ok',
      nats: natsStatus,
      sse_clients: sseClients,
      metrics,
      timestamp: new Date().toISOString(),
    })
  })

  app.get('/api/bus/metrics', (_req, res) => {
    if (!busMetrics) {
      return res.json({ error: 'metrics not available', timestamp: new Date().toISOString() })
    }
    res.json(busMetrics.snapshot())
  })
}

export { registerBusHealthRoutes }
