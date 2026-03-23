// Exchanges a short-lived auth code (from Embedded Signup) for an access token.
// POST-signup, the frontend sends us the code from FB.login() response.
// We exchange it server-to-server with Meta's OAuth endpoint.
//
// Graph API: GET /{version}/oauth/access_token
//   ?client_id={app_id}
//   &client_secret={app_secret}
//   &code={code}

import { fetchJson } from '../lib/http.js'
import { ok, err } from '../lib/result.js'

const exchangeToken = async (code, appId, appSecret, opts = {}) => {
  if (!code || !appId || !appSecret) {
    return err('code, appId, and appSecret are required for token exchange')
  }

  const baseUrl = opts.baseUrl || 'https://graph.facebook.com/v22.0'

  // In LOCAL mode, return a mock token
  if (opts.isLocal) {
    console.log('  [LOCAL] Mocking token exchange for code:', code.slice(0, 10) + '...')
    return ok({
      access_token: `mock_access_token_${Date.now()}`,
      token_type: 'bearer',
    })
  }

  const url = new URL(`${baseUrl}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const result = await fetchJson(url.toString(), { method: 'GET' })

  if (!result.ok) {
    return err(`Token exchange failed: ${result.error?.message || result.error}`)
  }

  const { access_token, token_type } = result.data

  if (!access_token) {
    return err('Token exchange response missing access_token')
  }

  return ok({ access_token, token_type })
}

export { exchangeToken }
