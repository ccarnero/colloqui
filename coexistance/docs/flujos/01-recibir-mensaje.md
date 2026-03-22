# Flujo 01 — Recibir mensaje de WhatsApp

## Resumen

Un usuario de WhatsApp envía un mensaje de texto a un número de negocio conectado a Coexistance. El mensaje viaja desde Meta Cloud API hasta el navegador del operador, pasando por el bus NATS como evento inmutable.

## Actores

| Actor | Rol |
|-------|-----|
| **Usuario WA** | Persona que envía el mensaje desde WhatsApp |
| **Meta Cloud API** | Plataforma de WhatsApp Business — entrega webhooks |
| **Ingress (routes.js)** | Endpoint HTTP que recibe el webhook |
| **Ingress (pipeline)** | `processIngress` — valida, empaqueta, publica |
| **NATS Bus** | Broker pub/sub — distribuye el evento |
| **Persistence** | Consumer — guarda mensaje y contacto en MongoDB |
| **SSE Bridge** | Consumer — retransmite al navegador via Server-Sent Events |
| **Dashboard (browser)** | React app — muestra el mensaje en tiempo real |

## Diagrama de secuencia

```mermaid
sequenceDiagram
    participant WA as Usuario WA
    participant Meta as Meta Cloud API
    participant Ingress as Ingress Route<br/>(POST /api/webhooks/whatsapp)
    participant Pipeline as processIngress()
    participant Bus as NATS Bus
    participant Persist as Persistence Consumer
    participant SSE as SSE Bridge
    participant DB as MongoDB
    participant Browser as Dashboard (browser)

    WA->>Meta: Envía mensaje de texto
    Meta->>Ingress: POST /api/webhooks/whatsapp<br/>{entry[].changes[].value.messages[]}

    Note over Ingress: 1. Parsea webhook (parseWebhook)<br/>2. Busca account por phone_number_id<br/>3. Responde HTTP 200 a Meta

    Ingress-->>Meta: 200 OK

    Ingress->>Pipeline: processIngress({ rawBody, headers, tenant, accountid })

    Note over Pipeline: filterHeaders() → headers limpios<br/>buildEnvelope() → CloudEvents envelope<br/>buildSubject() → evt.TENANT.coexistance<br/>.messaging.whatsapp.meta.received.v1

    Pipeline->>Bus: publishEvent(nc, subject, envelope)

    Note over Bus: NATS distribuye a todos<br/>los subscribers del subject<br/>evt.*.coexistance.messaging.>

    par Persistence Consumer
        Bus->>Persist: envelope (async)
        Note over Persist: parseWebhook(envelope.data.payload)<br/>→ { type: 'message', ... }
        Persist->>DB: upsertContact(wa_id, name)
        Persist->>DB: saveMessage({ direction: 'inbound', ... })
    and SSE Bridge
        Bus->>SSE: envelope (async)
        Note over SSE: Extrae accountId del envelope<br/>Busca clientes SSE conectados<br/>para ese accountId
        SSE->>Browser: SSE event: { type: 'message', eventId, accountId }
    end

    Note over Browser: useEventStream hook<br/>recibe el evento SSE
    Browser->>Browser: refreshConversations()<br/>setRefreshTick(t + 1)
    Browser->>DB: GET /api/accounts/:id/conversations<br/>(via api.js fetch)
    DB-->>Browser: Lista actualizada de conversaciones
```

## Subject NATS

```
evt.{tenant}.coexistance.messaging.whatsapp.meta.received.v1
```

Ejemplo concreto:
```
evt.default.coexistance.messaging.whatsapp.meta.received.v1
```

## Estructura del envelope (CloudEvents)

```json
{
  "specversion": "1.0",
  "id": "01JQ...",
  "source": "/services/coexistance/ingress/meta/whatsapp",
  "type": "io.yoizen.messaging.ingress.received.v1",
  "time": "2026-03-22T14:30:00.000Z",
  "traceid": "uuid-v4",
  "correlationId": "wamid.xxx",
  "tenant": "default",
  "producer": "coexistance",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "mongo-object-id",
  "idempotencykey": "hash-del-payload",
  "transport": {
    "method": "POST",
    "protocol": "https",
    "headers": { "filtered": "..." }
  },
  "data": {
    "payload_inline": true,
    "payload": { "...raw webhook body..." },
    "payload_bytes": 1234,
    "payload_checksum": "sha256:..."
  }
}
```

## Notas de implementación

- El HTTP 200 a Meta se envía ANTES de publicar en NATS — Meta requiere respuesta rápida o reintenta.
- `processIngress` es puro pipeline: filter → envelope → subject → publish. Sin side effects en DB.
- La persistencia ocurre en un consumer separado, desacoplado del webhook handler.
- Si NATS está caído, el webhook igual responde 200 pero el evento se pierde (v0 — sin JetStream).
- El SSE bridge filtra por `accountId` — cada operador solo recibe eventos de sus cuentas conectadas.
- `parseWebhook` dentro de persistence entiende la estructura de Meta (`entry[].changes[].value.messages[]`).
