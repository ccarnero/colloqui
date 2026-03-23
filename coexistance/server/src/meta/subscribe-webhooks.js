// Subscribes our app to webhook events for a WhatsApp Business Account.
// Must be called after Embedded Signup so we receive messages for the new account.
//
// Graph API: POST /{version}/{waba_id}/subscribed_apps
//   Authorization: Bearer {access_token}

import { fetchJson } from '../lib/http.js'
import { ok, err } from '../lib/result.js'

const subscribeWebhooks = async (accessToken, wabaId, opts = {}) => {
  if (!accessToken || !wabaId) {
    return err('accessToken and wabaId are required')
  }

  const baseUrl = opts.baseUrl || 'https://graph.facebook.com/v22.0'

  // In LOCAL mode, mock the subscription
  if (opts.isLocal) {
    console.log('  [LOCAL] Mocking webhook subscription for WABA:', wabaId)
    return ok({ success: true })
  }

  const result = await fetchJson(`${baseUrl}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!result.ok) {
    return err(`Webhook subscription failed: ${result.error?.message || result.error}`)
  }

  return ok(result.data)
}

export { subscribeWebhooks }
