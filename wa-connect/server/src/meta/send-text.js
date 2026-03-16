// Sends a text message via WhatsApp Cloud API.
// Returns Result: ok({ message_id }) or err({ message, status, code }).
//
// BSUID-aware: `to` can be a phone number OR a BSUID.

import { fetchJson } from '../lib/http.js'

const sendText = async (token, phoneNumberId, to, text, { baseUrl, isLocal } = {}) => {
  if (isLocal) {
    const mockId = `mock_${Date.now()}`
    console.log(`  [MOCK] send_text to ${to}: "${text.slice(0, 80)}"`)
    return { ok: true, data: { message_id: mockId, to } }
  }

  const url = `${baseUrl}/${phoneNumberId}/messages`
  console.log(`  [SEND] to: "${to}" | phoneNumberId: "${phoneNumberId}" | token: ${token.slice(0, 15)}...`)

  return fetchJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })
}

export { sendText }
