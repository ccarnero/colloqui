# Etapa 3 — Ingress pipeline + webhook modificado

## Objetivo
Componer el pipeline de ingress y modificar el webhook para que SOLO parsee y publique a NATS. Todo el procesamiento (persistencia, notificación) se mueve a consumers en etapas siguientes.

## Archivos a crear

### server/src/bus/process-ingress.js

```
Implementa processIngress(request, config) → Promise<Result>

request: {
  rawBody: object,           // req.body del webhook (ya parseado por express.json())
  headers: Record<string, string>,  // req.headers
  tenant: string,
  accountid: string,
  correlationId: string,     // ID de la conversación o flujo
}

config: {
  nc: object,                // conexión NATS (de connectNats)
  producer: string,          // default "coexistance"
}

La función compone el pipeline paso a paso (composición manual con early return en cada paso, como hace el resto del codebase):

1. filterHeaders(request.headers) — usa allowlist default
2. buildEnvelope(request.rawBody, transport, context)
   donde transport = { method: 'webhook', protocol: 'https', headers: filteredHeaders }
   y context = {
     tenant: request.tenant,
     accountid: request.accountid,
     producer: config.producer,
     traceid: crypto.randomUUID(),
     correlationId: request.correlationId,
     causationId: null,   // null para ingress externo
     source: '/services/coexistance/ingress/meta/whatsapp',
     type: 'io.yoizen.messaging.ingress.received.v1',
     channel: 'whatsapp',
     provider: 'meta',
     domain: 'messaging',
   }
3. buildSubject({ tenant: request.tenant, producer: config.producer, domain: 'messaging', channel: 'whatsapp', provider: 'meta', kind: 'ingress', version: 1 })
4. publishEvent(config.nc, subject, envelope)

Si cualquier paso retorna un err, loguear y retornar inmediatamente.

Log en cada paso:
  console.log('  [BUS] Step: filterHeaders → ok')
  console.log('  [BUS] Step: buildEnvelope → ok (id: ...)')
  console.log('  [BUS] Step: buildSubject → ok (subject: ...)')
  console.log('  [BUS] Step: publishEvent → ok')

O en caso de error:
  console.error('  [BUS] Step: buildEnvelope → FAILED:', result.error)

Retorna ok({ eventId, subject, publishedAt, payloadBytes }) o err(razón).
```

## Archivos a modificar

### server/src/server.js

```
Modificaciones:

1. Importar connectNats:
   import { connectNats } from './bus/connect-nats.js'

2. Después de connectDb, agregar:
   const natsResult = await connectNats(env.NATS_URL)
   const nc = natsResult.ok ? natsResult.data : null
   if (!nc) console.warn('  [NATS] Not connected — bus publish disabled')

3. Cambiar la llamada a registerWebhookRoutes:
   ANTES:  registerWebhookRoutes(app, db, env, broadcast)
   AHORA:  registerWebhookRoutes(app, db, env, { nc })

   Se pasa un objeto busConfig para poder extenderlo en etapas futuras (metrics en etapa 7).
   NOTA: broadcast se elimina del webhook. Se usará en etapa 5 cuando SSE reemplace WS.

4. En el log de startup, agregar:
   nats: nc ? env.NATS_URL : 'not connected (bus disabled)'

5. NO eliminar el WS todavía — se elimina en etapa 5.
   Pero el webhook ya NO lo usa.
```

### server/src/routes/webhook-routes.js

```
REESCRIBIR webhook-routes.js — el webhook ahora SOLO parsea y publica a NATS.

Cambios:
- Eliminar import de upsertContact, saveMessage, updateMessageStatus
- Eliminar broadcast del signature
- Agregar busConfig al signature: registerWebhookRoutes = (app, db, env, busConfig = {})
- Mantener db solo para findAccount (necesitamos el tenant/accountid)
- Importar processIngress de '../bus/process-ingress.js'

El handler POST queda:

app.post('/api/webhooks/whatsapp', async (req, res) => {
  console.log('  [WEBHOOK] POST incoming event')
  res.status(200).send('EVENT_RECEIVED')  // immediate — Meta retries on timeout

  try {
    const event = parseWebhook(req.body)
    console.log('    parsed type:', event.type)

    if (event.type === 'unknown') {
      console.log('    unknown event — skipping')
      return
    }

    // Find account to get tenant ID
    const account = await db.collection('accounts').findOne({
      phone_number_id: event.data.phone_number_id,
    })

    if (!account) {
      console.warn(`  [WEBHOOK] NO ACCOUNT for phone_number_id: "${event.data.phone_number_id}"`)
      return
    }

    console.log(`  [WEBHOOK] Account: ${account.business_name} (${account._id})`)

    // Publish to NATS — the only job of the webhook now
    const { nc, metrics } = busConfig
    if (nc) {
      const result = await processIngress({
        rawBody: req.body,
        headers: req.headers,
        tenant: account._id.toString(),
        accountid: account._id.toString(),
        correlationId: event.data.wa_message_id || crypto.randomUUID(),
      }, { nc, producer: 'coexistance', metrics })

      if (result.ok) console.log(`  [BUS] Published: ${result.data.eventId}`)
      else console.error(`  [BUS] Publish failed: ${result.error}`)
    } else {
      console.warn('  [BUS] NATS not connected — event dropped')
    }
  } catch (e) {
    console.error('  [WEBHOOK] Processing error:', e.message)
  }
})

IMPORTANTE:
- handleIncomingMessage y handleStatusUpdate SE ELIMINAN de este archivo.
  Esa lógica pasa al consumer en etapa 4.
- El webhook ahora es un pipeline puro: recibir → parsear → publicar. Nada más.
- Si NATS no está conectado (nc es null), el evento se dropea con log.
```

## Tests a crear

```
server/tests/bus/process-ingress.test.js
```

- Pipeline completo con NATS mockeado → ok
- Cada punto de falla (buildEnvelope fail, buildSubject fail, publish fail) → err con log

## Verificación

```bash
bun test server/tests/bus/
```

Además, verificar que el servidor arranca sin NATS (graceful degradation):
```bash
NATS_URL=nats://localhost:9999 bun src/server.js
# Debe arrancar con warning "[NATS] Not connected — bus publish disabled"
```
