# NATS Ingress v0 — Ejecución autónoma completa

**Instrucción:** ejecutar las 7 etapas de implementación en secuencia sin intervención humana. Después de cada etapa, correr los tests indicados. Si fallan, corregir antes de avanzar. Al final, correr el suite completo.

---

## CONTEXTO DEL PROYECTO

Este proyecto es coexistance — un dashboard de WhatsApp Business con Bun.js + Express + MongoDB nativo.

### ARQUITECTURA v0 — NATS Pub/Sub desacoplado

El sistema usa NATS Core como bus de eventos para desacoplar ingress de consumers.
- El webhook recibe de Meta, responde 200 inmediato, construye un envelope, y hace nats.publish(). Nada más.
- Los consumers se suscriben a subjects de NATS de forma independiente:
  1. Consumer de persistencia: subscribe → findAccount → upsertContact → saveMessage (MongoDB)
  2. SSE Bridge: subscribe → stream al browser vía Server-Sent Events
- NO hay WebSocket. El frontend recibe eventos por SSE.
- Mañana se pueden agregar N consumers (AI agents, loggers, analytics) sin tocar el ingress.

### REGLAS ESTRICTAS del codebase

1. JavaScript plano (ES modules, .js). NO TypeScript. NO .ts.
2. NO classes, NO singletons, NO OOP. Solo funciones puras.
3. Una función exportada por archivo, max 200 líneas.
4. Result types para error handling: ok(data) y err(error). NUNCA throw para control flow.
   El Result type ya existe en src/lib/result.js: { ok: true, data } o { ok: false, error }
5. pipe() y pipeAsync() ya existen en src/lib/pipe.js para composición.
6. Bun.js como runtime. Usar APIs nativas de Bun cuando existan.
7. Express para HTTP. MongoDB native driver (no Mongoose).
8. Vitest para tests.
9. Comentarios en inglés.
10. Verbose logging con console.log — nada falla silenciosamente. Prefijo [TAG] en logs.
11. Dependencias se pasan como argumentos, no como globals ni imports de estado.
12. fetchJson() en src/lib/http.js es el wrapper HTTP del proyecto — retorna Result.
13. NATS_URL ya existe en env.js como var opcional con default nats://localhost:4222.

### Estructura actual

```
server/src/
├── auth/           (hash, verify, create tokens)
├── config/env.js   (readEnv — Object.freeze)
├── db/             (MongoDB — connect.js + subdirs por collection)
├── lib/            (result.js, pipe.js, match.js, http.js)
├── meta/           (WhatsApp Cloud API — parse-webhook.js, verify-webhook.js, etc.)
├── middleware/     (require-auth.js, require-account.js)
├── routes/         (7 archivos de rutas, cada uno export registerXxxRoutes(app, db, env, ...))
├── scripts/        (seed.js, fix-account.js — idempotentes)
├── ws/             (DEPRECATED — create-ws-server.js, no longer imported)
└── server.js       (entry point — compone todo, arranca el server)
```

El webhook actual está en routes/webhook-routes.js:
  POST /api/webhooks/whatsapp → res.status(200) inmediato → parseWebhook → findAccount → upsertContact → saveMessage → broadcast WS

Esto se va a desacoplar:
  INGRESS:   webhook → parseWebhook → buildEnvelope → nats.publish()
  CONSUMER:  nats.subscribe() → findAccount → upsertContact → saveMessage
  SSE:       nats.subscribe() → EventSource stream al browser

**ANTES DE EMPEZAR:** lee los archivos existentes para entender el estilo exacto:
- server/src/lib/result.js
- server/src/lib/pipe.js
- server/src/lib/http.js
- server/src/config/env.js
- server/src/meta/parse-webhook.js
- server/src/routes/webhook-routes.js
- server/src/server.js
- server/src/ws/create-ws-server.js
- server/src/db/contacts/upsert-contact.js
- server/src/db/messages/save-message.js
- server/src/db/messages/update-status.js

Seguir exactamente este estilo. Mirar los archivos existentes como referencia.

---

## PROTOCOLO DE EJECUCIÓN

Para CADA etapa:
1. Crear los archivos indicados
2. Crear los tests indicados
3. Correr `bun test server/tests/bus/` (o los tests específicos de la etapa)
4. Si algún test falla → corregir → volver a correr hasta que pasen todos
5. Solo entonces avanzar a la siguiente etapa

Si hay un error que no podés resolver en 3 intentos, dejá un comentario `// TODO: [descripción del problema]` y seguí con la siguiente etapa.

---

## ETAPA 1 — Bus core: validación, subject, utilidades

### Objetivo
Crear los building blocks puros del módulo bus. Todas funciones puras sin side effects, sin dependencias externas.

### Archivos a crear

**server/src/bus/validate-envelope.js:**
- validateEnvelope(obj) → Result
- Retorna ok(true) si el objeto tiene la forma correcta de un envelope, err(razón) si no.
- Campos requeridos (todos string excepto donde se indique): specversion, id, source, type, resource, time, traceid, causation_id (string o null), correlation_id, tenant, producer, domain, channel, provider, accountid, idempotencykey, transport (object), data (object)
- Dentro de transport: method (string) y protocol (string) son requeridos.
- Dentro de data: received_at (string), payload_inline (boolean), payload_bytes (number), payload_checksum (string) son requeridos. payload_ref (string o null), payload (any o null).
- Si payload_inline es true, payload no puede ser null.
- Si payload_inline es false, payload_ref no puede ser null.
- No validar el contenido del payload — solo la estructura del envelope.
- Mensajes de error descriptivos: "missing required field: tenant", "transport.method is required", etc.
- import { ok, err } from '../lib/result.js'

**server/src/bus/build-subject.js:**
- buildSubject({ tenant, producer, domain, channel, provider, kind, version }) → Result
- Formato: `evt.${tenant}.${producer}.${domain}.${channel}.${provider}.${kind}.v${version}`
- Ningún parámetro puede contener puntos (separadores de NATS). Si alguno tiene, retornar err.
- Ningún parámetro puede estar vacío. version default: 1
- Retorna ok(subject) o err(razón).
- import { ok, err } from '../lib/result.js'

**server/src/bus/idempotency-key.js:**
- idempotencyKey(rawBody) → string
- sha256 del JSON canonicalizado (JSON.stringify con keys sorted).
- Retorna "sha256:{hash}". Usa Bun.CryptoHasher('sha256') — NO crypto de Node.
- Helper: `const canonical = JSON.stringify(rawBody, Object.keys(rawBody).sort())`

**server/src/bus/check-payload-size.js:**
- checkPayloadSize(rawBody, threshold = 262144) → { inline: boolean, bytes: number }
- threshold default: 262144 (256 KB). Calcula bytes con Buffer.byteLength(JSON.stringify(rawBody))

**server/src/bus/filter-headers.js:**
- filterHeaders(headers, allowlist) → Record<string, string> filtrado
- allowlist default: ['content-type', 'x-hub-signature-256', 'x-hub-signature', 'x-request-id', 'user-agent']
- Normaliza keys a lowercase. Función pura.

### Tests: server/tests/bus/

- validate-envelope.test.js: envelope válido, cada campo faltante, tipos incorrectos, payload_inline true con payload null, payload_inline false con payload_ref null
- build-subject.test.js: subject válido, campo con punto, campo vacío, sin version (default 1)
- idempotency-key.test.js: determinista, distinto input ≠ output, formato "sha256:..."
- check-payload-size.test.js: 1KB → inline:true, 300KB → inline:false, threshold custom
- filter-headers.test.js: permitidos pasan, no permitidos se dropean, mayúsculas se normalizan

### Checkpoint: `bun test server/tests/bus/`

---

## ETAPA 2 — Envelope builder + conexión NATS + publish

### Dependencia
```bash
bun add nats ulid
```

### Archivos a crear

**server/src/bus/build-envelope.js:**
- buildEnvelope(rawBody, transport, context) → Result con el envelope completo
- context: { tenant, accountid, producer, traceid, correlationId, causationId, source, type, channel, provider, domain }
- Genera id con ulid(), time con ISO string
- Calcula idempotencykey con idempotencyKey(rawBody)
- Calcula payload_bytes y payload_checksum (sha256)
- En v0: payload_inline siempre true, payload_ref siempre null
- Arma envelope con: specversion "1.0", resource `tenant/${tenant}/account/${accountid}/channel/${channel}/provider/${provider}`, causation_id: context.causationId || null
- data: { received_at: time, payload_inline: true, payload_ref: null, payload_bytes, payload_checksum, payload: rawBody }
- Valida con validateEnvelope(). Si falla → err. Si pasa → ok(envelope).

**server/src/bus/connect-nats.js:**
- connectNats(url = 'nats://localhost:4222') → Promise<Result>
- import { connect } from 'nats'
- Log conectar/cerrar. Retorna ok(nc) o err(razón).
- NO variable global. Se pasa como argumento.
- Comentario: "En v1 (JetStream), también inicializará el JetStream context."

**server/src/bus/publish-event.js:**
- publishEvent(nc, subject, envelope) → Result
- Serializa con StringCodec. Setea header Nats-Msg-Id con envelope.idempotencykey (para futura dedup JetStream).
- Log publish ok/fail. Retorna ok({ eventId, subject, payloadBytes }) o err.
- Comentario: "En v1, cambiará a js.publish() con ack wait."

### Fixtures: server/tests/bus/fixtures/meta-webhook-samples.js
- textMessage, imageMessage, statusUpdate — copiar estructura exacta de parse-webhook.js

### Tests: build-envelope.test.js, connect-nats.test.js, publish-event.test.js

### Checkpoint: `bun test server/tests/bus/`

---

## ETAPA 3 — Ingress pipeline + webhook modificado

### Objetivo
Componer el pipeline y modificar el webhook para que SOLO parsee y publique. La persistencia se mueve al consumer (etapa 4).

### Archivos a crear

**server/src/bus/process-ingress.js:**
- processIngress(request, config) → Promise<Result>
- request: { rawBody, headers, tenant, accountid, correlationId }
- config: { nc, producer, metrics }  (metrics es opcional, puede ser undefined)
- Pipeline: filterHeaders → buildEnvelope → buildSubject → publishEvent
- transport = { method: 'webhook', protocol: 'https', headers: filteredHeaders }
- context = { tenant, accountid, producer, traceid: crypto.randomUUID(), correlationId, causationId: null, source: '/services/coexistance/ingress/meta/whatsapp', type: 'io.yoizen.messaging.ingress.received.v1', channel: 'whatsapp', provider: 'meta', domain: 'messaging' }
- Composición manual con early return (como el resto del codebase). NO pipeAsync.
- Log cada paso: `[BUS] Step: buildEnvelope → ok (id: ...)` o `→ FAILED: ...`
- Retorna ok({ eventId, subject, publishedAt, payloadBytes }) o err.

### Archivos a modificar

**server/src/server.js:**
1. Import connectNats de './bus/connect-nats.js'
2. Después de connectDb: `const natsResult = await connectNats(env.NATS_URL)` → nc o null con warning
3. Cambiar: `registerWebhookRoutes(app, db, env, broadcast)` → `registerWebhookRoutes(app, db, env, { nc })`
4. Agregar nats al log de startup
5. NO eliminar WS todavía

**server/src/routes/webhook-routes.js:**
- REESCRIBIR. Eliminar imports de upsertContact, saveMessage, updateMessageStatus
- Eliminar broadcast. Nuevo signature: `registerWebhookRoutes = (app, db, env, busConfig = {})`
- Mantener db solo para findAccount (necesitamos tenant/accountid)
- Import processIngress. Handler POST:
  1. res.status(200).send('EVENT_RECEIVED') inmediato
  2. parseWebhook
  3. findAccount por phone_number_id
  4. `const { nc, metrics } = busConfig`
  5. Si nc: processIngress({ rawBody, headers, tenant, accountid, correlationId }, { nc, producer: 'coexistance', metrics })
  6. Si no nc: warning log
- ELIMINAR handleIncomingMessage y handleStatusUpdate de este archivo (pasan al consumer en etapa 4)

### Tests: process-ingress.test.js

### Checkpoint: `bun test server/tests/bus/`

---

## ETAPA 4 — Consumer de persistencia: NATS subscriber → MongoDB

### Archivos a crear

**server/src/bus/subscribe.js:**
- subscribeToSubject(nc, subject, handler) → Result
- Genérica, reutilizable. nc.subscribe(subject) + loop async for await.
- Deserializa JSON, llama await handler(envelope) por cada mensaje.
- Log errores sin crashear. Retorna ok({ subject, sub }).
- import { ok, err } from '../lib/result.js' + import { StringCodec } from 'nats'

**server/src/bus/consumers/persist-message.js:**
- createPersistMessageHandler(db) → async function(envelope)
- Inyecta db, retorna handler. Extrae envelope.data.payload, parsea con parseWebhook.
- Si message: findAccount → upsertContact → saveMessage (EXACTA misma lógica que tenía webhook-routes.js)
- Si status: updateMessageStatus
- Si unknown: skip con log
- NO broadcast — eso es del SSE consumer.
- Errores se loguean, no se propagan.
- Imports: parseWebhook, upsertContact, saveMessage, updateMessageStatus

### Archivos a modificar

**server/src/server.js:**
- Import subscribeToSubject y createPersistMessageHandler
- Después de NATS connect, si nc:
  ```
  const persistHandler = createPersistMessageHandler(db)
  subscribeToSubject(nc, 'evt.*.coexistance.messaging.>', persistHandler)
  ```

### Tests: subscribe.test.js, consumers/persist-message.test.js

### Checkpoint: `bun test server/tests/bus/`

---

## ETAPA 5 — SSE Bridge: reemplaza WebSocket

### Archivos a crear

**server/src/bus/consumers/sse-bridge.js:**
- createSseBridge(nc) → { registerClient, removeClient, getClientCount }
- Subscribe a 'evt.*.coexistance.messaging.>' vía subscribeToSubject
- Map interno: accountId → Set<Response>
- Por cada evento NATS: extrae accountid, escribe a cada SSE client registrado
- ssePayload = { type: envelope.type, data: envelope.data.payload, eventId: envelope.id, tenant: envelope.tenant }
- res.write(`data: ${JSON.stringify(ssePayload)}\n\n`)

**server/src/routes/sse-routes.js:**
- registerSseRoutes(app, db, env, sseBridge) → void
- GET /api/events/stream
- Auth via query param ?token=xxx (EventSource no soporta headers custom)
- verifyToken, buscar user y account_ids
- Headers SSE: Content-Type text/event-stream, Cache-Control no-cache, Connection keep-alive
- Flush inicial: { type: 'connected' }
- registerClient por cada accountId
- Heartbeat 30s: `: heartbeat\n\n`
- On close: clearInterval, removeClient

### Archivos a modificar

**server/src/server.js:**
1. Import createSseBridge y registerSseRoutes
2. Crear sseBridge si nc: `sseBridge = createSseBridge(nc)`
3. registerSseRoutes(app, db, env, sseBridge)
4. ELIMINAR: import de createWsServer, const { broadcast } = createWsServer(...), línea ws: del log
5. Actualizar log: sse: /api/events/stream
6. NO eliminar el archivo ws/create-ws-server.js (por referencia histórica, no se usa)

### Tests: consumers/sse-bridge.test.js, routes/sse-routes.test.js

### Checkpoint: `bun test server/tests/bus/`

---

## ETAPA 6 — Tests de integración + smoke test

### Fixtures (si no existen de etapas anteriores)

**server/tests/bus/fixtures/meta-webhook-samples.js:**
- textMessage, imageMessage, statusUpdate — raw POST body de Meta. Copiar estructura de parse-webhook.js.

### Tests de integración

**server/tests/bus/integration/full-pipeline.test.js:**
- Flujo completo: processIngress → publish → persist-message handler
- Mockear nc y db. NO mockear processIngress/buildEnvelope/validateEnvelope/buildSubject.
- Verificar que saveMessage y upsertContact se llaman correctamente.

**server/tests/bus/integration/graceful-degradation.test.js:**
- connectNats con URL inválida → err
- nc null → webhook logea warning sin crashear

### Smoke test script

**server/src/scripts/smoke-test-nats.js:**
- Idempotente. `bun src/scripts/smoke-test-nats.js`
- Conecta NATS, subscribe temporal, publica con processIngress, espera 3s, verifica recepción
- Si NATS no disponible: mensaje claro y exit 0 (no es error)
- Cleanup con nc.drain()

### Checkpoint: `bun test server/tests/bus/`

---

## ETAPA 7 — Métricas básicas y health endpoint

### Archivos a crear

**server/src/bus/metrics.js:**
- createBusMetrics() → { increment, observe, snapshot, reset }
- NO prom-client. Map para counters, arrays para histogramas.
- increment(name, tags) — key interna: `${name}|${JSON.stringify(tags)}`
- observe(name, value, tags) — array de valores
- snapshot() → { counters: {...}, histograms: { name: { count, min, max, avg, p95 } } }
- reset() — limpia todo

**server/src/routes/bus-health-routes.js:**
- registerBusHealthRoutes(app, nc, busMetrics, sseBridge) → void
- GET /api/bus/health → { status, nats, sse_clients, metrics, timestamp }
- GET /api/bus/metrics → snapshot()

### Archivos a modificar

**server/src/bus/process-ingress.js:**
- Agregar métricas opcionales en el pipeline (if config.metrics):
  - ingress.received (counter, al inicio)
  - ingress.published (counter, si ok)
  - ingress.publish_failed (counter, si falla)
  - ingress.publish_latency_ms (histogram, tiempo de publish)
  - ingress.payload_bytes (histogram, tamaño)

**server/src/server.js:**
- Import createBusMetrics y registerBusHealthRoutes
- `const busMetrics = nc ? createBusMetrics() : null`
- Cambiar: `registerWebhookRoutes(app, db, env, { nc })` → `registerWebhookRoutes(app, db, env, { nc, metrics: busMetrics })`
- registerBusHealthRoutes(app, nc, busMetrics, sseBridge)

### Tests: metrics.test.js, bus-health-routes.test.js

### Checkpoint final: `bun test server/tests/bus/`

---

## VERIFICACIÓN FINAL

Después de las 7 etapas:

```bash
# Todo el suite de bus
bun test server/tests/bus/

# Smoke test si hay NATS disponible
bun src/scripts/smoke-test-nats.js

# Listar todos los archivos creados
find server/src/bus -name "*.js" | sort
find server/tests/bus -name "*.js" | sort
```

Estructura esperada:
```
server/src/bus/
├── build-envelope.js
├── build-subject.js
├── check-payload-size.js
├── connect-nats.js
├── consumers/
│   ├── persist-message.js
│   └── sse-bridge.js
├── filter-headers.js
├── idempotency-key.js
├── metrics.js
├── process-ingress.js
├── publish-event.js
├── subscribe.js
└── validate-envelope.js

server/src/routes/
├── bus-health-routes.js     (nuevo)
├── sse-routes.js            (nuevo)
└── webhook-routes.js        (modificado — solo parsea y publica)

server/tests/bus/
├── build-envelope.test.js
├── build-subject.test.js
├── check-payload-size.test.js
├── connect-nats.test.js
├── consumers/
│   ├── persist-message.test.js
│   └── sse-bridge.test.js
├── filter-headers.test.js
├── fixtures/
│   └── meta-webhook-samples.js
├── idempotency-key.test.js
├── integration/
│   ├── full-pipeline.test.js
│   └── graceful-degradation.test.js
├── metrics.test.js
├── process-ingress.test.js
├── publish-event.test.js
└── subscribe.test.js
```

Si todos los tests pasan, el trabajo está completo.
