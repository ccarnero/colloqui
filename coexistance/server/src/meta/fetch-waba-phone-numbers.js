// Fetches phone numbers registered under a WhatsApp Business Account.
// After Embedded Signup, we use this to get the display_phone and verify
// the phone_number_id matches what the frontend reported.
//
// Graph API: GET /{version}/{waba_id}/phone_numbers
//   ?access_token={token}

import { fetchJson } from '../lib/http.js'
import { ok, err } from '../lib/result.js'

const fetchWabaPhoneNumbers = async (accessToken, wabaId, opts = {}) => {
  if (!accessToken || !wabaId) {
    return err('accessToken and wabaId are required')
  }

  const baseUrl = opts.baseUrl || 'https://graph.facebook.com/v22.0'

  // In LOCAL mode, return mock phone data
  if (opts.isLocal) {
    console.log('  [LOCAL] Mocking WABA phone numbers for:', wabaId)
    return ok({
      data: [
        {
          id: 'mock_phone_number_id_123',
          display_phone_number: '+1 555-012-3456',
          verified_name: 'Test Business',
          quality_rating: 'GREEN',
        },
      ],
    })
  }

  const result = await fetchJson(`${baseUrl}/${wabaId}/phone_numbers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!result.ok) {
    return err(`Failed to fetch phone numbers: ${result.error?.message || result.error}`)
  }

  return ok(result.data)
}

export { fetchWabaPhoneNumbers }
