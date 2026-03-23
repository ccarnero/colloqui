import { describe, it, expect, vi } from 'vitest'
import { subscribeToSubject } from '../../src/bus/subscribe.js'

// Build a mock NATS subscription that yields a fixed set of messages
const buildMockSub = (messages) => {
  let i = 0
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (i < messages.length) {
            return { value: messages[i++], done: false }
          }
          // Pause after all messages to avoid infinite loop
          await new Promise((resolve) => setTimeout(resolve, 50))
          return { value: undefined, done: true }
        },
      }
    },
  }
}

const buildMockNc = (messages = []) => ({
  subscribe: vi.fn().mockReturnValue(buildMockSub(messages)),
})

describe('subscribeToSubject', () => {
  it('calls nc.subscribe with the subject', () => {
    const nc = buildMockNc()
    const handler = vi.fn()
    subscribeToSubject(nc, 'evt.acme.>', handler)
    expect(nc.subscribe).toHaveBeenCalledWith('evt.acme.>')
  })

  it('returns ok with subject and sub', () => {
    const nc = buildMockNc()
    const handler = vi.fn()
    const result = subscribeToSubject(nc, 'evt.test.>', handler)
    expect(result.ok).toBe(true)
    expect(result.data.subject).toBe('evt.test.>')
    expect(result.data.sub).toBeDefined()
  })

  it('returns err when nc.subscribe throws', () => {
    const nc = {
      subscribe: vi.fn().mockImplementation(() => {
        throw new Error('subscribe failed')
      }),
    }
    const result = subscribeToSubject(nc, 'evt.fail.>', vi.fn())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('subscribe failed')
  })

  it('dispatches deserialized envelopes to the handler', async () => {
    const envelope = { id: 'test-001', tenant: 'acme', data: { payload: { test: true } } }
    const encoded = new TextEncoder().encode(JSON.stringify(envelope))
    const nc = buildMockNc([{ data: encoded }])
    const handler = vi.fn()

    subscribeToSubject(nc, 'evt.acme.>', handler)

    // Give the async loop time to process
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(handler).toHaveBeenCalledWith(envelope)
  })

  it('continues after handler throws — does not crash', async () => {
    const envelope1 = { id: 'e1', data: {} }
    const envelope2 = { id: 'e2', data: {} }
    const enc = (e) => new TextEncoder().encode(JSON.stringify(e))
    const nc = buildMockNc([{ data: enc(envelope1) }, { data: enc(envelope2) }])

    let count = 0
    const handler = vi.fn().mockImplementation(() => {
      count++
      if (count === 1) throw new Error('handler error')
    })

    subscribeToSubject(nc, 'evt.acme.>', handler)

    await new Promise((resolve) => setTimeout(resolve, 150))
    // Both messages should have been attempted despite the error on first
    expect(handler).toHaveBeenCalledTimes(2)
  })
})
