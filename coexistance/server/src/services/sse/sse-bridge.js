// SSE Bridge consumer — subscribes to NATS and streams events to browser clients.
// Replaces the WebSocket broadcast. Clients connect via GET /api/events/stream.
// Each accountId maps to a Set of Response objects (active SSE connections).

import { subscribeToSubject } from '../../bus/subscribe.js'

const createSseBridge = (nc) => {
  // Map: accountId (string) → Set<Response>
  const clients = new Map()

  // Subscribe to all messaging events for all tenants
  subscribeToSubject(nc, 'evt.*.coexistance.messaging.>', async (envelope) => {
    const accountId = envelope.accountid

    if (!accountId) {
      console.warn('  [SSE] Received envelope without accountid — skipping')
      return
    }

    const accountClients = clients.get(accountId)
    if (!accountClients || accountClients.size === 0) {
      console.log(`  [SSE] No clients for account ${accountId} — event dropped`)
      return
    }

    const ssePayload = {
      type: envelope.type,
      data: envelope.data?.payload,
      eventId: envelope.id,
      tenant: envelope.tenant,
    }

    const sseChunk = `data: ${JSON.stringify(ssePayload)}\n\n`

    let sent = 0
    for (const res of accountClients) {
      try {
        res.write(sseChunk)
        sent++
      } catch (e) {
        console.error(`  [SSE] Failed to write to client for account ${accountId}: ${e.message}`)
        accountClients.delete(res)
      }
    }

    console.log(`  [SSE] Streamed event ${envelope.id} to ${sent} client(s) for account ${accountId}`)
  })

  const registerClient = (accountId, res) => {
    if (!clients.has(accountId)) {
      clients.set(accountId, new Set())
    }
    clients.get(accountId).add(res)
    console.log(`  [SSE] Client registered for account ${accountId} (total: ${clients.get(accountId).size})`)
  }

  const removeClient = (accountId, res) => {
    const accountClients = clients.get(accountId)
    if (accountClients) {
      accountClients.delete(res)
      console.log(`  [SSE] Client removed for account ${accountId} (remaining: ${accountClients.size})`)
      if (accountClients.size === 0) {
        clients.delete(accountId)
      }
    }
  }

  const getClientCount = () => {
    let total = 0
    for (const set of clients.values()) {
      total += set.size
    }
    return total
  }

  return { registerClient, removeClient, getClientCount }
}

export { createSseBridge }
