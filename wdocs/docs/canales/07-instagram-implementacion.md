# 07 — Instagram: Plan de Implementacion

> **Fase:** 2
> **Estado:** borrador v0
> **Prerequisitos:** Fase 1 completa, [06-overview-instagram-api.md](./06-overview-instagram-api.md)

## Stages

| Stage | Descripcion | Complejidad | Dependencias |
|-------|-------------|-------------|--------------|
| IG-01 | Reestructura `meta/` a `providers/meta/` | M | Ninguna |
| IG-02 | Migration: agregar `channel: 'whatsapp'` a accounts existentes | S | Ninguna |
| IG-03 | Instagram webhook routes (verify + parse) | M | IG-01 |
| IG-04 | Instagram send-text y send-image | M | IG-01 |
| IG-05 | Channel-aware persistence consumer | M | IG-01, IG-02 |
| IG-06 | Channel-aware egress routes | M | IG-01, IG-02, IG-04 |
| IG-07 | Instagram account connect flow (API + UI) | L | IG-02, IG-03 |
| IG-08 | UI multi-canal (iconos, indicadores) | M | IG-07 |
| IG-09 | Tests end-to-end | M | IG-03 a IG-08 |

## Detalle por stage

---

### IG-01: Reestructura `meta/` a `providers/meta/`

**Objetivo:** separar funciones compartidas de Meta Platform de las especificas de WhatsApp, creando espacio para Instagram.

**Archivos a mover:**

| Origen | Destino | Tipo |
|--------|---------|------|
| `meta/verify-webhook.js` | `providers/meta/shared/verify-webhook.js` | Compartida |
| `meta/exchange-token.js` | `providers/meta/shared/exchange-token.js` | Compartida |
| `meta/refresh-token.js` | `providers/meta/shared/refresh-token.js` | Compartida |
| `meta/parse-webhook.js` | `providers/meta/whatsapp/parse-webhook.js` | WhatsApp |
| `meta/parse-sender-id.js` | `providers/meta/whatsapp/parse-sender-id.js` | WhatsApp |
| `meta/send-text.js` | `providers/meta/whatsapp/send-text.js` | WhatsApp |
| `meta/send-template.js` | `providers/meta/whatsapp/send-template.js` | WhatsApp |
| `meta/fetch-waba-phone-numbers.js` | `providers/meta/whatsapp/fetch-phone-numbers.js` | WhatsApp |
| `meta/fetch-templates.js` | `providers/meta/whatsapp/fetch-templates.js` | WhatsApp |
| `meta/subscribe-webhooks.js` | `providers/meta/whatsapp/subscribe-webhooks.js` | WhatsApp |

**Backward compat:** crear `meta/index.js` que re-exporta desde las nuevas ubicaciones.

**Tests:** actualizar imports en los tests existentes.

---

### IG-02: Migration `channel` en accounts

**Objetivo:** agregar `channel: 'whatsapp'` a todas las accounts existentes.

**Script:**
```javascript
await db.collection('accounts').updateMany(
  { channel: { $exists: false } },
  { $set: { channel: 'whatsapp' } }
)
```

**Indice nuevo:** `{ tenant, channel, phone_number_id }` unique.

---

### IG-03: Instagram webhook routes

**Objetivo:** recibir mensajes de Instagram via webhook.

**Archivos nuevos:**
- `providers/meta/instagram/parse-webhook.js`
- `services/ingress/instagram-routes.js` (o extender `routes.js` con parametro channel)

**Rutas:**
```
GET  /api/webhooks/instagram/:tenantId  — verificacion Meta (reutiliza verify-webhook.js)
POST /api/webhooks/instagram/:tenantId  — mensajes entrantes
```

**parse-webhook.js para Instagram:**

```javascript
const parseInstagramWebhook = (rawBody) => {
  if (rawBody?.object !== 'instagram') {
    return { type: 'unknown', data: null }
  }

  const entry = rawBody.entry?.[0]
  if (!entry) return { type: 'unknown', data: null }

  const messaging = entry.messaging?.[0]
  if (!messaging) return { type: 'unknown', data: null }

  // Filtrar echo messages (mensajes enviados por el negocio)
  if (messaging.message?.is_echo) {
    return { type: 'echo', data: { mid: messaging.message.mid } }
  }

  if (messaging.message) {
    return {
      type: 'message',
      data: {
        ig_user_id: entry.id,           // IG professional account ID
        sender_id: messaging.sender.id,  // IGSID del remitente
        recipient_id: messaging.recipient.id,
        message_id: messaging.message.mid,
        text: messaging.message.text || null,
        attachments: messaging.message.attachments || [],
        reply_to: messaging.message.reply_to || null,
        timestamp: messaging.timestamp,
      }
    }
  }

  return { type: 'unknown', data: null }
}
```

**Account lookup:**
```javascript
const account = await db.collection('accounts').findOne({
  tenant: req.params.tenantId,
  channel: 'instagram',
  ig_user_id: entry.id,
})
```

**Pipeline:** el `processIngress` se reutiliza pasando `channel: 'instagram'`, `provider: 'meta'`.

---

### IG-04: Instagram send-text y send-image

**Objetivo:** enviar mensajes a usuarios de Instagram.

**Archivo nuevo:** `providers/meta/instagram/send-text.js`

```javascript
const sendInstagramText = async ({ ig_user_id, recipient_id, text, access_token, apiVersion }) => {
  const url = `https://graph.instagram.com/${apiVersion}/${ig_user_id}/messages`
  const body = {
    recipient: { id: recipient_id },
    message: { text },
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (data.error) return err(data.error.message)
  return ok({ recipient_id: data.recipient_id, message_id: data.message_id })
}
```

**Archivo nuevo:** `providers/meta/instagram/send-image.js`

Similar pero con `message.attachment` en vez de `message.text`.

---

### IG-05: Channel-aware persistence

**Objetivo:** el persistence consumer guarda mensajes de cualquier canal.

**Cambio en `persist-message.js`:**

```javascript
const parsers = {
  whatsapp: normalizeWhatsAppMessage,
  instagram: normalizeInstagramMessage,
}

const normalize = parsers[envelope.channel]
if (!normalize) return

const message = normalize(envelope)
await saveMessage(db, { ...message, tenant: envelope.tenant })
```

Las funciones `normalizeWhatsAppMessage` y `normalizeInstagramMessage` transforman el payload del envelope al schema comun de `messages`.

---

### IG-06: Channel-aware egress

**Objetivo:** las rutas de envio seleccionan la funcion correcta segun el canal de la account.

**Cambio en `services/egress/routes.js`:**

```javascript
const senders = {
  whatsapp: { text: sendWhatsAppText, template: sendWhatsAppTemplate },
  instagram: { text: sendInstagramText, image: sendInstagramImage },
}

// En la ruta POST /api/accounts/:id/messages/send
const sender = senders[account.channel]
if (!sender?.text) return res.status(400).json({ error: `Channel ${account.channel} does not support text messages` })
```

---

### IG-07: Instagram account connect flow

**Objetivo:** permitir a un tenant conectar su cuenta de Instagram.

**Backend:**
- Ruta `POST /api/accounts/connect-instagram` — recibe el token OAuth y el IG User ID
- Reutiliza `exchange-token.js` y `refresh-token.js` de `providers/meta/shared/`
- Crea account con `channel: 'instagram'`

**Frontend:**
- Nuevo formulario en ConnectAccount para Instagram
- OAuth flow con permisos de Instagram (`instagram_manage_messages`)
- Similar al Embedded Signup existente pero con scope de Instagram

**Webhook subscription:**
- API call para subscribir el IG account al webhook: `POST /{ig_user_id}/subscribed_apps?subscribed_fields=messages`

---

### IG-08: UI multi-canal

**Objetivo:** el dashboard muestra claramente a que canal pertenece cada account/conversacion.

**Cambios:**
- `AccountSelector.jsx` — icono de canal (WhatsApp verde, Instagram gradiente)
- `Sidebar.jsx` — indicador de canal por conversacion
- `ChatView.jsx` — badge del canal activo, ocultar "Templates" para Instagram (no soporta)
- `ConnectAccount.jsx` — tabs o selector para elegir WhatsApp vs Instagram

---

### IG-09: Tests end-to-end

**Objetivo:** verificar el flujo completo para Instagram.

**Tests nuevos:**
- `tests/providers/meta/instagram/parse-webhook.test.js`
- `tests/providers/meta/instagram/send-text.test.js`
- `tests/services/ingress/instagram.test.js`
- `tests/services/persistence/multi-channel.test.js`

**Smoke test:**
1. Crear account Instagram (mock)
2. Simular webhook POST con payload Instagram
3. Verificar que el mensaje se persiste en MongoDB
4. Verificar que el SSE bridge emite el evento
5. Enviar mensaje de respuesta (mock)
6. Verificar que se llama al endpoint correcto de Instagram

## Modelo de datos Instagram

### Account (campos nuevos/diferentes)

```javascript
{
  tenant: "acme",
  channel: "instagram",         // diferenciador
  ig_user_id: "17841400...",    // Instagram Professional Account ID
  ig_username: "acme_oficial",  // para display
  linked_page_id: "1234...",    // Facebook Page vinculada
  access_token: "...",          // Instagram User Access Token
  token_expires_at: Date,
  business_name: "Acme Corp",
  meta_app_id: "...",           // si usa su propia Meta App
  meta_app_secret: "...",
  status: "active",
  owner_user_id: ObjectId,
  created_at: Date,
  updated_at: Date
}
```

### Contact (Instagram)

```javascript
{
  tenant: "acme",
  account_id: ObjectId,
  channel: "instagram",
  channel_contact_id: "<IGSID>",  // Instagram-Scoped ID
  display_name: "usuario_ig",
  last_message_at: Date,
  created_at: Date
}
```

**Nota:** a diferencia de WhatsApp donde el contacto tiene phone/bsuid, en Instagram solo hay IGSID. No se puede obtener el username del usuario via API (privacidad).

### Message (sin cambios estructurales)

El schema de messages es el mismo. Los campos que cambian:

| Campo | WhatsApp | Instagram |
|-------|----------|-----------|
| `type` | text, template, image, document, audio, video, interactive, reaction | text, image, story_reply |
| `wa_message_id` | `wamid.xxx` | N/A |
| `ig_message_id` | N/A | `mid.xxx` |
| `source` | human, bot, template | human, bot (sin template) |

**Decision:** agregar campo generico `channel_message_id` en vez de campos por canal, o mantener campos separados. A discutir.

## Siguiente paso

→ [08-reutilizacion-patrones-whatsapp.md](./08-reutilizacion-patrones-whatsapp.md) — que codigo se reutiliza y como.
