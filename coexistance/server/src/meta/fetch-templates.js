// Fetches approved message templates from Meta for a given WABA.
// Returns Result: ok([templates]) or err({ message }).

import { fetchJson } from '../lib/http.js'

const fetchTemplates = async (token, wabaId, { baseUrl, isLocal } = {}) => {
  if (isLocal) {
    console.log(`  [MOCK] fetch_templates for WABA ${wabaId}`)
    return {
      ok: true,
      data: [
        { name: 'hello_world', language: 'en_US', status: 'APPROVED', category: 'UTILITY' },
      ],
    }
  }

  const url = `${baseUrl}/${wabaId}/message_templates`

  return fetchJson(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export { fetchTemplates }
