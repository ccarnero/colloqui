# Stage 12 — Servicio auto-reply (ping → pong)

## Objetivo

Crear un nuevo consumer NATS (`services/auto-reply/`) que escuche mensajes entrantes, evalúe reglas simples, y dispare una respuesta automática cuando hay match. Primera regla: si el texto es "ping", responder "pong".

## Contexto

El pipeline de ingress YA funciona. Cuando llega un mensaje de WhatsApp:

```
Meta webhook → POST /api/webhooks/whatsapp → processIngress() → NATS publish
  subject: evt.default.coexistance.messaging.whatsapp.meta.received.v1
```

Los consumers existentes (persistence, SSE bridge) se subscriben a `evt.*.coexistance.messaging.>`. El nuevo auto-reply se subscribe al subject más específico de mensajes recibidos.

El envelope que llega al consumer tiene esta estructura:

```json
{
  "specversion": "1.0",
  "id": "01KMBZ...",
  "tenant": "default",
  "producer": "coexistance",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "69bea8cd868e860918359cc7",
  "data": {
    "payload_inline": true,
    "payload": {
      "object": "whatsapp_business_account",
      "entry": [{
        "changes": [{
          "value": {
            "messages": [{
              "from": "541134602008",
              "type": "text",
              "text": { "body": "ping" }
            }]
          }
        }]
      }]
    }
  }
}
```

Para enviar la respuesta se usa la ruta de egress existente:

```
POST /api/accounts/:accountId/messages/send
Body: { "to": "<wa_id>", "text": "pong" }
Headers: { "Authorization": "Bearer <token>" }
```

**PERO** esta ruta requiere JWT auth (middleware `requireAuth`). Para el auto-reply interno tenemos 2 opciones:

- **Opción A (recomendada v0):** Llamar directamente a `sendText()` + `saveMessage()` + `processEgress()` sin pasar por HTTP. Evita el problema de auth.
- **Opción B:** Crear un service token interno. Más complejo, dejarlo para v1.

Usar **Opción A**: importar directamente las funciones de egress y meta.

## Reglas del proyecto

- Functional programming, no classes — pure functions, un export por archivo
- Result types: `{ ok: true, data }` / `{ ok: false, error }` — NUNCA throw
- Max 200 líneas por archivo
- Verbose logging — nada falla en silencio
- Vitest para tests
- Bun runtime

---

## Paso 1 — Crear estructura del servicio

```
server/src/services/auto-reply/
├── index.js              # startAutoReply({ nc, db, env })
├── evaluate-rules.js     # evaluateRules(envelope) → match | null
├── execute-reply.js      # executeReply(match, account, db, env) → Result
└── rules/
    └── ping-pong.js      # pingPong(messages) → match | null
```

## Paso 2 — `rules/ping-pong.js`

```javascript
// Rule: if inbound text is exactly "ping" (case insensitive), reply "pong"
//
// Receives the messages array from the Meta webhook payload.
// Returns a match object or null.

const pingPong = (messages) => {
  if (!messages || messages.length === 0) return null

  const msg = messages[0]
  if (msg.type !== 'text') return null

  const body = msg.text?.body?.toLowerCase().trim()
  if (body !== 'ping') return null

  return {
    rule: 'ping-pong',
    action: 'send_text',
    to: msg.from,
    text: 'pong',
  }
}

export { pingPong }
```

Test `rules/ping-pong.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { pingPong } from './ping-pong.js'

describe('pingPong rule', () => {
  it('matches "ping" text message', () => {
    const messages = [{ type: 'text', from: '5491112345678', text: { body: 'ping' } }]
    const result = pingPong(messages)
    expect(result).toEqual({
      rule: 'ping-pong',
      action: 'send_text',
      to: '5491112345678',
      text: 'pong',
    })
  })

  it('matches "PING" (case insensitive)', () => {
    const messages = [{ type: 'text', from: '123', text: { body: '  PING  ' } }]
    expect(pingPong(messages)).not.toBeNull()
  })

  it('returns null for non-ping text', () => {
    const messages = [{ type: 'text', from: '123', text: { body: 'hello' } }]
    expect(pingPong(messages)).toBeNull()
  })

  it('returns null for image message', () => {
    const messages = [{ type: 'image', from: '123' }]
    expect(pingPong(messages)).toBeNull()
  })

  it('returns null for empty messages', () => {
    expect(pingPong([])).toBeNull()
    expect(pingPong(null)).toBeNull()
  })
})
```

## Paso 3 — `evaluate-rules.js`

```javascript
// Evaluate all auto-reply rules against an incoming envelope.
// Returns the first matching rule result, or null if none match.
//
// To add a new rule: create a file in rules/, import it here, add to RULES array.

import { pingPong } from './rules/ping-pong.js'

const RULES = [pingPong]

const evaluateRules = (envelope) => {
  // Extract messages array from Meta webhook payload
  const messages = envelope?.data?.payload?.entry?.[0]?.changes?.[0]?.value?.messages
  if (!messages || messages.length === 0) return null

  for (const rule of RULES) {
    const match = rule(messages)
    if (match) return match
  }

  return null
}

export { evaluateRules }
```

Test `evaluate-rules.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { evaluateRules } from './evaluate-rules.js'

const makeEnvelope = (body) => ({
  id: 'test-001',
  accountid: 'acc-123',
  data: {
    payload: {
      entry: [{
        changes: [{
          value: {
            messages: [{ type: 'text', from: '5491112345678', text: { body } }]
          }
        }]
      }]
    }
  }
})

describe('evaluateRules', () => {
  it('returns ping-pong match for "ping"', () => {
    const result = evaluateRules(makeEnvelope('ping'))
    expect(result).toEqual({
      rule: 'ping-pong',
      action: 'send_text',
      to: '5491112345678',
      text: 'pong',
    })
  })

  it('returns null for non-matching text', () => {
    expect(evaluateRules(makeEnvelope('hello'))).toBeNull()
  })

  it('returns null for envelope without messages', () => {
    expect(evaluateRules({ data: { payload: {} } })).toBeNull()
    expect(evaluateRules({})).toBeNull()
    expect(evaluateRules(null)).toBeNull()
  })
})
```

## Paso 4 — `execute-reply.js`

Esta función ejecuta el envío llamando directamente a las funciones de meta y persistencia, sin pasar por HTTP.

```javascript
// Execute an auto-reply action: send via Meta API, save to DB, publish to NATS.
//
// Reuses the same functions as the egress route but bypasses HTTP + auth.
// This is the "Opción A" approach — direct function calls.

import { sendText } from '../../meta/send-text.js'
import { saveMessage } from '../../db/save-message.js'
import { processEgress } from '../egress/process-egress.js'

const executeReply = async (match, account, db, env, busConfig) => {
  const { to, text, rule } = match
  const accountId = account._id.toString()

  console.log(`  [AUTO-REPLY] Executing rule="${rule}" → sendText to=${to} text="${text}"`)

  // 1. Send via Meta API
  const sendResult = await sendText(
    account.access_token,
    account.phone_number_id,
    to,
    text,
    env
  )

  if (!sendResult.ok) {
    console.error(`  [AUTO-REPLY] sendText failed: ${sendResult.error}`)
    return { ok: false, error: `sendText failed: ${sendResult.error}` }
  }

  const waMessageId = sendResult.data?.messages?.[0]?.id || 'unknown'
  console.log(`  [AUTO-REPLY] sendText ok — wa_message_id=${waMessageId}`)

  // 2. Save to MongoDB
  try {
    await saveMessage(db, {
      account_id: account._id,
      wa_message_id: waMessageId,
      wa_sender_id: to,
      direction: 'outbound',
      source: 'auto-reply',
      type: 'text',
      content: { text },
      status: 'sent',
    })
    console.log(`  [AUTO-REPLY] Message saved to DB`)
  } catch (e) {
    console.error(`  [AUTO-REPLY] saveMessage error: ${e.message}`)
    // Non-fatal — message was already sent via Meta
  }

  // 3. Shadow publish to NATS (fire-and-forget)
  if (busConfig?.nc) {
    processEgress(
      { body: { to, text, wa_message_id: waMessageId }, tenant: 'default', accountid: accountId },
      { nc: busConfig.nc, metrics: busConfig.metrics }
    ).then((r) => {
      if (r.ok) console.log(`  [AUTO-REPLY] NATS egress published: ${r.data.eventId}`)
      else console.warn(`  [AUTO-REPLY] NATS egress failed: ${r.error}`)
    })
  }

  return { ok: true, data: { waMessageId, rule, to, text } }
}

export { executeReply }
```

**IMPORTANTE:** Verifica los imports. Los paths y firmas de `sendText` y `saveMessage` pueden variar ligeramente. Revisa:

```bash
# Verificar firma de sendText
head -20 server/src/meta/send-text.js

# Verificar firma de saveMessage (o cómo se guarda en egress routes)
grep -n 'saveMessage\|insertOne\|messages.*insert' server/src/services/egress/routes.js server/src/routes/message-routes.js server/src/db/*.js 2>/dev/null

# Si saveMessage no existe como función separada, extraer la lógica del egress route
```

Si `saveMessage` no existe como función independiente (el egress route puede tener el insertOne inline), creala:

```javascript
// server/src/db/save-message.js (solo si no existe)

const saveMessage = async (db, msg) => {
  const now = new Date()
  const doc = {
    ...msg,
    status_history: [{ status: msg.status, timestamp: now }],
    timestamp: now,
    created_at: now,
  }
  const result = await db.collection('messages').insertOne(doc)
  return result
}

export { saveMessage }
```

## Paso 5 — `index.js`

```javascript
// Auto-reply service — subscribes to inbound NATS events,
// evaluates rules, and sends automatic responses.
//
// Zero coupling with ingress, persistence, or SSE.
// To add rules: create a file in rules/ and register it in evaluate-rules.js.

import { subscribeToSubject } from '../../bus/subscribe.js'
import { evaluateRules } from './evaluate-rules.js'
import { executeReply } from './execute-reply.js'
import { ObjectId } from 'mongodb'

const startAutoReply = ({ nc, db, env, metrics }) => {
  const subject = 'evt.*.coexistance.messaging.whatsapp.meta.received.v1'

  const handler = async (envelope) => {
    const match = evaluateRules(envelope)
    if (!match) return

    const accountId = envelope.accountid
    if (!accountId) {
      console.warn('  [AUTO-REPLY] No accountId in envelope — skip')
      return
    }

    console.log(`  [AUTO-REPLY] Rule matched: "${match.rule}" — account=${accountId} to=${match.to}`)

    // Load account from DB to get access_token + phone_number_id
    try {
      const account = await db.collection('accounts').findOne({ _id: new ObjectId(accountId) })
      if (!account) {
        console.error(`  [AUTO-REPLY] Account not found: ${accountId}`)
        return
      }

      if (!account.access_token || !account.phone_number_id) {
        console.error(`  [AUTO-REPLY] Account ${accountId} missing access_token or phone_number_id`)
        return
      }

      const result = await executeReply(match, account, db, env, { nc, metrics })

      if (result.ok) {
        console.log(`  [AUTO-REPLY] Done — wa_message_id=${result.data.waMessageId}`)
      } else {
        console.error(`  [AUTO-REPLY] Failed — ${result.error}`)
      }
    } catch (e) {
      console.error(`  [AUTO-REPLY] Unexpected error: ${e.message}`)
    }
  }

  const subResult = subscribeToSubject(nc, subject, handler)
  if (subResult.ok) {
    console.log(`  [SERVICE] Auto-reply registered — subject: ${subject}`)
  } else {
    console.error(`  [SERVICE] Auto-reply failed to subscribe: ${subResult.error}`)
  }

  return subResult
}

export { startAutoReply }
```

## Paso 6 — Registrar en server.js

Agregar el import y la invocación en `server/src/server.js`:

```javascript
// Agregar import arriba:
import { startAutoReply } from './services/auto-reply/index.js'

// Dentro del bloque if (nc) { ... }, DESPUÉS de registerIngress:
if (nc) {
  startPersistence({ nc, db })
  sseBridge = registerSse(app, { nc, db, env })
  busMetrics = registerHealth(app, { nc, sseBridge })
  registerIngress(app, { db, env, nc, metrics: busMetrics })
  startAutoReply({ nc, db, env, metrics: busMetrics })  // ← NUEVO
}
```

También agregar "auto-reply" al log de servicios activos:

```javascript
// Cambiar la línea del log:
services: ${nc ? 'ingress, egress, persistence, sse, health, auto-reply' : 'ingress (degraded), egress (degraded)'}
```

## Paso 7 — Tests de integración

Crear `server/src/services/auto-reply/index.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateRules } from './evaluate-rules.js'
import { pingPong } from './rules/ping-pong.js'

// Integration: full envelope → rule match → action params
describe('auto-reply integration', () => {
  const fullEnvelope = {
    specversion: '1.0',
    id: '01KMBZ6FY8ZWB349026F71TXS2',
    tenant: 'default',
    producer: 'coexistance',
    domain: 'messaging',
    channel: 'whatsapp',
    provider: 'meta',
    accountid: '69bea8cd868e860918359cc7',
    data: {
      payload_inline: true,
      payload: {
        object: 'whatsapp_business_account',
        entry: [{
          id: '123',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '100904' },
              messages: [{
                from: '541134602008',
                id: 'wamid.xxx',
                timestamp: '1711152000',
                type: 'text',
                text: { body: 'ping' }
              }]
            },
            field: 'messages'
          }]
        }]
      }
    }
  }

  it('evaluates full Meta envelope and returns correct match', () => {
    const match = evaluateRules(fullEnvelope)
    expect(match).toEqual({
      rule: 'ping-pong',
      action: 'send_text',
      to: '541134602008',
      text: 'pong',
    })
  })

  it('returns null for status update webhook (no messages)', () => {
    const statusEnvelope = {
      ...fullEnvelope,
      data: {
        payload: {
          entry: [{
            changes: [{
              value: {
                statuses: [{ id: 'wamid.xxx', status: 'delivered' }]
              }
            }]
          }]
        }
      }
    }
    expect(evaluateRules(statusEnvelope)).toBeNull()
  })

  it('returns null for non-ping message', () => {
    const helloEnvelope = structuredClone(fullEnvelope)
    helloEnvelope.data.payload.entry[0].changes[0].value.messages[0].text.body = 'hola'
    expect(evaluateRules(helloEnvelope)).toBeNull()
  })
})
```

## Paso 8 — Verificar

```bash
# 1. Correr los tests nuevos
cd server && bun run test

# 2. Verificar que el server arranca con auto-reply
bun run dev
# En el log debe aparecer:
#   [SERVICE] Auto-reply registered — subject: evt.*.coexistance.messaging.whatsapp.meta.received.v1

# 3. Si tienes el tunnel + NATS corriendo, envía "ping" desde WhatsApp
# En el log debe aparecer:
#   [AUTO-REPLY] Rule matched: "ping-pong" — account=69bea8cd... to=541134602008
#   [AUTO-REPLY] sendText ok — wa_message_id=wamid.xxx
#   [AUTO-REPLY] Message saved to DB
#   [AUTO-REPLY] Done — wa_message_id=wamid.xxx
```

## Paso 9 — Verificar idempotencia

Actualmente NO hay deduplicación — si NATS entrega el mismo evento dos veces, se envían dos pongs. Esto es aceptable para v0. Log de advertencia:

```
// En index.js handler, opcionalmente:
console.log(`  [AUTO-REPLY] Processing envelope id=${envelope.id} (no dedup in v0)`)
```

Futuro (v1 con JetStream): el header `Nats-Msg-Id` que ya pone `publishEvent` permitirá deduplicación nativa.

---

## Resultado esperado

- 4 archivos nuevos + 3 archivos de test
- `[SERVICE] Auto-reply registered` en el log del server
- Enviar "ping" por WhatsApp → recibir "pong" automáticamente
- Enviar cualquier otro texto → sin respuesta automática
- Todos los tests existentes siguen pasando
- El mensaje "pong" aparece en MongoDB con `source: 'auto-reply'` y `direction: 'outbound'`
