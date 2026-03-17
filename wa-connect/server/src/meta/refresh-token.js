// Exchanges a short-lived or long-lived token for a new long-lived token (~60 days).
// Uses Meta's fb_exchange_token grant type.
//
// Graph API: GET /{version}/oauth/access_token
//   ?grant_type=fb_exchange_token
//   &client_id={app_id}
//   &client_secret={app_secret}
//   &fb_exchange_token={current_token}
//
// Returns ok({ access_token, token_type, expires_in }) or err(message).

import { fetchJson } from '../lib/http.js'
import { ok, err } from '../lib/result.js'

const refreshToken = async (currentToken, appId, appSecret, opts = {}) => {
  if (!currentToken || !appId || !appSecret) {
    return err('currentToken, appId, and appSecret are required for token refresh')
  }

  const baseUrl = opts.baseUrl || 'https://graph.facebook.com/v22.0'

  // In LOCAL mode, return a mock long-lived token
  if (opts.isLocal) {
    console.log('  [LOCAL] Mocking token refresh')
    return ok({
      access_token: `mock_long_lived_token_${Date.now()}`,
      token_type: 'bearer',
      expires_in: 5184000, // 60 days in seconds
    })
  }

  const url = new URL(`${baseUrl}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('fb_exchange_token', currentToken)

  console.log('  [TOKEN] Exchanging for long-lived token...')
  const result = await fetchJson(url.toString(), { method: 'GET' })

  if (!result.ok) {
    const msg = result.error?.message || result.error
    console.error(`  [TOKEN] Refresh failed: ${msg}`)
    return err(`Token refresh failed: ${msg}`)
  }

  const { access_token, token_type, expires_in } = result.data

  if (!access_token) {
    return err('Token refresh response missing access_token')
  }

  console.log(`  [TOKEN] Refresh OK — expires_in: ${expires_in}s (~${Math.round((expires_in || 0) / 86400)} days)`)

  return ok({ access_token, token_type, expires_in: expires_in || 5184000 })
}

export { refreshToken }
