// Entry point — composes all modules, starts the server.
// No classes, no singletons. Just functions wired together.

import { createServer } from 'http'
import { resolve } from 'path'
import { existsSync } from 'fs'
import express from 'express'
import { readEnv } from './config/env.js'
import { connectDb } from './db/connect.js'
import { createWsServer } from './ws/create-ws-server.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import { registerAccountRoutes } from './routes/account-routes.js'
import { registerWebhookRoutes } from './routes/webhook-routes.js'
import { registerConversationRoutes } from './routes/conversation-routes.js'
import { registerMessageRoutes } from './routes/message-routes.js'
import { registerTemplateRoutes } from './routes/template-routes.js'
import { registerTokenRoutes } from './routes/token-routes.js'

const startServer = async () => {
  const env = readEnv()
  const { db } = await connectDb(env.MONGODB_URI)

  const app = express()
  const httpServer = createServer(app)

  // WebSocket server — attached to same HTTP server
  const { broadcast } = createWsServer(httpServer, db, env)

  // Middleware
  app.use(express.json())

  // Request logger — so nothing arrives silently
  app.use((req, _res, next) => {
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`  [${ts}] ${req.method} ${req.path}`)
    next()
  })

  // CORS — allow Vite dev server in development
  if (env.NODE_ENV === 'development') {
    app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      if (_req.method === 'OPTIONS') return res.sendStatus(200)
      next()
    })
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Register all route modules — each receives app, db, env, and broadcast
  registerAuthRoutes(app, db, env)
  registerAccountRoutes(app, db, env)
  registerWebhookRoutes(app, db, env, broadcast)
  registerConversationRoutes(app, db, env)
  registerMessageRoutes(app, db, env)
  registerTemplateRoutes(app, db, env)
  registerTokenRoutes(app, db, env)

  // Serve frontend build in production
  const clientDist = resolve(import.meta.dir, '../../client/dist')
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist))
    app.get('*', (_req, res) => {
      res.sendFile(resolve(clientDist, 'index.html'))
    })
  }

  // Start listening
  httpServer.listen(Number(env.PORT), () => {
    console.log(`
  Coexistance server running:

    http://localhost:${env.PORT}

    mode:     ${env.IS_LOCAL ? 'LOCAL (mocked Meta API)' : 'LIVE'}
    meta api: ${env.META_API_VERSION}
    ws:       ws://localhost:${env.PORT}/ws
    db:       ${env.MONGODB_URI.split('@').pop() || env.MONGODB_URI}
    `)
  })

  return app
}

startServer().catch((e) => {
  console.error('\n  Failed to start server:', e.message)
  process.exit(1)
})
