import { describe, it, expect } from 'vitest'
import { connectNats } from '../../src/bus/connect-nats.js'

describe('connectNats', () => {
  it('returns err when connecting to a port with refused connection', async () => {
    // Port 1 refuses connections immediately (no service listening)
    const result = await connectNats('nats://127.0.0.1:1')
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  }, 10000)

  // Note: ok path tested by integration tests that require a live NATS server.
  // Run smoke-test-nats.js to test against a real NATS instance.
})
