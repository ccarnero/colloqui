// Creates a WebSocket server attached to the HTTP server.
// Clients authenticate by sending { type: 'auth', token: '...' } as first message.
// After auth, they receive broadcasts for their accounts.
//
// Broadcast types:
//   { type: 'new_message', data: { account_id, message } }
//   { type: 'status_update', data: { account_id, wa_message_id, status } }

import { WebSocketServer } from 'ws'
import { verifyToken } from '../auth/verify-token.js'
import { ObjectId } from 'mongodb'

const createWsServer = (httpServer, db, env) => {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  // Map: ws client → { userId, accountIds }
  const clients = new Map()

  wss.on('connection', (ws) => {
    // Client must authenticate within 5 seconds
    const authTimeout = setTimeout(() => {
      if (!clients.has(ws)) {
        ws.close(4001, 'Authentication timeout')
      }
    }, 5000)

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.type === 'auth' && msg.token) {
          clearTimeout(authTimeout)
          const result = verifyToken(msg.token, env.JWT_SECRET)

          if (!result.ok) {
            ws.close(4002, 'Invalid token')
            return
          }

          // Load user's account IDs
          const user = await db.collection('users').findOne(
            { _id: new ObjectId(result.data.sub) },
            { projection: { account_ids: 1 } }
          )

          const accountIds = (user?.account_ids || []).map((id) => id.toString())

          console.log(`  [WS] Client authenticated — user: ${result.data.sub}, accounts: [${accountIds.join(', ')}]`)

          clients.set(ws, { userId: result.data.sub, accountIds })
          ws.send(JSON.stringify({ type: 'auth_ok' }))
        }
      } catch {
        // ignore parse errors
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      clients.delete(ws)
    })

    ws.on('error', () => {
      clients.delete(ws)
    })
  })

  // Broadcast to all authenticated clients that have access to this account
  const broadcast = (accountId, event) => {
    const accountStr = accountId.toString()
    const payload = JSON.stringify(event)
    let sent = 0

    console.log(`  [WS] Broadcasting ${event.type} for account ${accountStr} to ${clients.size} client(s)`)

    for (const [ws, info] of clients) {
      const match = info.accountIds.includes(accountStr)
      console.log(`  [WS]   client ${info.userId}: accounts=[${info.accountIds.join(', ')}] match=${match} ready=${ws.readyState === 1}`)
      if (match && ws.readyState === 1) {
        ws.send(payload)
        sent++
      }
    }

    console.log(`  [WS] Sent to ${sent} client(s)`)
  }

  return { wss, broadcast }
}

export { createWsServer }
