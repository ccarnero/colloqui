# 06 — Instagram Messaging API: Overview

> **Fase:** 2
> **Estado:** borrador v0
> **Prerequisitos:** [05-arquitectura-multi-canal.md](./05-arquitectura-multi-canal.md)

## Que es

La Instagram Messaging API permite a cuentas profesionales de Instagram (Business o Creator) recibir y responder mensajes directos (DMs) via API. Usa la infraestructura de Meta Platform, la misma que WhatsApp Cloud API.

**Base URL:** `https://graph.instagram.com/v24.0`

**Costo:** Gratis. No hay cargos por mensaje (a diferencia de WhatsApp que cobra por conversaciones iniciadas por el negocio).

## Prerequisitos

| Requisito | Detalle |
|-----------|---------|
| Meta App | La misma app que ya se usa para WhatsApp, o una nueva |
| Facebook Page | Vinculada a la cuenta de Instagram Professional |
| Instagram Professional Account | Business o Creator (no personal) |
| Permisos de la app | `instagram_manage_messages`, `pages_manage_metadata` |
| Webhook subscription | Subscribirse al object `instagram`, fields: `messages` |
| Access token | Instagram User Access Token (obtenido via OAuth) |

## Diferencias clave con WhatsApp

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| **Identificador de usuario** | Phone number o BSUID | IGSID (Instagram-Scoped ID) |
| **Endpoint de envio** | `graph.facebook.com/{phone_id}/messages` | `graph.instagram.com/{ig_id}/messages` |
| **Dominio API** | `graph.facebook.com` | `graph.instagram.com` |
| **Webhook `object`** | `"whatsapp_business_account"` | `"instagram"` |
| **Estructura webhook** | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| **Campo `messaging_product`** | Requerido (`"whatsapp"`) en send | No existe |
| **Templates** | Si (pre-aprobados por Meta) | No — solo respuestas dentro de ventana |
| **Ventana de respuesta** | 24h | 24h (7 dias con tag `human_agent`) |
| **Tipos de mensaje saliente** | text, template, image, document, audio, video, sticker, interactive | text, image |
| **Max texto** | 4096 bytes | 1000 bytes |
| **Story replies** | No | Si — campo `reply_to.story` |
| **Echo messages** | No | Si — `is_echo: true` cuando el negocio envia |
| **Status updates (delivery/read)** | Si — via webhook `statuses[]` | No — no hay delivery receipts via API |

## Webhook: estructura del payload

### Mensaje de texto entrante

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "<IG_USER_ID>",
      "time": 1458692751478,
      "messaging": [
        {
          "sender": { "id": "<IGSID>" },
          "recipient": { "id": "<IG_USER_ID>" },
          "timestamp": 1458692752478,
          "message": {
            "mid": "<MESSAGE_ID>",
            "text": "Hola!"
          }
        }
      ]
    }
  ]
}
```

### Mensaje con imagen entrante

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "<IG_USER_ID>",
      "time": 1458692751478,
      "messaging": [
        {
          "sender": { "id": "<IGSID>" },
          "recipient": { "id": "<IG_USER_ID>" },
          "timestamp": 1458692752478,
          "message": {
            "mid": "<MESSAGE_ID>",
            "attachments": [
              {
                "type": "image",
                "payload": { "url": "<CDN_URL>" }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

### Story reply

```json
{
  "message": {
    "mid": "<MESSAGE_ID>",
    "text": "Nice photo!",
    "reply_to": {
      "story": {
        "url": "<STORY_CDN_URL>",
        "id": "<STORY_ID>"
      }
    }
  }
}
```

### Echo message (mensaje enviado por el negocio)

```json
{
  "message": {
    "mid": "<MESSAGE_ID>",
    "text": "Gracias por tu mensaje",
    "is_echo": true
  }
}
```

**Importante:** los echo messages deben filtrarse en el ingress para evitar ciclos (el negocio envia → webhook recibe echo → procesa como nuevo → envia respuesta → ...).

## Send API

### Enviar texto

```
POST https://graph.instagram.com/v24.0/<IG_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "recipient": { "id": "<IGSID>" },
  "message": { "text": "Hola! Gracias por tu mensaje." }
}
```

**Respuesta exitosa:**
```json
{
  "recipient_id": "<IGSID>",
  "message_id": "<MESSAGE_ID>"
}
```

### Enviar imagen

```
POST https://graph.instagram.com/v24.0/<IG_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "recipient": { "id": "<IGSID>" },
  "message": {
    "attachment": {
      "type": "image",
      "payload": { "url": "<PUBLIC_IMAGE_URL>" }
    }
  }
}
```

**Nota:** la imagen debe ser una URL publica accesible. No hay upload directo de media como en WhatsApp.

## Ventana de mensajeria

- **Standard:** 24 horas desde el ultimo mensaje del usuario
- **Extended:** 7 dias con el tag `human_agent` (requiere permiso adicional)
- **Fuera de ventana:** no se puede enviar mensajes (no hay templates como en WhatsApp)

Esto es mas restrictivo que WhatsApp donde se pueden enviar templates fuera de la ventana.

## Rate limits

Se aplican los rate limits estandar de la Graph API:
- Rate limits por app (general)
- Rate limits por page/IG account

No hay rate limits especificos por mensaje como en WhatsApp (tiers de mensajeria).

## Autenticacion

| Concepto | Detalle |
|----------|---------|
| Token tipo | Instagram User Access Token |
| Obtencion | OAuth flow (similar al Embedded Signup de WhatsApp) |
| Duracion | Short-lived (~1h) → exchange por long-lived (~60d) |
| Refresh | Misma mecanica que WhatsApp: `fb_exchange_token` |
| Permisos | `instagram_manage_messages`, `pages_manage_metadata` |

La mecanica de tokens es practicamente identica a WhatsApp. Las funciones `exchange-token.js` y `refresh-token.js` existentes se pueden reutilizar (ver [08-reutilizacion](./08-reutilizacion-patrones-whatsapp.md)).

## Siguiente paso

→ [07-instagram-implementacion.md](./07-instagram-implementacion.md) — plan de implementacion detallado.
