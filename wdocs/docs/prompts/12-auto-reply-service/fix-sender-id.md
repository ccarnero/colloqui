# Fix — Auto-reply: normalizar sender ID antes de enviar

## Problema

El auto-reply toma `msg.from` del webhook de Meta y lo usa directamente como `to` en `sendText()`. Meta envía números argentinos con el formato `5491134602008` (con el `9` celular), pero la API de envío espera `541134602008` (sin el `9`). Resultado: error `#131030 Recipient phone number not in allowed list`.

```
[AUTO-REPLY] Rule matched: "ping-pong" — to=5491134602008   ← MAL
[HTTP] FAILED 400: (#131030) Recipient phone number not in allowed list
```

El envío manual desde el dashboard funciona porque el frontend ya guarda el `wa_id` normalizado (vía `parseSenderId` en el flujo de persistence).

## Fix

Hay que usar `parseSenderId()` (de `server/src/meta/parse-sender-id.js`) en la regla ping-pong para normalizar el número antes de devolver el match.

### Archivo: `server/src/services/auto-reply/rules/ping-pong.js`

```javascript
// ANTES (bug):
return {
  rule: 'ping-pong',
  action: 'send_text',
  to: msg.from,         // ← raw "5491134602008"
  text: 'pong',
}

// DESPUÉS (fix):
import { parseSenderId } from '../../../meta/parse-sender-id.js'

// ... dentro de pingPong():
const sender = parseSenderId(msg.from)

return {
  rule: 'ping-pong',
  action: 'send_text',
  to: sender.value,     // ← normalizado "541134602008"
  text: 'pong',
}
```

### Archivo completo corregido: `rules/ping-pong.js`

```javascript
// Rule: if inbound text is exactly "ping" (case insensitive), reply "pong"
//
// Uses parseSenderId to normalize the phone number (e.g. 549... → 54...)
// before returning it as the reply target.

import { parseSenderId } from '../../../meta/parse-sender-id.js'

const pingPong = (messages) => {
  if (!messages || messages.length === 0) return null

  const msg = messages[0]
  if (msg.type !== 'text') return null

  const body = msg.text?.body?.toLowerCase().trim()
  if (body !== 'ping') return null

  const sender = parseSenderId(msg.from)

  return {
    rule: 'ping-pong',
    action: 'send_text',
    to: sender.value,
    text: 'pong',
  }
}

export { pingPong }
```

### Actualizar test: `rules/ping-pong.test.js`

Agregar un caso que verifique la normalización:

```javascript
it('normalizes Argentine phone number (removes extra 9)', () => {
  const messages = [{ type: 'text', from: '5491134602008', text: { body: 'ping' } }]
  const result = pingPong(messages)
  expect(result.to).toBe('541134602008')  // sin el 9 extra
})

it('keeps non-Argentine numbers as-is', () => {
  const messages = [{ type: 'text', from: '14155551234', text: { body: 'ping' } }]
  const result = pingPong(messages)
  expect(result.to).toBe('14155551234')
})
```

## Verificación

```bash
# 1. Tests
cd server && bun run test

# 2. Enviar "ping" desde WhatsApp
# Log esperado:
#   [AUTO-REPLY] Rule matched: "ping-pong" — to=541134602008  ← normalizado
#   [AUTO-REPLY] sendText ok — wa_message_id=wamid.xxx

# 3. Verificar en MongoDB
# db.messages.findOne({ source: 'auto-reply', direction: 'outbound' })
# → wa_sender_id: "541134602008" (sin el 9)
```

## Nota adicional

Considerar aplicar `parseSenderId` en `evaluate-rules.js` (nivel genérico) en vez de en cada regla individual, para que todas las reglas futuras reciban el número ya normalizado. Pero para v0, hacerlo en la regla es suficiente y más explícito.
