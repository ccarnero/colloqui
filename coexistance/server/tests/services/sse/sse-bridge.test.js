import { describe, it, expect, vi } from 'vitest'
import { createSseBridge } from '../../../src/services/sse/sse-bridge.js'

// Build a minimal mock NATS connection that captures subscribe callbacks
const buildMockNc = () => {
  let capturedHandler = null
  let capturedSubject = null

  const sub = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          // Never yields — we'll drive delivery manually via publishToHandler
          await new Promise((resolve) => setTimeout(resolve, 50))
          return { value: undefined, done: true }
        },
      }
    },
  }

  return {
    subscribe: vi.fn().mockReturnValue(sub),
    _triggerMessage: async (envelope) => {
      // This bypasses the subscribe loop — we test the subscribe wiring separately
      // For SSE bridge tests we call the bridge's internal logic via subscribeToSubject
    },
  }
}

// Build a mock SSE response object
const buildMockRes = () => ({
  write: vi.fn(),
  on: vi.fn(),
})

describe('createSseBridge', () => {
  it('returns registerClient, removeClient, getClientCount', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)
    expect(typeof bridge.registerClient).toBe('function')
    expect(typeof bridge.removeClient).toBe('function')
    expect(typeof bridge.getClientCount).toBe('function')
  })

  it('subscribes to the messaging subject on creation', () => {
    const nc = buildMockNc()
    createSseBridge(nc)
    expect(nc.subscribe).toHaveBeenCalledWith('evt.*.coexistance.messaging.>')
  })

  it('getClientCount returns 0 initially', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)
    expect(bridge.getClientCount()).toBe(0)
  })

  it('registerClient increments client count', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)
    const res = buildMockRes()

    bridge.registerClient('acc123', res)
    expect(bridge.getClientCount()).toBe(1)
  })

  it('registerClient supports multiple clients for the same account', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)

    bridge.registerClient('acc123', buildMockRes())
    bridge.registerClient('acc123', buildMockRes())
    expect(bridge.getClientCount()).toBe(2)
  })

  it('registerClient supports clients for different accounts', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)

    bridge.registerClient('acc123', buildMockRes())
    bridge.registerClient('acc456', buildMockRes())
    expect(bridge.getClientCount()).toBe(2)
  })

  it('removeClient decrements client count', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)
    const res = buildMockRes()

    bridge.registerClient('acc123', res)
    expect(bridge.getClientCount()).toBe(1)

    bridge.removeClient('acc123', res)
    expect(bridge.getClientCount()).toBe(0)
  })

  it('removeClient is a no-op for unknown accountId', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)
    // Should not throw
    expect(() => bridge.removeClient('unknown', buildMockRes())).not.toThrow()
  })

  it('removeClient only removes the specific res instance', () => {
    const nc = buildMockNc()
    const bridge = createSseBridge(nc)
    const res1 = buildMockRes()
    const res2 = buildMockRes()

    bridge.registerClient('acc123', res1)
    bridge.registerClient('acc123', res2)
    bridge.removeClient('acc123', res1)

    expect(bridge.getClientCount()).toBe(1)
  })
})
