# 06 — Instagram Messaging API: Overview

> **Estado:** implementado
> **Prerequisitos:** [05-arquitectura-multi-canal.md](./05-arquitectura-multi-canal.md)

## Qué es

La Instagram Messaging API permite a cuentas profesionales de Instagram (Business o Creator) recibir y responder mensajes directos (DMs) vía API. Usa la infraestructura de Meta Platform, la misma que WhatsApp Cloud API.

**Base URL para send:** `https://graph.instagram.com/v21.0`

**Costo:** Gratuito — no hay cargos por mensaje (a diferencia de WhatsApp que cobra por conversaciones iniciadas por el negocio).

## Requisitos

| Requisito | Detalle |
|-----------|---------|
| Meta App | La misma app que para WhatsApp, o una nueva |
| Facebook Page | Vinculada a la cuenta Instagram Professional |
| Instagram Professional Account | Business o Creator (no personal) |
| Permisos | `instagram_manage_messages`, `pages_manage_metadata` |
| Webhook subscription | Object `instagram`, field: `messages` |
| Access token | Instagram User Access Token (OAuth) |

## Diferencias clave con WhatsApp

| Aspecto | WhatsApp | Instagram |
|---------|----------|-----------|
| **Identificador de usuario** | Phone number o BSUID | IGSID (Instagram-Scoped ID) |
| **Endpoint de envío** | `graph.facebook.com/{phone_id}/messages` | `graph.instagram.com/{ig_id}/messages` |
| **Webhook `object`** | `"whatsapp_business_account"` | `"instagram"` |
| **Estructura webhook** | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| **Header de firma** | `x-hub-signature-256` (HMAC-SHA256) | `x-hub-signature-256` (HMAC-SHA256, idéntico) |
| **Templates** | Sí (pre-aprobados por Meta) | No — solo dentro de ventana de 24h |
| **Ventana de respuesta** | 24h | 24h (7 días con tag `human_agent`) |
| **Echo messages** | No | Sí — `message.is_echo: true` cuando el negocio envía |
| **Status updates** | Sí — via `statuses[]` en webhook | No — no hay delivery receipts |
| **Max texto** | 4096 bytes | 1000 bytes |

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

### Mensaje con imagen

```json
{
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

**Importante:** los echo messages se filtran en `instagram.provider.ts` (`isEchoMessage`) para evitar ciclos. Si `message.is_echo === true`, el mensaje se descarta.

## Send API

### Enviar texto

```
POST https://graph.instagram.com/v21.0/<IG_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "recipient": { "id": "<IGSID>" },
  "message": { "text": "Hola! Gracias por tu mensaje." }
}
```

### Enviar imagen

```
POST https://graph.instagram.com/v21.0/<IG_ID>/messages
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

La imagen debe ser una URL pública accesible.

## Ventana de mensajería

- **Standard:** 24 horas desde el último mensaje del usuario
- **Extended:** 7 días con tag `human_agent` (requiere permiso adicional)
- **Fuera de ventana:** no se puede enviar — no hay templates como en WhatsApp

## Verificación de webhook

Usa el mismo mecanismo HMAC-SHA256 que WhatsApp: header `x-hub-signature-256` con la firma calculada con el App Secret de Meta. El código de verificación está en `meta-base.ts` y es compartido por ambos providers.

## Siguiente paso

→ [07-instagram-implementacion.md](./07-instagram-implementacion.md) — detalle de implementación en el codebase.
