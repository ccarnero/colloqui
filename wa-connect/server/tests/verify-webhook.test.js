import { describe, it, expect } from 'vitest'
import { verifyWebhook } from '../src/meta/verify-webhook.js'

describe('verifyWebhook', () => {
  const TOKEN = 'my_secret_token'

  it('verifies valid challenge', () => {
    const query = {
      'hub.mode': 'subscribe',
      'hub.verify_token': TOKEN,
      'hub.challenge': 'challenge_123',
    }
    const result = verifyWebhook(query, TOKEN)
    expect(result.verified).toBe(true)
    expect(result.challenge).toBe('challenge_123')
  })

  it('rejects wrong token', () => {
    const query = {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong_token',
      'hub.challenge': 'challenge_123',
    }
    const result = verifyWebhook(query, TOKEN)
    expect(result.verified).toBe(false)
  })

  it('rejects wrong mode', () => {
    const query = {
      'hub.mode': 'unsubscribe',
      'hub.verify_token': TOKEN,
      'hub.challenge': 'challenge_123',
    }
    const result = verifyWebhook(query, TOKEN)
    expect(result.verified).toBe(false)
  })

  it('rejects missing fields', () => {
    const result = verifyWebhook({}, TOKEN)
    expect(result.verified).toBe(false)
  })
})
