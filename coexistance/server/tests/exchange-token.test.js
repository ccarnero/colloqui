import { describe, it, expect } from 'vitest'
import { exchangeToken } from '../src/meta/exchange-token.js'

describe('exchangeToken', () => {
  it('returns error when code is missing', async () => {
    const result = await exchangeToken(null, 'appId', 'secret')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('required')
  })

  it('returns error when appId is missing', async () => {
    const result = await exchangeToken('code123', '', 'secret')
    expect(result.ok).toBe(false)
  })

  it('returns mock token in LOCAL mode', async () => {
    const result = await exchangeToken('code123', 'appId', 'secret', { isLocal: true })
    expect(result.ok).toBe(true)
    expect(result.data.access_token).toContain('mock_access_token')
    expect(result.data.token_type).toBe('bearer')
  })
})
