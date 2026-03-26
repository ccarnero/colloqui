# Etapa 10 — Egress: mensajes salientes al bus

## Objetivo
Publicar mensajes salientes (envío de texto y templates) al bus NATS, igual que los entrantes. Así TODO el tráfico de mensajería pasa por el bus, habilitando futuros consumers (analytics, AI agents, audit log).

## Contexto actual

El envío de mensajes en `message-routes.js` hace:
1. Recibe POST /api/accounts/:accountId/messages/send
2. Llama sendText() → Meta Cloud API
3. Guarda en MongoDB con saveMessage()
4. Responde al frontend

Esto no pasa por NATS. El bus solo ve los mensajes entrantes (ingress).

## Arquitectura deseada

```
Frontend → POST /send → message-routes.js → sendText(Meta API)
                                           → saveMessage(MongoDB)
                                           → nats.publish() ← NUEVO
```

El publish al bus es fire-and-forget (shadow publish) — no bloquea la respuesta al frontend. Si falla el publish a NATS, el mensaje ya se envió y se guardó. Solo se loguea el error.

## Nuevo servicio: services/egress/

```
server/src/services/egress/
├── index.js                # registerEgress(app, { db, env, nc, metrics })
├── process-egress.js       # pipeline: buildEnvelope → buildSubject → publishEvent
└── routes.js               # MOVIDO desde routes/message-routes.js
```

### server/src/services/egress/process-egress.js

```javascript
// Egress pipeline — publishes outbound message events to NATS.
// Similar to ingress but for outbound direction.
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
    method: 'api',           // outbound goes via API, not webhook
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

  // Build envelope
  const envelopeResult = buildEnvelope(rawBody, transport, context)
  if (!envelopeResult.ok) {
    console.error(`  [BUS] Egress buildEnvelope FAILED: ${envelopeResult.error}`)
    if (metrics) metrics.increment('egress.publish_failed', { tenant, producer })
    return err(envelopeResult.error)
  }

  // Build subject — egress uses kind: 'sent' instead of 'received'
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

  // Publish
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

### server/src/services/egress/routes.js

```
MOVER routes/message-routes.js → services/egress/routes.js

Cambios al archivo:
1. Actualizar imports:
   ANTES: import { sendText } from '../meta/send-text.js'
   AHORA: import { sendText } from '../../meta/send-text.js'
   (y lo mismo para sendTemplate, saveMessage, findContactByWaId, requireAuth, requireAccount)

2. Agregar import:
   import { processEgress } from './process-egress.js'

3. Cambiar signature:
   ANTES: registerMessageRoutes = (app, db, env)
   AHORA: registerMessageRoutes = (app, db, env, busConfig = {})

4. En el handler POST /send, DESPUÉS de saveMessage (exitoso), agregar:

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
         if (r.ok) console.log(`  [BUS] Egress publish ok: ${r.data.eventId}`)
         else console.error(`  [BUS] Egress publish failed: ${r.error}`)
       })
   }

5. Igual para send-template, adaptando rawBody y messageType: 'template'

IMPORTANTE:
- El publish es DESPUÉS de la respuesta al frontend (fire-and-forget via .then())
- Si NATS no está conectado (nc null), no se hace nada
- Si el publish falla, el mensaje ya se envió a Meta y se guardó en MongoDB
```

### server/src/services/egress/index.js

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

## Archivos a modificar

### server/src/server.js

```
1. Eliminar import de registerMessageRoutes (se movió a egress service)
   ANTES: import { registerMessageRoutes } from './routes/message-routes.js'
   AHORA: import { registerEgress } from './services/egress/index.js'

2. Cambiar la llamada:
   ANTES: registerMessageRoutes(app, db, env)
   AHORA: registerEgress(app, { db, env, nc, metrics: busMetrics })

3. Actualizar lista de services en log de startup:
   services: ${nc ? 'ingress, egress, persistence, sse, health' : 'ingress (degraded), egress (degraded)'}
```

### server/src/services/sse/sse-bridge.js

```
Actualizar el subject de suscripción para capturar también eventos egress:

ANTES:  'evt.*.coexistance.messaging.>'
AHORA:  'evt.*.coexistance.messaging.>'

NOTA: el wildcard '>' ya captura TODOS los sub-subjects, incluyendo:
  evt.TENANT.coexistance.messaging.whatsapp.meta.received.v1 (ingress)
  evt.TENANT.coexistance.messaging.whatsapp.meta.sent.v1     (egress)

Así que NO hay que cambiar nada en el subscriber. Los eventos egress
llegan automáticamente al SSE bridge y al persistence consumer.
```

### server/src/services/persistence/persist-message.js

```
El persistence consumer recibe TODOS los eventos de messaging.
Los eventos egress llegan con envelope.type = 'io.yoizen.messaging.egress.sent.v1'
y envelope.data.payload = { to, text, direction: 'outbound', ... }

Esto NO va a hacer doble-save porque el payload del egress no tiene la estructura
de un webhook de Meta (no tiene entry[].changes[].value.messages[]).
parseWebhook retornará { type: 'unknown' } y el consumer lo skipea.

Esto es correcto — el mensaje outbound ya se guardó en MongoDB dentro de message-routes.
El evento egress en NATS es para otros consumers (analytics, AI agents, audit).

NO HAY QUE CAMBIAR persist-message.js.
```

## Tests a crear

```
server/tests/services/egress/process-egress.test.js
```

- Pipeline completo con NATS mock → ok
- Build envelope fail → err
- Publish fail → err
- Metrics se incrementan correctamente

## Verificación

```bash
bun test server/tests/

# Test manual:
# 1. Arrancar server + NATS
# 2. Login en el dashboard
# 3. Enviar un mensaje desde el chat
# 4. Ver en logs:
#    [SEND] to: "..." (Meta API)
#    [BUS] Egress published: 01JQ... to evt.TENANT.coexistance.messaging.whatsapp.meta.sent.v1
# 5. curl http://localhost:6666/api/bus/metrics | jq .
#    Debe mostrar egress.sent y egress.published > 0
```

## Flow completo después de esta etapa

```
RECIBIR:
  Meta → webhook → NATS publish → [persistence consumer → MongoDB]
                                 → [SSE bridge → browser → UI refresh]

ENVIAR:
  UI → POST /send → Meta API + MongoDB save + NATS publish (fire-and-forget)
                                              → [SSE bridge → browser → UI refresh]
                                              → [future: analytics, AI agents]
```
