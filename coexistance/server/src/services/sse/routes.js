// GET /api/events/stream — Server-Sent Events endpoint for real-time updates.
// Auth via ?token=xxx query param (EventSource does not support custom headers).
// Streams NATS events to authenticated browser clients.

import { verifyToken } from '../../auth/verify-token.js'
import { ObjectId } from 'mongodb'

const registerSseRoutes = (app, db, env, sseBridge) => {
  app.get('/api/events/stream', async (req, res) => {
    console.log('  [SSE] Client connecting...')

    // Auth via query param — EventSource doesn't support custom headers
    const token = req.query.token
    if (!token) {
      console.warn('  [SSE] Missing token — 401')
      return res.status(401).json({ error: 'token required' })
    }

    const tokenResult = verifyToken(token, env.JWT_SECRET)
    if (!tokenResult.ok) {
      console.warn(`  [SSE] Invalid token: ${tokenResult.error}`)
      return res.status(401).json({ error: 'invalid token' })
    }

    // Load user and their account IDs
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(tokenResult.data.sub) },
      { projection: { account_ids: 1 } }
    )

    if (!user) {
      console.warn(`  [SSE] User not found: ${tokenResult.data.sub}`)
      return res.status(401).json({ error: 'user not found' })
    }

    const accountIds = (user.account_ids || []).map((id) => id.toString())
    console.log(`  [SSE] Authenticated user ${tokenResult.data.sub} — accounts: [${accountIds.join(', ')}]`)

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

    // Register this response as a client for all user accounts
    for (const accountId of accountIds) {
      sseBridge.registerClient(accountId, res)
    }

    // Heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 30000)

    // Cleanup on disconnect
    req.on('close', () => {
      console.log(`  [SSE] Client disconnected — user: ${tokenResult.data.sub}`)
      clearInterval(heartbeat)
      for (const accountId of accountIds) {
        sseBridge.removeClient(accountId, res)
      }
    })
  })
}

export { registerSseRoutes }
