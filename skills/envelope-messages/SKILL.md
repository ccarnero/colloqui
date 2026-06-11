---
name: envelope-messages
description: "Manejo de envelopes de mensajes siguiendo el diseño CloudEvents adaptado para NATS. Trigger: Cuando se trabaja con mensajería, eventos NATS, envelopes, subjects, o transporte de eventos."
license: Apache-2.0
metadata:
  author: Yoizen
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "envelope"
    - "messaging"
    - "events"
    - "nats"
---

> **Fuentes de verdad as-built:**
> - `DOCS/arquitectura/02-diseño-de-mensajes.md` — contrato de envelope, subjects, idempotencia, claim-check (referencia canónica del sistema implementado).
> - `DOCS/arquitectura/03-ingress-agentes.md` — flujo de ingress de dos etapas (webhook bridge) y ciclo de vida de agentes.
> - `DOCS/arquitectura/04-claim-check.md` — protocolo completo de claim-check (producer + consumer).
> - `DOCS/03-NATS-JETSTREAM.md` — topología de streams, taxonomía de subjects y referencia operativa de NATS/JetStream.
>
> Ante cualquier discrepancia entre los documentos y el código, prevalece el código.
> Fuente de verdad de tipos: `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).

## Activation Contract

Aplicar esta skill al crear, consumir o auditar mensajes del bus de eventos NATS, diseñar subjects, construir envelopes, implementar idempotencia, o manejar el patrón claim check.

## Hard Rules

- Todo mensaje DEBE seguir el contrato canónico `EventEnvelope` definido en `packages/shared/src/interfaces.ts`.
- Los IDs de envelope se generan con `crypto.randomUUID()`. No usar ULIDs.
- El formato del campo `type` es `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`.
- El `producer` canónico para eventos de canal es `"channel-service"` (constante `CHANNEL_PRODUCER`). El pre-ingress de webhook usa `"api-gateway"`.
- El `idempotencykey` es `sha256(canonicalJson(payload))` — usar `computeIdempotencyKey` de `@yoizen/shared`. Mapear al header NATS `Nats-Msg-Id` al publicar.
- El flujo de ingreso es un puente de dos etapas: `api-gateway` publica un `WebhookIngressEnvelope` (kind `webhook_received`), luego `channel-service` lo consume, verifica la firma, y emite el `ChannelEnvelope` canónico con `accountid` real.
- Nunca duplicar lógica de subject o envelope. Usar siempre las funciones de `@yoizen/shared` (`buildChannelSubject`, `buildWebhookIngressSubject`, `computeIdempotencyKey`, etc.).
- El claim check se activa cuando `JSON.stringify(envelope).byteLength > CLAIM_CHECK_THRESHOLD_BYTES` (256 KB). El bucket es `PAYLOAD-<tenant>`. La URI de referencia sigue el formato `nats://objstore/<bucket>/<key>`.

## Decision Gates

| Situación | Acción |
|---|---|
| Necesito generar un ID de evento | `crypto.randomUUID()` — nunca ULID |
| Necesito el nombre del producer | `CHANNEL_PRODUCER` = `"channel-service"` (canal); `"api-gateway"` (webhook pre-ingress) |
| Necesito construir el campo `type` | `io.yoizen.messaging.<channel>.<provider>.<kind>.v1` — ver `envelope.factory.ts` línea 86 |
| Necesito el allowlist de headers | `WEBHOOK_FORWARDED_HEADERS` en `channel.constants.ts` — 6 entradas |
| Necesito construir un subject | `buildChannelSubject` o `buildWebhookIngressSubject` de `@yoizen/shared` |
| Envelope serializado > 256 KB | Usar claim check: almacenar `UTF8(canonicalJson(payload))` en Object Store, publicar slim envelope con `payload_inline: false` |
| Soy consumidor y veo `payload_inline: false` | Usar `resolveClaimCheckEnvelope` de `packages/database/src/claim-check.ts` — verifica sha256 sobre raw bytes |

---

## Critical Patterns

### 1. Estructura del Envelope (CloudEvents-inspired)

El contrato canónico está en `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).

Ejemplo de un envelope producido por `channel-service`:

```json
{
  "specversion": "1.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "//channel-service/accounts/69bea8cd868e860918359cc7",
  "type": "io.yoizen.messaging.whatsapp.meta.received.v1",
  "resource": "tenant/acme/account/69bea8cd868e860918359cc7/channel/whatsapp/provider/meta",
  "time": "2026-03-21T15:40:11.382Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant": "acme",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:a1b2c3d4...",
  "transport": { "method": "webhook", "protocol": "https", "depth": 0 },
  "data": {
    "received_at": "2026-03-21T15:40:11.382Z",
    "payload_inline": true,
    "payload_ref": null,
    "payload_bytes": 512,
    "payload_checksum": "sha256:a1b2c3d4...",
    "payload": { "messageId": "wamid.xxx", "from": "5491100000000", ... }
  }
}
```

**Campos obligatorios:** `specversion`, `id`, `source`, `type`, `resource`, `time`, `traceid`, `causation_id` (puede ser `null`), `correlation_id`, `tenant`, `producer`, `domain`, `channel`, `provider`, `accountid`, `idempotencykey`, `transport`, `data`.

Extensiones opcionales de pipeline: `callback_url`, `adapter_id`, `enrich_adapter`, `forward_adapter`.

### 2. Subjects NATS

Formato canónico (8 tokens):

```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
```

| Token | Descripción | Ejemplos |
|---|---|---|
| `evt` | Prefijo fijo | siempre `evt` |
| `tenant` | Tenant ID | `acme`, `globex` |
| `producer` | Servicio publicador | `channel-service`, `api-gateway` |
| `domain` | Dominio de negocio | `messaging` |
| `channel` | Canal | `whatsapp`, `instagram`, `telegram` |
| `provider` | Proveedor infra | `meta`, `telegram`, `webhook` |
| `kind` | Tipo de evento | `webhook_received`, `received`, `sent`, `send` |
| `v1` | Versión | `v1` |

**Wildcards:**
- `*` — match de un token exacto
- `>` — match de uno o más tokens (solo al final)

```
evt.acme.channel-service.messaging.>         -- todo messaging del tenant acme
evt.acme.channel-service.messaging.whatsapp.> -- todo whatsapp del tenant acme
evt.*.channel-service.messaging.>            -- todo messaging, todos los tenants
evt.*.api-gateway.messaging.*.webhook.webhook_received.v1  -- todos los pre-ingress
```

Constante del patrón de suscripción en `channel.constants.ts`:
- `CHANNEL_STREAM_SUBJECTS_PATTERN` = `"evt.*.channel-service.messaging.>"`
- `WEBHOOK_INGRESS_SUBJECT_FILTER` = `"evt.*.api-gateway.messaging.*.webhook.webhook_received.v1"`

### 3. Kinds de Evento

| Kind | Quién publica | Descripción |
|---|---|---|
| `webhook_received` | `api-gateway` | Pre-ingress — webhook recibido, antes de verificar firma |
| `received` | `channel-service` | Mensaje entrante del provider (post-verificación) |
| `sent` | `channel-service` | Confirmación de envío del provider |
| `delivered` | `channel-service` | Confirmación de entrega |
| `read` | `channel-service` | Confirmación de lectura |
| `failed` | `channel-service` | Fallo en envío |
| `send` | `channel-service` / workflow | Comando de envío saliente |

Tipo canónico `MessageKind` en `packages/shared/src/channel.interfaces.ts`: `"received" | "sent" | "delivered" | "read" | "failed" | "send"`.

El kind `webhook_received` es exclusivo de `WebhookIngressEnvelope` (pre-ingress de `api-gateway`).

### 4. Flujo de Dos Etapas (Webhook Bridge)

```
Provider HTTP POST
      │
      ▼
api-gateway  ──── publishWebhook() ────►  INGRESS-<tenant>
  producer: "api-gateway"                  subject: evt.<t>.api-gateway.messaging.<ch>.webhook.webhook_received.v1
  kind: "webhook_received"                 (WebhookIngressEnvelope — sin accountid)
  data.raw_body_b64: base64(rawBody)
  data.headers: allowlist filtrado
      │
      ▼
channel-service (WebhookIngressConsumerService)
  filterSubject: WEBHOOK_INGRESS_SUBJECT_FILTER
  durableName: "channel-webhook-ingress"
      │
      ▼
  webhook-ingress.service: verifica firma, resuelve account
      │
      ▼
  ingress.service: createChannelEnvelope() ──► INGRESS-<tenant>
    producer: "channel-service"                subject: evt.<t>.channel-service.messaging.<ch>.<prov>.received.v1
    kind: "received"                           (ChannelEnvelope — con accountid real)
```

Archivos clave:
- Publisher: `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts`
- Consumer: `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts`
- Factory: `services/channel-service/src/domain/envelope.factory.ts`
- Ingress publish: `services/channel-service/src/modules/ingress/ingress.service.ts`

### 5. Headers Allowlist (Webhook)

Constante `WEBHOOK_FORWARDED_HEADERS` en `packages/shared/src/channel.constants.ts` — 6 entradas:

```
content-type
x-hub-signature-256
x-hub-signature
x-telegram-bot-api-secret-token
x-request-id
user-agent
```

Lookup O(1) disponible como `WEBHOOK_FORWARDED_HEADERS_SET` (Set).

### 6. Transporte

Campo `transport` (tipo `EventTransport` en `packages/shared/src/interfaces.ts`):

| Campo | Tipo | Descripción |
|---|---|---|
| `method` | string | `"webhook"`, `"poll"`, `"stream"`, `"queue_bridge"`, `"agent"` |
| `protocol` | string | `"https"`, `"wss"`, `"amqp"`, `"internal"` |
| `agent_id` | string? | ID del agente (solo para method `"agent"`) |
| `depth` | number? | Profundidad causal para anti-loop (ver `MAX_DEPTH_BY_CATEGORY`) |

### 7. Data Payload

| Campo | Tipo | Descripción |
|---|---|---|
| `received_at` | string | Timestamp ISO 8601 |
| `payload_inline` | boolean | `true` si el payload viaja en el mensaje |
| `payload_ref` | string\|null | URI al Object Store si claim check (`nats://objstore/<bucket>/<key>`) |
| `payload_bytes` | number | UTF-8 bytes del canonical JSON del payload |
| `payload_checksum` | string | `sha256:<hex>` del canonical JSON |
| `payload` | object\|null | Payload (null si claim check) |

### 8. Idempotencia

- `idempotencykey` = `sha256(canonicalJson(payload))` — función `computeIdempotencyKey(payload)` de `@yoizen/shared`.
- Se mapea al header NATS `Nats-Msg-Id` al publicar.
- JetStream deduplica automáticamente en la `duplicate_window` del stream.
- El canonical JSON ordena las claves del objeto alfabéticamente en todos los niveles (ver `canonicalJson` en `packages/shared/src/envelope.utils.ts`).

### 9. Claim Check

Activado cuando el tamaño serializado del envelope completo supera `CLAIM_CHECK_THRESHOLD_BYTES` (256 KB).

**Productor** (`services/channel-service/src/modules/ingress/ingress.service.ts`):
1. Almacena exactamente `UTF8(canonicalJson(envelope.data.payload))` en el Object Store bucket `PAYLOAD-<tenant>`, clave `<envelope.id>-payload`.
2. Publica un slim `EventEnvelope` con `payload_inline: false`, `payload_ref: "nats://objstore/PAYLOAD-<tenant>/<key>"`, y `payload: null`.

**Consumidor** (`packages/database/src/claim-check.ts`):
1. Detecta `payload_inline: false` (búsqueda de bytes — sin doble parse en el path normal).
2. Llama a `resolveClaimCheckEnvelope(envelope, getStore)`.
3. Verifica `sha256(rawFetchedBytes) === envelope.data.payload_checksum` sobre los bytes crudos — nunca re-canonicaliza.
4. Devuelve el envelope inflado con `payload_inline: true`.

### 10. Cadena Causal

- **`causation_id`**: ID del evento que causó este. `null` si es raíz.
- **`correlation_id`**: ID del flujo de negocio. Se propaga sin modificar. Defaults al `id` del envelope raíz.
- **`transport.depth`**: profundidad incremental para anti-loop. Ver `MAX_DEPTH_BY_CATEGORY` en `packages/shared/src/envelope.utils.ts`.

```
WebhookIngressEnvelope (api-gateway): causation_id=null, correlation_id=<id_propio>
  ↓
ChannelEnvelope received (channel-service): causation_id=<id_webhook_envelope>, correlation_id=<propagado>
  ↓
Evento derivado (agente/workflow): causation_id=<id_channel_envelope>, correlation_id=<propagado>
```

---

## References

- `DOCS/arquitectura/02-diseño-de-mensajes.md` — contrato canónico de envelope, subjects, idempotencia, cadena causal, claim-check (as-built)
- `DOCS/arquitectura/03-ingress-agentes.md` — flujo de ingress de dos etapas (webhook bridge), ciclo de vida de agentes (as-built)
- `DOCS/arquitectura/04-claim-check.md` — protocolo completo de claim-check: producer, consumer middleware, Object Store, métricas (as-built)
- `DOCS/03-NATS-JETSTREAM.md` — topología de streams, taxonomía de subjects y referencia operativa de NATS/JetStream
- `packages/shared/src/interfaces.ts` — tipos `EventEnvelope`, `EventTransport`, `EventData`
- `packages/shared/src/channel.interfaces.ts` — `Channel`, `ChannelProvider`, `MessageKind`, `ChannelEnvelope`
- `packages/shared/src/channel.constants.ts` — `CHANNEL_PRODUCER`, `WEBHOOK_FORWARDED_HEADERS`, `CLAIM_CHECK_THRESHOLD_BYTES`
- `packages/shared/src/channel.utils.ts` — `buildChannelSubject`, `buildWebhookIngressSubject`, `parseChannelSubject`
- `packages/shared/src/envelope.utils.ts` — `computeIdempotencyKey`, `canonicalJson`, `buildSubject`, `deriveEnvelope`
- `packages/shared/src/webhook.interfaces.ts` — `WebhookIngressEnvelope`
- `services/channel-service/src/domain/envelope.factory.ts` — `createChannelEnvelope`
- `services/channel-service/src/modules/ingress/ingress.service.ts` — lógica de claim check (productor)
- `packages/database/src/claim-check.ts` — `resolveClaimCheckEnvelope` (consumidor)
- `references/diseno-mensajes.md` — índice de las fuentes de verdad as-built y referencias de código
