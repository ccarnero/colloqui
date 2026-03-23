// Entry point — composes all services, starts the server.
// No classes, no singletons. Just functions wired together.

import { createServer } from 'http'
import { resolve } from 'path'
import { existsSync } from 'fs'
import express from 'express'
import { readEnv } from './config/env.js'
import { connectDb } from './db/connect.js'
import { connectNats } from './bus/connect-nats.js'

// Business routes (auth, accounts, conversations, etc.)
import { registerAuthRoutes } from './routes/auth-routes.js'
import { registerAccountRoutes } from './routes/account-routes.js'
import { registerConversationRoutes } from './routes/conversation-routes.js'
import { registerTemplateRoutes } from './routes/template-routes.js'
import { registerTokenRoutes } from './routes/token-routes.js'

// Bus services
import { registerIngress } from './services/ingress/index.js'
import { registerEgress } from './services/egress/index.js'
import { startPersistence } from './services/persistence/index.js'
import { registerSse } from './services/sse/index.js'
import { registerHealth } from './services/health/index.js'
import { startAutoReply } from './services/auto-reply/index.js'

const startServer = async () => {
  const env = readEnv()
  const { db } = await connectDb(env.MONGODB_URI)

  // Connect to NATS — optional, server starts without it
  const natsResult = await connectNats(env.NATS_URL)
  const nc = natsResult.ok ? natsResult.data : null

  if (!nc) {
    console.warn('  [NATS] Running without NATS — bus services disabled')
  }

  const app = express()
  const httpServer = createServer(app)

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

  // Business routes
  registerAuthRoutes(app, db, env)
  registerAccountRoutes(app, db, env)
  registerConversationRoutes(app, db, env)
  registerTemplateRoutes(app, db, env)
  registerTokenRoutes(app, db, env)

  // Bus services — order: persistence + SSE first (subscribers), then health (needs sseBridge),
  // then ingress + egress (use metrics from health)
  let sseBridge = null
  let busMetrics = null

  if (nc) {
    startPersistence({ nc, db })
    sseBridge = registerSse(app, { nc, db, env })
    busMetrics = registerHealth(app, { nc, sseBridge })
    registerIngress(app, { db, env, nc, metrics: busMetrics })
    startAutoReply({ nc, db, env, metrics: busMetrics })
  } else {
    // Register ingress without NATS — logs warnings but does not crash
    registerIngress(app, { db, env, nc: null, metrics: null })
  }

  // Egress: registered after bus services so nc and busMetrics are resolved
  registerEgress(app, { db, env, nc, metrics: busMetrics })

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
    nats:     ${nc ? env.NATS_URL : 'DISABLED'}
    services: ${nc ? 'ingress, egress, persistence, sse, health, auto-reply' : 'ingress (degraded), egress (degraded)'}
    db:       ${env.MONGODB_URI.split('@').pop() || env.MONGODB_URI}
    `)
  })

  return app
}

startServer().catch((e) => {
  console.error('\n  Failed to start server:', e.message)
  process.exit(1)
})
