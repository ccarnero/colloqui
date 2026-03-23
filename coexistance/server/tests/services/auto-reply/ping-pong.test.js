import { describe, it, expect } from 'vitest'
import { pingPong } from '../../../src/services/auto-reply/rules/ping-pong.js'

describe('pingPong rule', () => {
  it('matches "ping" text message and normalizes sender', () => {
    // 5491112345678 → 541112345678 (Argentine mobile: 549 → 54)
    const messages = [{ type: 'text', from: '5491112345678', text: { body: 'ping' } }]
    const result = pingPong(messages)
    expect(result).toEqual({
      rule: 'ping-pong',
      action: 'send_text',
      to: '541112345678',
      text: 'pong',
    })
  })

  it('matches "PING" (case insensitive)', () => {
    const messages = [{ type: 'text', from: '123', text: { body: '  PING  ' } }]
    expect(pingPong(messages)).not.toBeNull()
  })

  it('normalizes Argentine phone number (removes extra 9)', () => {
    const messages = [{ type: 'text', from: '5491134602008', text: { body: 'ping' } }]
    const result = pingPong(messages)
    expect(result.to).toBe('541134602008')
  })

  it('keeps non-Argentine numbers as-is', () => {
    const messages = [{ type: 'text', from: '14155551234', text: { body: 'ping' } }]
    const result = pingPong(messages)
    expect(result.to).toBe('14155551234')
  })

  it('sets correct to field for non-Argentine sender', () => {
    const messages = [{ type: 'text', from: '5491199998888', text: { body: 'ping' } }]
    const result = pingPong(messages)
    expect(result.to).toBe('541199998888')
    expect(result.text).toBe('pong')
  })

  it('returns null for non-ping text', () => {
    const messages = [{ type: 'text', from: '123', text: { body: 'hello' } }]
    expect(pingPong(messages)).toBeNull()
  })

  it('returns null for image message', () => {
    const messages = [{ type: 'image', from: '123' }]
    expect(pingPong(messages)).toBeNull()
  })

  it('returns null for empty messages array', () => {
    expect(pingPong([])).toBeNull()
  })

  it('returns null for null messages', () => {
    expect(pingPong(null)).toBeNull()
  })

  it('returns null for undefined messages', () => {
    expect(pingPong(undefined)).toBeNull()
  })
})
