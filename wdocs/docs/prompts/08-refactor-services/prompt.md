# Etapa 8 — Refactor: reorganizar por servicios

## Objetivo

Reorganizar el módulo bus/ y las rutas asociadas en una estructura por servicios, donde cada servicio es independiente, tiene su propio index.js, y se puede testear aislado. Es un refactor puro: se mueven archivos y se actualizan imports. NO se cambia lógica.

## Principio

`bus/` pasa a ser una librería de primitivas compartidas (connect, publish, subscribe, envelope, subject).
La lógica de negocio se mueve a `services/` donde cada carpeta es un servicio autocontenido con su index.js que expone una función de registro/inicio.

## Estructura final

```
server/src/
├── bus/                              # SHARED PRIMITIVES — sin lógica de negocio
│   ├── connect-nats.js               # (queda igual)
│   ├── publish-event.js              # (queda igual)
│   ├── subscribe.js                  # (queda igual)
│   ├── build-envelope.js             # (queda igual)
│   ├── build-subject.js              # (queda igual)
│   ├── validate-envelope.js          # (queda igual)
│   ├── idempotency-key.js            # (queda igual)
│   ├── check-payload-size.js         # (queda igual)
│   └── filter-headers.js             # (queda igual)
│
├── services/
│   ├── ingress/                      # webhook Meta → NATS
│   │   ├── index.js                  # registerIngress(app, { db, env, nc, metrics })
│   │   ├── process-ingress.js        # MOVIDO desde bus/process-ingress.js
│   │   └── routes.js                 # MOVIDO desde routes/webhook-routes.js
│   │
│   ├── persistence/                  # NATS → MongoDB
│   │   ├── index.js                  # startPersistence({ nc, db })
│   │   └── persist-message.js        # MOVIDO desde bus/consumers/persist-message.js
│   │
│   ├── sse/                          # NATS → browser SSE
│   │   ├── index.js                  # registerSse(app, { nc, db, env })
│   │   ├── sse-bridge.js             # MOVIDO desde bus/consumers/sse-bridge.js
│   │   └── routes.js                 # MOVIDO desde routes/sse-routes.js
│   │
│   └── health/                       # observabilidad
│       ├── index.js                  # registerHealth(app, { nc, metrics, sseBridge })
│       ├── metrics.js                # MOVIDO desde bus/metrics.js
│       └── routes.js                 # MOVIDO desde routes/bus-health-routes.js
│
├── routes/                           # solo rutas de negocio (auth, accounts, etc.)
│   ├── auth-routes.js                # (sin cambios)
│   ├── account-routes.js             # (sin cambios)
│   ├── conversation-routes.js        # (sin cambios)
│   ├── message-routes.js             # (sin cambios)
│   ├── template-routes.js            # (sin cambios)
│   └── token-routes.js               # (sin cambios)
│
├── server.js                         # compositor liviano
└── (todo lo demás sin cambios: lib/, db/, meta/, auth/, middleware/, config/, scripts/, ws/)
```

## Plan de movimiento (archivo por archivo)

### Paso 1 — Crear carpetas

```bash
mkdir -p server/src/services/ingress
mkdir -p server/src/services/persistence
mkdir -p server/src/services/sse
mkdir -p server/src/services/health
```

### Paso 2 — Mover archivos

```bash
# Ingress service
mv server/src/bus/process-ingress.js server/src/services/ingress/process-ingress.js
mv server/src/routes/webhook-routes.js server/src/services/ingress/routes.js

# Persistence service
mv server/src/bus/consumers/persist-message.js server/src/services/persistence/persist-message.js

# SSE service
mv server/src/bus/consumers/sse-bridge.js server/src/services/sse/sse-bridge.js
mv server/src/routes/sse-routes.js server/src/services/sse/routes.js

# Health service
mv server/src/bus/metrics.js server/src/services/health/metrics.js
mv server/src/routes/bus-health-routes.js server/src/services/health/routes.js
```

### Paso 3 — Eliminar carpeta vacía

```bash
rmdir server/src/bus/consumers
```

### Paso 4 — Actualizar imports en archivos movidos

**server/src/services/ingress/process-ingress.js:**
```
// ANTES:
import { ok, err } from '../lib/result.js'
import { filterHeaders } from './filter-headers.js'
import { buildEnvelope } from './build-envelope.js'
import { buildSubject } from './build-subject.js'
import { publishEvent } from './publish-event.js'

// AHORA:
import { ok, err } from '../../lib/result.js'
import { filterHeaders } from '../../bus/filter-headers.js'
import { buildEnvelope } from '../../bus/build-envelope.js'
import { buildSubject } from '../../bus/build-subject.js'
import { publishEvent } from '../../bus/publish-event.js'
```

**server/src/services/ingress/routes.js:**
```
// ANTES:
import { verifyWebhook } from '../meta/verify-webhook.js'
import { parseWebhook } from '../meta/parse-webhook.js'
import { processIngress } from '../bus/process-ingress.js'

// AHORA:
import { verifyWebhook } from '../../meta/verify-webhook.js'
import { parseWebhook } from '../../meta/parse-webhook.js'
import { processIngress } from './process-ingress.js'
```

**server/src/services/persistence/persist-message.js:**
```
// ANTES:
import { parseWebhook } from '../../meta/parse-webhook.js'
import { upsertContact } from '../../db/contacts/upsert-contact.js'
import { saveMessage } from '../../db/messages/save-message.js'
import { updateMessageStatus } from '../../db/messages/update-status.js'

// AHORA (misma profundidad, solo cambia el ../ base):
import { parseWebhook } from '../../meta/parse-webhook.js'
import { upsertContact } from '../../db/contacts/upsert-contact.js'
import { saveMessage } from '../../db/messages/save-message.js'
import { updateMessageStatus } from '../../db/messages/update-status.js'
```
NOTA: persist-message.js estaba en bus/consumers/ (2 niveles). Ahora está en services/persistence/ (2 niveles). Los imports a meta/ y db/ quedan IGUALES.

**server/src/services/sse/sse-bridge.js:**
```
// ANTES:
import { subscribeToSubject } from '../subscribe.js'

// AHORA:
import { subscribeToSubject } from '../../bus/subscribe.js'
```

**server/src/services/sse/routes.js:**
```
// ANTES:
import { verifyToken } from '../auth/verify-token.js'
import { ObjectId } from 'mongodb'

// AHORA:
import { verifyToken } from '../../auth/verify-token.js'
import { ObjectId } from 'mongodb'
```

**server/src/services/health/metrics.js:**
Sin cambios en imports — no importa nada del proyecto.

**server/src/services/health/routes.js:**
Sin cambios en imports — recibe todo por argumentos.

### Paso 5 — Crear index.js de cada servicio

**server/src/services/ingress/index.js:**
```javascript
// Ingress service — webhook Meta → parse → publish to NATS.
// Registers the webhook routes on the Express app.

import { registerWebhookRoutes } from './routes.js'

const registerIngress = (app, { db, env, nc, metrics }) => {
  registerWebhookRoutes(app, db, env, { nc, metrics })
  console.log('  [SERVICE] Ingress registered — POST /api/webhooks/whatsapp')
}

export { registerIngress }
```

**server/src/services/persistence/index.js:**
```javascript
// Persistence service — subscribes to NATS and saves messages to MongoDB.
// Starts the subscription. No routes.

import { subscribeToSubject } from '../../bus/subscribe.js'
import { createPersistMessageHandler } from './persist-message.js'

const startPersistence = ({ nc, db }) => {
  const handler = createPersistMessageHandler(db)
  const result = subscribeToSubject(nc, 'evt.*.coexistance.messaging.>', handler)

  if (result.ok) {
    console.log('  [SERVICE] Persistence started — subscribed to evt.*.coexistance.messaging.>')
  } else {
    console.error('  [SERVICE] Persistence FAILED to start:', result.error)
  }

  return result
}

export { startPersistence }
```

**server/src/services/sse/index.js:**
```javascript
// SSE service — subscribes to NATS and streams events to browser clients.
// Creates the bridge + registers the SSE route.

import { createSseBridge } from './sse-bridge.js'
import { registerSseRoutes } from './routes.js'

const registerSse = (app, { nc, db, env }) => {
  const sseBridge = createSseBridge(nc)
  registerSseRoutes(app, db, env, sseBridge)
  console.log('  [SERVICE] SSE registered — GET /api/events/stream')
  return sseBridge
}

export { registerSse }
```

**server/src/services/health/index.js:**
```javascript
// Health service — exposes bus metrics and NATS status.

import { createBusMetrics } from './metrics.js'
import { registerBusHealthRoutes } from './routes.js'

const registerHealth = (app, { nc, sseBridge }) => {
  const metrics = nc ? createBusMetrics() : null
  registerBusHealthRoutes(app, nc, metrics, sseBridge)
  console.log('  [SERVICE] Health registered — GET /api/bus/health, /api/bus/metrics')
  return metrics
}

export { registerHealth }
```

### Paso 6 — Reescribir server.js

```javascript
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
import { registerMessageRoutes } from './routes/message-routes.js'
import { registerTemplateRoutes } from './routes/template-routes.js'
import { registerTokenRoutes } from './routes/token-routes.js'

// Bus services
import { registerIngress } from './services/ingress/index.js'
import { startPersistence } from './services/persistence/index.js'
import { registerSse } from './services/sse/index.js'
import { registerHealth } from './services/health/index.js'

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

  app.use((req, _res, next) => {
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`  [${ts}] ${req.method} ${req.path}`)
    next()
  })

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
  registerMessageRoutes(app, db, env)
  registerTemplateRoutes(app, db, env)
  registerTokenRoutes(app, db, env)

  // Bus services — only start if NATS is available
  let sseBridge = null
  let busMetrics = null

  if (nc) {
    // Order matters: health first (creates metrics), then ingress (uses metrics),
    // then persistence + SSE (subscribers)
    busMetrics = registerHealth(app, { nc, sseBridge: null }).metrics  // sseBridge not yet created
    // Actually: health needs sseBridge for client count, so let's do:
    // 1. persistence (no deps on other services)
    // 2. SSE (creates sseBridge)
    // 3. health (needs sseBridge for count)
    // 4. ingress (needs metrics)

    startPersistence({ nc, db })
    sseBridge = registerSse(app, { nc, db, env })
    busMetrics = registerHealth(app, { nc, sseBridge })
    registerIngress(app, { db, env, nc, metrics: busMetrics })
  } else {
    // Register ingress without NATS — it will log warnings but not crash
    registerIngress(app, { db, env, nc: null, metrics: null })
  }

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
    services: ${nc ? 'ingress, persistence, sse, health' : 'ingress (degraded)'}
    db:       ${env.MONGODB_URI.split('@').pop() || env.MONGODB_URI}
    `)
  })

  return app
}

startServer().catch((e) => {
  console.error('\n  Failed to start server:', e.message)
  process.exit(1)
})
```

NOTA: registerHealth crea las metrics internamente y las retorna. El ingress las recibe de server.js. Esto invierte la dependencia — health es dueño de metrics, ingress solo las usa.

### Paso 7 — Mover tests (misma estructura)

```bash
# Crear carpetas de test
mkdir -p server/tests/services/ingress
mkdir -p server/tests/services/persistence
mkdir -p server/tests/services/sse
mkdir -p server/tests/services/health

# Mover tests
mv server/tests/bus/process-ingress.test.js server/tests/services/ingress/
mv server/tests/bus/consumers/persist-message.test.js server/tests/services/persistence/
mv server/tests/bus/consumers/sse-bridge.test.js server/tests/services/sse/
mv server/tests/bus/routes/sse-routes.test.js server/tests/services/sse/
mv server/tests/bus/metrics.test.js server/tests/services/health/
mv server/tests/bus/bus-health-routes.test.js server/tests/services/health/

# Integration tests quedan donde están
# server/tests/bus/integration/ — siguen siendo de integración cross-service

# Bus primitives tests quedan
# server/tests/bus/ — validate-envelope, build-subject, etc.

# Limpiar carpetas vacías
rmdir server/tests/bus/consumers 2>/dev/null || true
rmdir server/tests/bus/routes 2>/dev/null || true
```

### Paso 8 — Actualizar imports en tests movidos

Para cada test movido, actualizar los imports para reflejar la nueva ubicación.
Ejemplo para process-ingress.test.js:
```
// ANTES: import { processIngress } from '../../src/bus/process-ingress.js'
// AHORA: import { processIngress } from '../../../src/services/ingress/process-ingress.js'
```

Hacer lo mismo para todos los tests movidos. Verificar los paths relativos cuidadosamente.

### Paso 9 — Eliminar archivos obsoletos

```bash
# Estos archivos fueron MOVIDOS, no deben quedar en el lugar original
# Verificar que no existan duplicados:
ls server/src/bus/process-ingress.js 2>/dev/null && echo "ERROR: duplicado!" || echo "OK"
ls server/src/bus/consumers/ 2>/dev/null && echo "ERROR: carpeta no borrada!" || echo "OK"
ls server/src/bus/metrics.js 2>/dev/null && echo "ERROR: duplicado!" || echo "OK"
ls server/src/routes/webhook-routes.js 2>/dev/null && echo "ERROR: duplicado!" || echo "OK"
ls server/src/routes/sse-routes.js 2>/dev/null && echo "ERROR: duplicado!" || echo "OK"
ls server/src/routes/bus-health-routes.js 2>/dev/null && echo "ERROR: duplicado!" || echo "OK"
```

### Paso 10 — Eliminar import WS de server.js

El WebSocket server (ws/create-ws-server.js) ya no se importa en server.js.
El archivo ws/create-ws-server.js queda en el repo por referencia histórica pero no se usa.

## Verificación

```bash
# Todos los tests deben pasar después del refactor
bun test server/tests/

# Verificar estructura final
find server/src/services -type f -name "*.js" | sort
find server/src/bus -type f -name "*.js" | sort
find server/tests/services -type f -name "*.test.js" | sort
```

Estructura esperada después del refactor:
```
server/src/bus/          → 9 archivos (solo primitivas)
server/src/services/     → 4 carpetas × ~3 archivos = ~12 archivos
server/src/routes/       → 6 archivos (solo business routes, sin bus routes)
```

148 tests deben seguir pasando. Si alguno falla es SOLO por import paths — no se cambia lógica.
