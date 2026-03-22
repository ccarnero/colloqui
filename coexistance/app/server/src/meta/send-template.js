// Sends a template message via WhatsApp Cloud API.
// Returns Result: ok({ message_id }) or err({ message, status, code }).
//
// BSUID-aware: `to` can be a phone number OR a BSUID.

import { fetchJson } from '../lib/http.js'

const sendTemplate = async (
  token,
  phoneNumberId,
  to,
  templateName,
  languageCode = 'en_US',
  components = [],
  { baseUrl, isLocal } = {}
) => {
  if (isLocal) {
    const mockId = `mock_tpl_${Date.now()}`
    console.log(`  [MOCK] send_template to ${to}: "${templateName}" (${languageCode})`)
    return { ok: true, data: { message_id: mockId, to, template: templateName } }
  }

  const url = `${baseUrl}/${phoneNumberId}/messages`

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  }

  if (components.length > 0) {
    payload.template.components = components
  }

  return fetchJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export { sendTemplate }
