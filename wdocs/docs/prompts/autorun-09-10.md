# Ejecución autónoma — Etapas 09 + 10: Frontend SSE + Egress Bus

**Instrucción:** ejecutar las 2 etapas en secuencia sin intervención humana. Después de cada etapa, correr los tests. Si fallan, corregir antes de avanzar.

---

## CONTEXTO DEL PROYECTO

Este proyecto es coexistance — un dashboard de WhatsApp Business con Bun.js + Express + MongoDB nativo.

### Estado actual (post etapa 08)

El backend ya está reorganizado por servicios con NATS pub/sub:

```
server/src/
├── bus/                    # shared primitives (connect, publish, subscribe, envelope, subject, etc.)
├── services/
│   ├── ingress/            # webhook Meta → NATS (process-ingress.js, routes.js, index.js)
│   ├── persistence/        # NATS → MongoDB (persist-message.js, index.js)
│   ├── sse/                # NATS → browser SSE (sse-bridge.js, routes.js, index.js)
│   └── health/             # metrics + health endpoints (metrics.js, routes.js, index.js)
├── routes/                 # business routes (auth, accounts, conversations, messages, templates, tokens)
├── lib/                    # result.js, pipe.js, match.js, http.js
├── db/                     # MongoDB connect + collections
├── meta/                   # WhatsApp Cloud API (parse-webhook, send-text, send-template, etc.)
├── auth/                   # JWT (hash, verify, create tokens)
├── middleware/             # require-auth, require-account
├── ws/                     # DEPRECATED — create-ws-server.js (no longer imported)
├── scripts/                # seed, smoke-test-nats
└── server.js               # composes services
```

El frontend (client/) es React + Vite + Tailwind y TODAVÍA usa WebSocket:

```
client/src/
├── App.jsx                 # routing (login/register/dashboard)
├── context/auth-context.jsx # JWT auth state
├── lib/
│   ├── api.js              # fetch wrapper → /api/...
│   ├── use-event-stream.js # SSE hook → /api/events/stream
│   └── use-websocket.js    # DEPRECATED — replaced by use-event-stream.js
├── components/
│   ├── Sidebar.jsx         # conversation list
│   ├── ChatView.jsx        # message bubbles + send input
│   ├── ConnectAccount.jsx  # onboarding
│   ├── EmptyState.jsx
│   ├── AccountSelector.jsx
│   └── TemplatePicker.jsx
└── pages/
    ├── DashboardPage.jsx   # main dashboard (uses useWebSocket)
    ├── LoginPage.jsx
    ├── RegisterPage.jsx
    └── AccountSettingsPage.jsx
```

### REGLAS ESTRICTAS del codebase

1. JavaScript plano (ES modules, .js). NO TypeScript. NO .ts.
2. NO classes, NO singletons, NO OOP. Solo funciones puras.
3. Una función exportada por archivo, max 200 líneas.
4. Result types: ok(data) y err(error). NUNCA throw para control flow.
5. Bun.js runtime. Express HTTP. MongoDB native driver. Vitest tests.
6. Comentarios en inglés. UI text en español.
7. Verbose logging con [TAG] prefix. Nada falla silenciosamente.
8. Dependencias se pasan como argumentos, no como globals.

**ANTES DE EMPEZAR:** lee estos archivos para entender el estilo exacto:
- client/src/lib/use-event-stream.js
- client/src/lib/api.js
- client/src/pages/DashboardPage.jsx
- client/src/components/ChatView.jsx
- client/vite.config.js
- server/src/server.js
- server/src/services/sse/sse-bridge.js
- server/src/services/sse/routes.js
- server/src/routes/message-routes.js
- server/src/meta/send-text.js

---

## PROTOCOLO DE EJECUCIÓN

Para CADA etapa:
1. Leer los archivos involucrados primero
2. Crear/modificar archivos
3. Correr tests: `bun test server/tests/`
4. Si falla → corregir → repetir
5. Avanzar a la siguiente

---

## ETAPA 09 — Frontend: migrar WebSocket → SSE

### Objetivo
Reemplazar useWebSocket por useEventStream (SSE). El backend SSE ya funciona en GET /api/events/stream.

### Crear: client/src/lib/use-event-stream.js

```javascript
// SSE hook — connects to /api/events/stream via EventSource.
// Simpler than WebSocket: no auth handshake, auto-reconnect built-in.
// Token goes in URL query param (EventSource doesn't support custom headers).

import { useEffect, useRef } from 'react'

const useEventStream = (onMessage) => {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    let stopped = false
    let sse = null
    let reconnectTimer = null

    const connect = () => {
      if (stopped) return

      const token = localStorage.getItem('coexistance_token')
      if (!token) return

      try {
        sse = new EventSource(`/api/events/stream?token=${token}`)

        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'connected') {
              console.log('  [SSE] Connected')
              return
            }
            onMessageRef.current?.(data)
          } catch {
            // ignore parse errors
          }
        }

        sse.onerror = () => {
          console.warn('  [SSE] Connection error — will reconnect')
          sse?.close()
          sse = null
          if (!stopped) {
            reconnectTimer = setTimeout(connect, 5000)
          }
        }
      } catch (e) {
        console.warn('  [SSE] Failed to connect:', e.message)
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 5000)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      sse?.close()
    }
  }, [])
}

export { useEventStream }
```

### Modificar: client/src/pages/DashboardPage.jsx

Cambios exactos:

1. **Cambiar import:**
```
ANTES: import { useWebSocket } from '../lib/use-websocket.js'
AHORA: import { useEventStream } from '../lib/use-event-stream.js'
```

2. **Eliminar** activeAccountIdRef y su useEffect (líneas ~52-55):
```
// DELETE THESE LINES:
const activeAccountIdRef = useRef(null)
useEffect(() => {
  activeAccountIdRef.current = activeAccount?._id || null
}, [activeAccount?._id])
```

3. **Reemplazar** handleWsMessage con handleSseEvent:
```
ANTES:
const handleWsMessage = useCallback((event) => {
  if (event.type === 'new_message' || event.type === 'status_update') {
    const eventAccountId = event.data?.account_id
    const currentAccountId = activeAccountIdRef.current
    if (eventAccountId && currentAccountId && eventAccountId !== currentAccountId) {
      console.log(`[ws] ignoring event for account ${eventAccountId} (active: ${currentAccountId})`)
      return
    }
    refreshConversations()
    setRefreshTick((t) => t + 1)
  }
}, [refreshConversations])

useWebSocket(handleWsMessage)

AHORA:
const handleSseEvent = useCallback((event) => {
  // SSE bridge already filters by user's accounts — safe to refresh on any event
  console.log(`[sse] event: ${event.type} | eventId: ${event.eventId}`)
  refreshConversations()
  setRefreshTick((t) => t + 1)
}, [refreshConversations])

useEventStream(handleSseEvent)
```

4. **Marcar** use-websocket.js como deprecated:
   Add at line 1 of client/src/lib/use-websocket.js:
   `// DEPRECATED — replaced by use-event-stream.js`

### Checkpoint etapa 09

```bash
bun test server/tests/
```

Verificación visual (manual):
- Frontend debe conectar SSE (check DevTools → Network → EventSource)
- Messages should update in real-time when a webhook arrives

---

## ETAPA 10 — Egress: mensajes salientes al bus NATS

### Objetivo
Publicar mensajes salientes (send text, send template) al bus NATS. Crear un nuevo service: services/egress/.

### Crear: server/src/services/egress/process-egress.js

```javascript
// Egress pipeline — publishes outbound message events to NATS.
// Fire-and-forget: errors are logged but don't block the response.

import { ok, err } from '../../lib/result.js'
import { buildEnvelope } from '../../bus/build-envelope.js'
import { buildSubject } from '../../bus/build-subject.js'
import { publishEvent } from '../../bus/publish-event.js'

const processEgress = async (request, config) => {
  const { rawBody, tenant, accountid, correlationId, messageType } = request
  const { nc, producer, metrics } = config

  if (metrics) metrics.increment('egress.sent', { tenant, producer })

  console.log(`  [BUS] processEgress: start — tenant=${tenant} type=${messageType}`)

  const transport = {
    method: 'api',
    protocol: 'https',
    headers: {},
  }

  const context = {
    tenant,
    accountid,
    producer,
    traceid: crypto.randomUUID(),
    correlationId,
    causationId: null,
    source: '/services/coexistance/egress/meta/whatsapp',
    type: 'io.yoizen.messaging.egress.sent.v1',
    channel: 'whatsapp',
    provider: 'meta',
    domain: 'messaging',
  }

  const envelopeResult = buildEnvelope(rawBody, transport, context)
  if (!envelopeResult.ok) {
    console.error(`  [BUS] Egress buildEnvelope FAILED: ${envelopeResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer })
    return err(envelopeResult.error)
  }

  const subjectResult = buildSubject({
    tenant,
    producer,
    domain: 'messaging',
    channel: 'whatsapp',
    provider: 'meta',
    kind: 'sent',
    version: 1,
  })
  if (!subjectResult.ok) {
    console.error(`  [BUS] Egress buildSubject FAILED: ${subjectResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer })
    return err(subjectResult.error)
  }

  const publishResult = publishEvent(nc, subjectResult.data, envelopeResult.data)
  if (!publishResult.ok) {
    console.error(`  [BUS] Egress publish FAILED: ${publishResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer })
    return err(publishResult.error)
  }

  console.log(`  [BUS] Egress published: ${envelopeResult.data.id} to ${subjectResult.data}`)
  if (metrics) metrics.increment('egress.published', { tenant, producer })

  return ok({ eventId: envelopeResult.data.id, subject: subjectResult.data })
}

export { processEgress }
```

### Crear: server/src/services/egress/index.js

```javascript
// Egress service — handles outbound messages (send text, send template).
// Routes register on the Express app. Optionally publishes to NATS bus.

import { registerMessageRoutes } from './routes.js'

const registerEgress = (app, { db, env, nc, metrics }) => {
  registerMessageRoutes(app, db, env, { nc, metrics })
  console.log('  [SERVICE] Egress registered — POST /api/accounts/:id/messages/send')
}

export { registerEgress }
```

### Move + modify: server/src/routes/message-routes.js → server/src/services/egress/routes.js

```bash
mv server/src/routes/message-routes.js server/src/services/egress/routes.js
```

Then update the moved file:

1. **Fix imports** (deeper path now):
```
ANTES: import { sendText } from '../meta/send-text.js'
AHORA: import { sendText } from '../../meta/send-text.js'

ANTES: import { sendTemplate } from '../meta/send-template.js'
AHORA: import { sendTemplate } from '../../meta/send-template.js'

ANTES: import { saveMessage } from '../db/messages/save-message.js'
AHORA: import { saveMessage } from '../../db/messages/save-message.js'

ANTES: import { findContactByWaId } from '../db/contacts/find-contact-by-wa-id.js'
AHORA: import { findContactByWaId } from '../../db/contacts/find-contact-by-wa-id.js'

ANTES: import { requireAuth } from '../middleware/require-auth.js'
AHORA: import { requireAuth } from '../../middleware/require-auth.js'

ANTES: import { requireAccount } from '../middleware/require-account.js'
AHORA: import { requireAccount } from '../../middleware/require-account.js'
```

2. **Add import:**
```javascript
import { processEgress } from './process-egress.js'
```

3. **Change signature:**
```
ANTES: const registerMessageRoutes = (app, db, env) => {
AHORA: const registerMessageRoutes = (app, db, env, busConfig = {}) => {
```

4. **In the send text handler**, AFTER `res.json({ success: true, data: result.data })`, add:
```javascript
    // Shadow publish to NATS — fire-and-forget
    const { nc, metrics } = busConfig
    if (nc) {
      processEgress({
        rawBody: { to, text, direction: 'outbound', type: 'text', wa_message_id: result.data?.messages?.[0]?.id },
        tenant: req.account.tenant || 'default',
        accountid: req.account._id.toString(),
        correlationId: result.data?.messages?.[0]?.id || crypto.randomUUID(),
        messageType: 'text',
      }, { nc, producer: 'coexistance', metrics })
        .then(r => {
          if (r.ok) console.log(`  [BUS] Egress text ok: ${r.data.eventId}`)
          else console.error(`  [BUS] Egress text failed: ${r.error}`)
        })
    }
```

5. **In the send template handler**, AFTER `res.json({ success: true, data: result.data })`, add:
```javascript
    // Shadow publish to NATS — fire-and-forget
    const { nc: nc2, metrics: metrics2 } = busConfig
    if (nc2) {
      processEgress({
        rawBody: { to, template_name, language_code, direction: 'outbound', type: 'template', wa_message_id: result.data?.messages?.[0]?.id },
        tenant: req.account.tenant || 'default',
        accountid: req.account._id.toString(),
        correlationId: result.data?.messages?.[0]?.id || crypto.randomUUID(),
        messageType: 'template',
      }, { nc: nc2, producer: 'coexistance', metrics: metrics2 })
        .then(r => {
          if (r.ok) console.log(`  [BUS] Egress template ok: ${r.data.eventId}`)
          else console.error(`  [BUS] Egress template failed: ${r.error}`)
        })
    }
```

NOTE: use nc2/metrics2 variable names to avoid shadowing the outer busConfig destructure.
Better approach: destructure busConfig ONCE at the top of the function body:
```javascript
const registerMessageRoutes = (app, db, env, busConfig = {}) => {
  const auth = requireAuth(db, env)
  const account = requireAccount(db)
  const metaOpts = { baseUrl: env.META_BASE_URL, isLocal: env.IS_LOCAL }
  const { nc, metrics } = busConfig  // destructure once here
  // ... use nc and metrics in both handlers
```

### Modify: server/src/server.js

```
1. Remove old import:
   DELETE: import { registerMessageRoutes } from './routes/message-routes.js'

2. Add new import:
   ADD: import { registerEgress } from './services/egress/index.js'

3. Replace the call:
   ANTES: registerMessageRoutes(app, db, env)
   AHORA: registerEgress(app, { db, env, nc, metrics: busMetrics })

   IMPORTANT: this line must be AFTER busMetrics is created (inside the if(nc) block or after it).
   Since egress should work even without NATS (just won't publish), move it outside the if(nc):

   // After the if(nc) block:
   registerEgress(app, { db, env, nc, metrics: busMetrics })

   And REMOVE registerMessageRoutes from the business routes section.

4. Update startup log:
   services: ${nc ? 'ingress, egress, persistence, sse, health' : 'ingress (degraded), egress (degraded)'}
```

### Tests to create

```
server/tests/services/egress/process-egress.test.js
```

- Pipeline with mocked NATS → ok result
- buildEnvelope failure → err
- publish failure → err
- Metrics increment on success/failure
- Subject uses kind: 'sent' (not 'received')
- Transport method is 'api' (not 'webhook')

### Checkpoint etapa 10

```bash
bun test server/tests/
```

---

## VERIFICACIÓN FINAL

```bash
# All tests
bun test server/tests/

# Verify structure
find server/src/services -type f -name "*.js" | sort
# Expected: 5 services (ingress, egress, persistence, sse, health) × ~3 files each

# Verify message-routes.js no longer in routes/
ls server/src/routes/message-routes.js 2>/dev/null && echo "ERROR: not moved!" || echo "OK: moved to egress"
```

### Full flow verification (manual)

```
RECIBIR:
  Meta webhook → ingress service → NATS → persistence (MongoDB) + SSE (browser)
  Browser receives SSE event → refreshConversations → UI updated

ENVIAR:
  UI → POST /send → egress service → Meta API + MongoDB + NATS (fire-and-forget)
                                      → SSE bridge → browser → UI refresh
```

Both directions flow through NATS. Frontend uses SSE. No WebSocket.
