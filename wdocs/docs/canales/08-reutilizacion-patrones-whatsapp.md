# 08 — Reutilizacion de Patrones WhatsApp

> **Fase:** 2
> **Estado:** borrador v0
> **Prerequisitos:** [07-instagram-implementacion.md](./07-instagram-implementacion.md)

## Resumen

Instagram y WhatsApp comparten la plataforma Meta. Esto permite reutilizar una parte significativa del codigo existente. Este documento clasifica cada funcion y componente en 3 categorias: **identico** (se reutiliza tal cual), **adaptar** (misma logica, diferente estructura), y **nuevo** (no tiene equivalente en WhatsApp).

## Identico — se reutiliza sin cambios

Estas funciones se mueven a `providers/meta/shared/` y se usan tanto para WhatsApp como Instagram:

| Funcion | Archivo actual | Por que es identica |
|---------|---------------|---------------------|
| `verifyWebhook()` | `meta/verify-webhook.js` | Meta usa el mismo challenge GET para todos sus productos |
| `exchangeToken()` | `meta/exchange-token.js` | OAuth Meta es el mismo mecanismo para WA e IG |
| `refreshToken()` | `meta/refresh-token.js` | `fb_exchange_token` funciona igual para ambos |
| `filterHeaders()` | `bus/filter-headers.js` | Mismos headers Meta (`x-hub-signature-256`, etc.) |

### Bus (completo) — ya es channel-agnostic

| Funcion | Archivo | Nota |
|---------|---------|------|
| `buildSubject()` | `bus/build-subject.js` | Acepta cualquier `{ channel, provider }` |
| `buildEnvelope()` | `bus/build-envelope.js` | Incluye `channel`, `provider` en el envelope |
| `publishEvent()` | `bus/publish-event.js` | Publica cualquier subject |
| `subscribe()` | `bus/subscribe.js` | Filtra por pattern (wildcard) |
| `validateEnvelope()` | `bus/validate-envelope.js` | Valida campos genericos |
| `idempotencyKey()` | `bus/idempotency-key.js` | Hash del payload (channel-agnostic) |
| `checkPayloadSize()` | `bus/check-payload-size.js` | Verifica bytes (channel-agnostic) |

### Lib (completo) — utilidades genericas

| Funcion | Archivo |
|---------|---------|
| `ok()`, `err()`, `tryCatch()` | `lib/result.js` |
| `pipe()` | `lib/pipe.js` |
| `match()` | `lib/match.js` |
| `fetchJson()` | `lib/http.js` |

### Services — logica reutilizable

| Componente | Archivo | Nota |
|-----------|---------|------|
| `processIngress()` | `services/ingress/process-ingress.js` | Recibe contexto con `channel` — generico |
| `processEgress()` | `services/egress/process-egress.js` | Recibe contexto con `channel` — generico |
| SSE bridge | `services/sse/sse-bridge.js` | Filtra por `accountId`, no por canal |

## Adaptar — misma logica, diferente estructura

Estas funciones tienen la misma responsabilidad pero difieren en los detalles del payload:

### parse-webhook.js

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| `object` check | `"whatsapp_business_account"` | `"instagram"` |
| Message path | `entry[].changes[].value.messages[]` | `entry[].messaging[].message` |
| Account ID key | `metadata.phone_number_id` | `entry[].id` (IG User ID) |
| Sender ID | `messages[].from` (phone o BSUID) | `messaging[].sender.id` (IGSID) |
| Status events | `changes[].value.statuses[]` | No existe |
| Echo messages | No | `message.is_echo: true` |
| Output format | `{ type, data }` | `{ type, data }` (mismo!) |

**Estrategia:** crear `providers/meta/instagram/parse-webhook.js` con la misma firma y output format que el de WhatsApp. El persistence consumer no necesita saber cual uso — solo consume el output normalizado.

### send-text.js

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| URL | `graph.facebook.com/{version}/{phone_id}/messages` | `graph.instagram.com/{version}/{ig_id}/messages` |
| Body | `{ messaging_product: "whatsapp", to, type: "text", text: { body } }` | `{ recipient: { id }, message: { text } }` |
| Auth | `Authorization: Bearer` | `Authorization: Bearer` (igual) |
| Response | `{ messages: [{ id }] }` | `{ recipient_id, message_id }` |

**Estrategia:** crear `providers/meta/instagram/send-text.js` con la misma firma `(params) => Result`.

### subscribe-webhooks.js

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| Endpoint | `POST /{waba_id}/subscribed_apps` | `POST /{ig_user_id}/subscribed_apps` |
| Fields | `?subscribed_fields=messages` | `?subscribed_fields=messages` |
| Auth | Bearer token | Bearer token |

Muy similar — podria ser una funcion compartida con parametro `endpoint`.

## Nuevo — sin equivalente en WhatsApp

| Funcion | Descripcion | Por que es nueva |
|---------|-------------|-----------------|
| Echo filtering | Filtrar `is_echo: true` en ingress | WhatsApp no envia echos |
| Story reply handling | Extraer `reply_to.story.url` y `.id` | Solo Instagram tiene stories |
| `send-image.js` | Enviar imagen via URL publica | WhatsApp usa `media_id` (upload), Instagram usa URL |
| Account connect (IG) | OAuth flow con scope Instagram | Diferente scope y permisos que WhatsApp |
| IGSID identity | Solo IGSID, sin phone/BSUID | Modelo de identidad diferente |

## Checklist para agregar un canal futuro

Si en el futuro se agrega Telegram, Email, u otro canal, seguir este patron:

1. **Crear carpeta** `providers/{provider}/{channel}/` con:
   - [ ] `parse-webhook.js` — normalizar payload entrante a `{ type, data }`
   - [ ] `send-text.js` — enviar mensaje de texto
   - [ ] Funciones adicionales segun el canal

2. **Registrar webhook routes:**
   - [ ] `GET /api/webhooks/{channel}/:tenantId` — verificacion
   - [ ] `POST /api/webhooks/{channel}/:tenantId` — mensajes entrantes

3. **Actualizar dispatchers:**
   - [ ] Agregar parser al dispatcher de persistence
   - [ ] Agregar sender al dispatcher de egress

4. **Modelo de datos:**
   - [ ] Definir campos especificos del canal en account schema
   - [ ] Definir identity del contacto (equivalente a phone/IGSID)

5. **UI:**
   - [ ] Icono del canal en AccountSelector y Sidebar
   - [ ] Formulario de conexion en ConnectAccount

6. **Tests:**
   - [ ] Unit tests del parser y sender
   - [ ] Integration test del flujo completo

## Metricas de reutilizacion estimada

```
Codigo total del proyecto:    ~4000 LOC (server)
Codigo channel-agnostic:      ~2500 LOC (bus, lib, auth, middleware, services core)
Codigo WhatsApp-specific:     ~1500 LOC (meta/, ingress routes, egress routes)

Para Instagram:
  Reutilizado identico:       ~2500 LOC (bus, lib, services core)
  Adaptado:                   ~400 LOC nuevo (parse-webhook, send-text, send-image)
  Nuevo:                      ~300 LOC nuevo (echo filter, story reply, account connect)

Codigo nuevo estimado:        ~700 LOC (vs 1500 de WhatsApp)
Ratio de reutilizacion:       ~55% del codigo WhatsApp no se reescribe
```
