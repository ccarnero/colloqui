import { describe, it, expect, vi } from 'vitest'
import { registerBusHealthRoutes } from '../../../src/services/health/routes.js'
import { createBusMetrics } from '../../../src/services/health/metrics.js'

const buildMockApp = () => {
  const routes = {}
  return {
    get: vi.fn().mockImplementation((path, handler) => {
      routes[`GET ${path}`] = handler
    }),
    _invoke: async (method, path) => {
      const key = `${method} ${path}`
      const handler = routes[key]
      if (!handler) throw new Error(`No route: ${key}`)
      const res = {
        json: vi.fn(),
      }
      await handler({}, res)
      return res
    },
  }
}

const buildMockNc = () => ({})

const buildMockBridge = (count = 0) => ({
  getClientCount: vi.fn().mockReturnValue(count),
})

describe('registerBusHealthRoutes', () => {
  it('registers GET /api/bus/health', () => {
    const app = buildMockApp()
    registerBusHealthRoutes(app, buildMockNc(), null, null)
    expect(app.get).toHaveBeenCalledWith('/api/bus/health', expect.any(Function))
  })

  it('registers GET /api/bus/metrics', () => {
    const app = buildMockApp()
    registerBusHealthRoutes(app, buildMockNc(), null, null)
    expect(app.get).toHaveBeenCalledWith('/api/bus/metrics', expect.any(Function))
  })

  describe('GET /api/bus/health', () => {
    it('returns status ok when nc is present', async () => {
      const app = buildMockApp()
      registerBusHealthRoutes(app, buildMockNc(), null, null)
      const res = await app._invoke('GET', '/api/bus/health')
      const [response] = res.json.mock.calls[0]
      expect(response.status).toBe('ok')
      expect(response.nats).toBe('connected')
    })

    it('returns nats: disabled when nc is null', async () => {
      const app = buildMockApp()
      registerBusHealthRoutes(app, null, null, null)
      const res = await app._invoke('GET', '/api/bus/health')
      const [response] = res.json.mock.calls[0]
      expect(response.nats).toBe('disabled')
    })

    it('includes sse_clients count from bridge', async () => {
      const app = buildMockApp()
      const bridge = buildMockBridge(3)
      registerBusHealthRoutes(app, buildMockNc(), null, bridge)
      const res = await app._invoke('GET', '/api/bus/health')
      const [response] = res.json.mock.calls[0]
      expect(response.sse_clients).toBe(3)
    })

    it('includes metrics snapshot', async () => {
      const app = buildMockApp()
      const busMetrics = createBusMetrics()
      busMetrics.increment('ingress.received', { tenant: 'acme' })
      registerBusHealthRoutes(app, buildMockNc(), busMetrics, null)
      const res = await app._invoke('GET', '/api/bus/health')
      const [response] = res.json.mock.calls[0]
      expect(response.metrics).toBeDefined()
      expect(typeof response.metrics.counters).toBe('object')
    })

    it('includes timestamp', async () => {
      const app = buildMockApp()
      registerBusHealthRoutes(app, null, null, null)
      const res = await app._invoke('GET', '/api/bus/health')
      const [response] = res.json.mock.calls[0]
      expect(typeof response.timestamp).toBe('string')
    })
  })

  describe('GET /api/bus/metrics', () => {
    it('returns metrics snapshot when busMetrics is available', async () => {
      const app = buildMockApp()
      const busMetrics = createBusMetrics()
      busMetrics.increment('test.counter', { env: 'test' })
      registerBusHealthRoutes(app, null, busMetrics, null)
      const res = await app._invoke('GET', '/api/bus/metrics')
      const [response] = res.json.mock.calls[0]
      expect(response.counters).toBeDefined()
      expect(response.histograms).toBeDefined()
    })

    it('returns error when busMetrics is null', async () => {
      const app = buildMockApp()
      registerBusHealthRoutes(app, null, null, null)
      const res = await app._invoke('GET', '/api/bus/metrics')
      const [response] = res.json.mock.calls[0]
      expect(response.error).toBeDefined()
    })
  })
})
