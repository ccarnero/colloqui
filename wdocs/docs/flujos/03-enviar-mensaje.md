# Flujo 03 — Enviar mensaje desde el dashboard

## Resumen

El operador escribe un mensaje en el chat del dashboard y lo envía. El mensaje viaja al Meta Cloud API, se guarda en MongoDB, y se publica al bus NATS como evento egress (fire-and-forget). Los subscribers reciben la notificación del envío.

## Diagrama de secuencia

```mermaid
sequenceDiagram
    participant Op as Operador (browser)
    participant React as ChatView component
    participant API as api.sendMessage()
    participant Egress as Egress Route<br/>(POST /send)
    participant Meta as Meta Cloud API
    participant DB as MongoDB
    participant Pipeline as processEgress()
    participant Bus as NATS Bus
    participant SSE as SSE Bridge
    participant Persist as Persistence Consumer

    Op->>React: Escribe texto + click "Enviar"

    React->>API: sendMessage(accountId, { to, text })

    API->>Egress: POST /api/accounts/:accountId/messages/send<br/>Headers: { Authorization: Bearer JWT }

    Note over Egress: requireAuth() → verifica JWT<br/>requireAccount() → carga account del DB

    Egress->>Meta: sendText(phone_number_id, token, to, text)<br/>POST /v21.0/{phone_id}/messages
    Meta-->>Egress: 200 OK { messages: [{ id: "wamid.xxx" }] }

    Egress->>DB: saveMessage({<br/>  wa_id: to,<br/>  text,<br/>  direction: 'outbound',<br/>  wa_message_id: "wamid.xxx",<br/>  status: 'sent'<br/>})

    Egress-->>API: 200 { ok: true, wa_message_id }
    API-->>React: result.ok → true
    React->>React: Limpia input, scroll al final

    Note over Egress: Shadow publish (fire-and-forget):<br/>No bloquea la respuesta al frontend

    Egress-)Pipeline: processEgress({ body, tenant, accountid })

    Note over Pipeline: buildEnvelope() → CloudEvents<br/>buildSubject() → evt.TENANT.coexistance<br/>.messaging.whatsapp.meta.sent.v1

    Pipeline->>Bus: publishEvent(nc, subject, envelope)

    par SSE Bridge
        Bus->>SSE: Egress event
        SSE->>Op: SSE: { type: 'message_sent', eventId, accountId }
        Note over Op: useEventStream recibe evento<br/>refreshConversations() actualiza UI
    and Persistence Consumer
        Bus->>Persist: Egress event
        Note over Persist: parseWebhook() → type: 'unknown'<br/>No es webhook de Meta → SKIP<br/>(mensaje ya guardado por egress route)
    end
```

## Subject NATS

```
evt.{tenant}.coexistance.messaging.whatsapp.meta.sent.v1
```

## Notas

- El mensaje se guarda en MongoDB ANTES de publicar en NATS — así si NATS falla, el mensaje no se pierde.
- La respuesta al frontend NO espera al publish de NATS (fire-and-forget via `.then()`).
- El persistence consumer hace skip del evento egress porque el payload no tiene estructura de webhook Meta — esto es correcto, no hay doble-save.
- El SSE bridge sí propaga el evento, permitiendo que otros operadores vean el mensaje enviado en tiempo real.
