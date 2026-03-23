import { describe, it, expect } from 'vitest'
import { idempotencyKey } from '../../src/bus/idempotency-key.js'

describe('idempotencyKey', () => {
  it('returns a string in "sha256:{hex}" format', () => {
    const key = idempotencyKey({ a: 1 })
    expect(typeof key).toBe('string')
    expect(key.startsWith('sha256:')).toBe(true)
    expect(key.length).toBeGreaterThan(7) // "sha256:" + at least 1 char
  })

  it('is deterministic — same input produces same key', () => {
    const body = { object: 'whatsapp_business_account', entry: [{ id: '123' }] }
    const k1 = idempotencyKey(body)
    const k2 = idempotencyKey(body)
    expect(k1).toBe(k2)
  })

  it('produces different keys for different inputs', () => {
    const k1 = idempotencyKey({ a: 1 })
    const k2 = idempotencyKey({ a: 2 })
    expect(k1).not.toBe(k2)
  })

  it('is key-order independent (canonical)', () => {
    const k1 = idempotencyKey({ b: 2, a: 1 })
    const k2 = idempotencyKey({ a: 1, b: 2 })
    expect(k1).toBe(k2)
  })

  it('produces a 64-char hex hash after sha256:', () => {
    const key = idempotencyKey({ test: true })
    const hex = key.replace('sha256:', '')
    expect(hex).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true)
  })
})
