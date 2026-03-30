# 05 — Arquitectura Multi-Canal

> **Fase:** 2
> **Estado:** borrador v0
> **Prerequisitos:** Fase 1 completa (multi-tenant implementado)

## Resumen

Con la base multi-tenant en su lugar, agregar un canal es una extension natural. El canal es un atributo mas de la account, junto al tenant. El bus NATS, el envelope CloudEvents y los servicios downstream ya soportan multi-canal por diseno.

## Que ya funciona sin cambios

| Componente | Por que funciona |
|-----------|-----------------|
| `build-subject.js` | Acepta `{ channel, provider }` — hoy "whatsapp"/"meta", manana "instagram"/"meta" |
| `build-envelope.js` | Campos `channel`, `provider` en el envelope |
| `publish-event.js` | Publica con cualquier subject |
| `subscribe.js` | Puede subscribirse a `evt.*.coexistance.messaging.>` (todos los canales) |
| `validate-envelope.js` | Valida que `channel` no este vacio |
| SSE bridge | Filtra por `accountId`, no por canal |
| Auto-reply | Subscribeable a cualquier subject pattern |

## Cambios necesarios

### 1. Reestructura de `meta/` a `providers/`

Hoy `server/src/meta/` mezcla funciones compartidas de Meta Platform con funciones especificas de WhatsApp.

**Antes:**
```
server/src/meta/
├── verify-webhook.js          ← compartida (misma verificacion Meta)
├── parse-webhook.js           ← WhatsApp-specific
├── parse-sender-id.js         ← WhatsApp-specific
├── send-text.js               ← WhatsApp-specific
├── send-template.js           ← WhatsApp-specific
├── exchange-token.js          ← compartida (OAuth Meta)
├── refresh-token.js           ← compartida
├── fetch-waba-phone-numbers.js ← WhatsApp-specific
├── fetch-templates.js          ← WhatsApp-specific
└── subscribe-webhooks.js       ← WhatsApp-specific
```

**Despues:**
```
server/src/providers/
└── meta/
    ├── shared/
    │   ├── verify-webhook.js          ← verificacion HMAC (identica para WA + IG)
    │   ├── exchange-token.js          ← OAuth token exchange
    │   └── refresh-token.js           ← token refresh
    ├── whatsapp/
    │   ├── parse-webhook.js           ← parsing WhatsApp-specific
    │   ├── parse-sender-id.js         ← BSUID detection
    │   ├── send-text.js               ← graph.facebook.com/.../messages
    │   ├── send-template.js           ← templates
    │   ├── fetch-phone-numbers.js
    │   ├── fetch-templates.js
    │   └── subscribe-webhooks.js
    └── instagram/
        ├── parse-webhook.js           ← parsing Instagram-specific (NUEVO)
        ├── send-text.js               ← graph.instagram.com/.../messages (NUEVO)
        ├── send-image.js              ← attachments (NUEVO)
        └── subscribe-webhooks.js      ← (NUEVO)
```

**Backward compat:** crear re-exports en `server/src/meta/` que apunten a las nuevas ubicaciones. Deprecar gradualmente.

### 2. Campo `channel` en accounts

```javascript
// account document
{
  tenant: "acme",
  channel: "whatsapp",          // NUEVO — "whatsapp" | "instagram"
  // ... resto de campos
}
```

**Default:** `"whatsapp"` para accounts existentes (migracion).

**Indice:** `{ tenant, channel, phone_number_id }` unique (WhatsApp) y `{ tenant, channel, ig_user_id }` unique (Instagram).

### 3. Webhook endpoints por canal y tenant

```
WhatsApp:  /api/webhooks/whatsapp/:tenantId
Instagram: /api/webhooks/instagram/:tenantId
```

Cada canal registra sus propias rutas. Comparten la verificacion GET (Meta Platform) pero tienen diferente parsing POST.

### 4. Channel-aware dispatcher en persistence

El persistence consumer recibe envelopes de todos los canales. Usa `envelope.channel` para seleccionar el parser:

```javascript
const parsers = {
  whatsapp: parseWhatsAppPayload,
  instagram: parseInstagramPayload,
}

const parse = parsers[envelope.channel]
if (!parse) {
  console.warn(`Unknown channel: ${envelope.channel}`)
  return
}
const normalized = parse(envelope.data.payload)
```

### 5. Channel-aware egress

Las rutas de envio seleccionan la funcion de envio segun el `channel` de la account:

```javascript
const senders = {
  whatsapp: sendWhatsAppText,
  instagram: sendInstagramText,
}

const send = senders[account.channel]
```

### 6. UI multi-canal

- **AccountSelector:** mostrar icono del canal junto al nombre
- **Sidebar:** icono de canal por conversacion
- **ChatView:** indicador del canal activo
- **ConnectAccount:** formularios separados para WhatsApp e Instagram

## Flujo multi-canal completo

```
                          ┌────────────────────────┐
  WhatsApp User ──▶ Meta ─┤ POST /webhooks/wa/acme  │
                          │   parseWhatsAppWebhook   │
                          │   channel: "whatsapp"    │──▶ NATS: evt.acme...whatsapp.meta.received.v1
                          └────────────────────────┘
                                                           │
                          ┌────────────────────────┐       ▼
  IG User ──▶ Meta ───────┤ POST /webhooks/ig/acme  │   ┌──────────┐
                          │   parseInstagramWebhook  │   │ NATS Bus │
                          │   channel: "instagram"   │──▶│          │
                          └────────────────────────┘   └──────────┘
                                                           │
                                          ┌────────────────┼────────────────┐
                                          ▼                ▼                ▼
                                    Persistence        SSE Bridge      Auto-Reply
                                    (channel-aware     (filtra por     (reglas por
                                     parser)           accountId)      canal)
```

## Account lookup en webhook

El lookup de account en el webhook se generaliza:

```javascript
// WhatsApp webhook
const account = await db.collection('accounts').findOne({
  tenant: req.params.tenantId,
  channel: 'whatsapp',
  phone_number_id: event.data.phone_number_id,
})

// Instagram webhook
const account = await db.collection('accounts').findOne({
  tenant: req.params.tenantId,
  channel: 'instagram',
  ig_user_id: entry.id,  // el ID del IG professional account
})
```

## Siguiente paso

→ [06-overview-instagram-api.md](./06-overview-instagram-api.md) — la API de Instagram Messaging en detalle.
