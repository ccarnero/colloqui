import { describe, it, expect } from 'vitest'
import { evaluateRules } from '../../../src/services/auto-reply/evaluate-rules.js'

const makeEnvelope = (body) => ({
  id: 'test-001',
  accountid: 'acc-123',
  data: {
    payload: {
      entry: [{
        changes: [{
          value: {
            messages: [{ type: 'text', from: '5491112345678', text: { body } }]
          }
        }]
      }]
    }
  }
})

describe('evaluateRules', () => {
  it('returns ping-pong match for "ping"', () => {
    const result = evaluateRules(makeEnvelope('ping'))
    expect(result).toEqual({
      rule: 'ping-pong',
      action: 'send_text',
      to: '541112345678',
      text: 'pong',
    })
  })

  it('returns null for non-matching text', () => {
    expect(evaluateRules(makeEnvelope('hello'))).toBeNull()
  })

  it('returns null for envelope without messages', () => {
    expect(evaluateRules({ data: { payload: {} } })).toBeNull()
  })

  it('returns null for empty envelope', () => {
    expect(evaluateRules({})).toBeNull()
  })

  it('returns null for null envelope', () => {
    expect(evaluateRules(null)).toBeNull()
  })

  it('returns null for status update (no messages field)', () => {
    const statusEnvelope = {
      id: 'test-002',
      data: {
        payload: {
          entry: [{
            changes: [{
              value: {
                statuses: [{ id: 'wamid.xxx', status: 'delivered' }]
              }
            }]
          }]
        }
      }
    }
    expect(evaluateRules(statusEnvelope)).toBeNull()
  })
})
