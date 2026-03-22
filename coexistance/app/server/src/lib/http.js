// Thin wrapper over fetch that returns Result types.
// Every call to Meta's Graph API goes through here.

import { ok, err } from './result.js'

const fetchJson = async (url, options = {}) => {
  try {
    console.log(`  [HTTP] ${options.method || 'GET'} ${url}`)

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const body = await response.json().catch(() => null)

    if (!response.ok) {
      const metaError = body?.error?.message || `HTTP ${response.status}`
      const metaCode = body?.error?.code || null
      console.error(`  [HTTP] FAILED ${response.status}: ${metaError} (code: ${metaCode})`)
      return err({ message: metaError, status: response.status, code: metaCode })
    }

    console.log(`  [HTTP] OK ${response.status}`)
    return ok(body)
  } catch (e) {
    console.error(`  [HTTP] ERROR: ${e.message}`)
    return err({ message: e.message || String(e), status: 0, code: null })
  }
}

export { fetchJson }
