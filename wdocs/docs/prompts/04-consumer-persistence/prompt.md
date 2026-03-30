# Etapa 4 — Consumer de persistencia: NATS subscriber → MongoDB

## Objetivo
Crear el consumer que se suscribe a NATS y ejecuta la lógica que antes vivía en el webhook: findAccount, upsertContact, saveMessage, updateStatus. Es el primer subscriber del bus.

## Concepto clave

Pensá en esto como una analogía con un buzón de correo: antes el cartero (webhook) entregaba la carta y la archivaba él mismo. Ahora el cartero solo deja la carta en el buzón (NATS), y un empleado dedicado (este consumer) la recoge y la archiva. El cartero ya no necesita saber nada del archivo.

## Archivos a crear

### server/src/bus/subscribe.js

```
Implementa subscribeToSubject(nc, subject, handler) → Result

Función genérica de suscripción reutilizable por cualquier consumer.

nc: conexión NATS
subject: string con wildcards NATS (ej: "evt.*.coexistance.messaging.>")
handler: async function(envelope) → se llama por cada mensaje recibido

La función:
1. Crea la suscripción: const sub = nc.subscribe(subject)
2. Lanza un loop async (no bloqueante):
   (async () => {
     for await (const msg of sub) {
       try {
         const envelope = JSON.parse(StringCodec().decode(msg.data))
         console.log(`  [SUB] Received ${envelope.id} on ${subject}`)
         await handler(envelope)
       } catch (e) {
         console.error(`  [SUB] Handler error on ${subject}:`, e.message)
       }
     }
   })()
3. Log: console.log(`  [SUB] Subscribed to ${subject}`)
4. Retorna ok({ subject, sub }) — sub es la referencia para poder hacer unsubscribe después

import { ok, err } from '../lib/result.js'
import { StringCodec } from 'nats'
```

### server/src/bus/consumers/persist-message.js

```
Implementa createPersistMessageHandler(db) → async function(envelope)

Recibe db como dependencia (inyección), retorna el handler que subscribe.js va a llamar.

El handler recibe un envelope y:
1. Extrae el raw webhook body: envelope.data.payload
2. Parsea con parseWebhook(payload) — import de '../../meta/parse-webhook.js'
3. Si el tipo es 'message':
   a. Busca account por phone_number_id
   b. Upsert contact con upsertContact(db, accountId, sender, profileName)
   c. Save message con saveMessage(db, { ... })
   d. Log: console.log(`  [PERSIST] Message saved: ${type} from ${sender}`)
4. Si el tipo es 'status':
   a. Update status con updateMessageStatus(db, waMessageId, status)
   b. Log: console.log(`  [PERSIST] Status updated: ${waMessageId} → ${status}`)
5. Si el tipo es 'unknown':
   console.log('  [PERSIST] Unknown event type — skipping')

IMPORTANTE:
- Esta es EXACTAMENTE la misma lógica que tenían handleIncomingMessage y handleStatusUpdate
  en webhook-routes.js, pero extraída como un consumer independiente.
- NO hace broadcast al browser — eso es responsabilidad del SSE consumer (etapa 5).
- Errores se loguean pero no se propagan (el consumer sigue procesando otros mensajes).
  console.error('  [PERSIST] Failed to save:', e.message)

import { parseWebhook } from '../../meta/parse-webhook.js'
import { upsertContact } from '../../db/contacts/upsert-contact.js'
import { saveMessage } from '../../db/messages/save-message.js'
import { updateMessageStatus } from '../../db/messages/update-status.js'
```

## Archivos a modificar

### server/src/server.js

```
Agregar después de la conexión NATS:

import { subscribeToSubject } from './bus/subscribe.js'
import { createPersistMessageHandler } from './bus/consumers/persist-message.js'

// After NATS connects successfully:
if (nc) {
  // Subscribe the persistence consumer
  const persistHandler = createPersistMessageHandler(db)
  const subResult = subscribeToSubject(
    nc,
    'evt.*.coexistance.messaging.>',
    persistHandler
  )
  if (subResult.ok) console.log('  [NATS] Persistence consumer started')
  else console.error('  [NATS] Failed to start persistence consumer:', subResult.error)
}

NOTA: el wildcard 'evt.*.coexistance.messaging.>' captura todos los mensajes de
cualquier tenant, del producer coexistance, en el dominio messaging, cualquier canal/provider/kind.
```

## Tests a crear

```
server/tests/bus/subscribe.test.js
server/tests/bus/consumers/persist-message.test.js
```

- **subscribe**: mockear nc.subscribe, verificar que el handler se llama con el envelope deserializado, verificar log de errores
- **persist-message**: mockear db y funciones de persistencia, verificar que un envelope con message llama saveMessage, verificar que un envelope con status llama updateMessageStatus, verificar que errores se loguean sin crashear

## Verificación

```bash
bun test server/tests/bus/
```

Test manual (requiere NATS corriendo):
1. Arrancar el server: `bun src/server.js`
2. Ver en los logs: `[NATS] Persistence consumer started`
3. Enviar un webhook de Meta (o usar el smoke test de la etapa 6)
4. Ver en los logs: `[SUB] Received ...` seguido de `[PERSIST] Message saved: ...`
5. Verificar en MongoDB que el mensaje se persistió
