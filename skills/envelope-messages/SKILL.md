---
name: envelope-messages
description: "Manejo de envelopes de mensajes siguiendo el diseño CloudEvents adaptado para NATS. Trigger: Cuando se trabaja con mensajería, eventos NATS, envelopes, subjects, o transporte de eventos."
license: Apache-2.0
metadata:
  author: Yoizen
  version: "3.0"
  scope: [root]
  auto_invoke:
    - "envelope"
    - "messaging"
    - "events"
    - "nats"
---

> **Fuentes de verdad as-built:**
> - `DOCS/messaging/envelope.md` — contrato de envelope, subjects, idempotencia, cadena causal, claim-check (referencia canónica del sistema implementado).
> - `DOCS/messaging/claim-check.md` — protocolo completo de claim-check (producer + consumer).
> - `DOCS/messaging/service-bus.md` — topología de streams, taxonomía de subjects y referencia operativa de NATS/JetStream.
>
> Ante cualquier discrepancia entre los documentos y el código, prevalece el código.
> Fuente de verdad de tipos: `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).

## Activation Contract

Aplicar esta skill al crear, consumir o auditar mensajes del bus de eventos NATS, diseñar subjects, construir envelopes, implementar idempotencia, o manejar el patrón claim check.

## Hard Rules

- Todo mensaje DEBE seguir el contrato canónico `EventEnvelope` definido en `packages/shared/src/interfaces.ts`.
- Los IDs de envelope se generan con `crypto.randomUUID()`. No usar ULIDs ni ningún otro esquema.
- Formato del campo `type` para mensajería: `io.yoizen.messaging.<channel>.<provider>.<kind>.v1`. Para otros dominios el segundo token varía (e.g. `io.yoizen.ai-agent-gateway.automation...`).
- Productores reales del bus: `api-gateway`, `channel-service`, `registry-service`, `agent-admin-service`, `ai-agent-gateway`. Constante de canal: `CHANNEL_PRODUCER = "channel-service"`.
- `source` sigue el formato `//channel-service/accounts/<accountId>` o `//api-gateway/webhooks`. No inventar formatos nuevos.
- `correlation_id` defaults al propio `id` del envelope cuando no se propaga explícitamente (`createChannelEnvelope`). Atención: `buildEventEnvelope` en `@yoizen/shared` usa `randomUUID()` como fallback — pasar `correlationId` explícito en ese camino. Se copia sin modificar en `deriveEnvelope`.
- El `idempotencykey` es `sha256(canonicalJson(payload))` — usar `computeIdempotencyKey` de `@yoizen/shared`. Mapear al header NATS `Nats-Msg-Id` al publicar.
- El flujo de ingreso es un puente de dos etapas: `api-gateway` publica un `WebhookIngressEnvelope` (kind `webhook_received`, sin `accountid`), luego `channel-service` lo consume, verifica la firma, y emite el `ChannelEnvelope` canónico con `accountid` real.
- Nunca duplicar lógica de subject o envelope. Usar siempre las funciones de `@yoizen/shared` (`buildChannelSubject`, `buildWebhookIngressSubject`, `computeIdempotencyKey`, `deriveEnvelope`, `isCompliantEnvelope`, etc.).
- El claim check se activa cuando `JSON.stringify(envelope).byteLength > CLAIM_CHECK_THRESHOLD_BYTES` (256 KB). Bucket: `PAYLOAD-<tenant>` (TTL 7 días, max 512 MB). URI: `nats://objstore/PAYLOAD-<tenant>/<envelope.id>-payload`. Invariante: `sha256(storedBytes) === computePayloadChecksum(payload)`.
- Stream canónico por tenant: `INGRESS-<TENANT>` (subjects `evt.<tenant>.>`). No usar los streams legacy `EVENTS` o `RESULTS`.

## Decision Gates

| Situación | Acción |
|---|---|
| Necesito generar un ID de evento | `crypto.randomUUID()` — nunca ULID |
| Necesito el nombre del producer (canal) | `CHANNEL_PRODUCER` = `"channel-service"` |
| Necesito construir el campo `type` (canal) | `io.yoizen.messaging.${channel}.${provider}.${kind}.v1` — ver `envelope.factory.ts` línea 86 |
| I need the header allowlist | `WEBHOOK_FORWARDED_HEADERS` in `channel.constants.ts` — 7 entries |
| Necesito construir un subject de canal | `buildChannelSubject(tenant, channel, provider, kind)` de `@yoizen/shared` |
| Necesito construir un subject genérico | `buildSubject(params)` de `@yoizen/shared/envelope.utils` |
| Necesito un envelope raíz (no canal) | `buildEventEnvelope(options)` de `@yoizen/shared/envelope.utils` |
| Necesito un envelope derivado | `deriveEnvelope(incoming, overrides)` de `@yoizen/shared/envelope.utils` |
| Necesito verificar que un objeto es un envelope | `isCompliantEnvelope(value)` de `@yoizen/shared` |
| Necesito la checksum del payload | `computePayloadChecksum(payload)` de `@yoizen/shared` — igual que `computeIdempotencyKey` |
| Envelope serializado > 256 KB | Claim check: almacenar `UTF8(canonicalJson(payload))` en Object Store, publicar slim envelope con `payload_inline: false` |
| Soy consumidor y veo `payload_inline: false` | Resolución transparente vía `MultiTenantConsumerManager.wrapHandler` — usa `resolveClaimCheckEnvelope` de `packages/database/src/claim-check.ts` |
| Claim-check falla en lectura | `ClaimCheckResolveError` (no `PermanentError`) → nak → backoff → DLQ tras `MAX_DELIVER` |

---

## Critical Patterns

### 1. Estructura del Envelope (CloudEvents-inspired)

El contrato canónico está en `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).

Ejemplo de un envelope producido por `channel-service` (etapa 2 del ingress):

```json
{
  "specversion": "1.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "//channel-service/accounts/69bea8cd868e860918359cc7",
  "type": "io.yoizen.messaging.whatsapp.meta.received.v1",
  "resource": "tenant/acme/account/69bea8cd868e860918359cc7/channel/whatsapp/provider/meta",
  "time": "2026-03-21T15:40:11.382Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": "b1c2d3e4-0000-0000-0000-000000000001",
  "correlation_id": "b1c2d3e4-0000-0000-0000-000000000001",
  "tenant": "acme",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:a1b2c3d4...",
  "transport": { "method": "webhook", "protocol": "https", "depth": 1 },
  "data": {
    "received_at": "2026-03-21T15:40:11.382Z",
    "payload_inline": true,
    "payload_ref": null,
    "payload_bytes": 512,
    "payload_checksum": "sha256:a1b2c3d4...",
    "payload": { "messageId": "wamid.xxx", "from": "5491100000000" }
  }
}
```

**Campos obligatorios** (todos requeridos en `isCompliantEnvelope`):

| Campo | Tipo | Notas |
|---|---|---|
| `specversion` | string | Siempre `"1.0"` |
| `id` | string | UUID v4 (`crypto.randomUUID()`) |
| `source` | string | URI del servicio. Ej: `//channel-service/accounts/<id>` o `//api-gateway/webhooks` |
| `type` | string | `io.yoizen.messaging.<channel>.<provider>.<kind>.v1` para mensajería |
| `resource` | string | Resource path del recurso afectado |
| `time` | string | ISO 8601 UTC |
| `traceid` | string | OpenTelemetry traceId (32 hex chars vía `activeOrRandomTraceId()`) |
| `causation_id` | string \| null | ID del evento causante. `null` si es raíz |
| `correlation_id` | string | Business flow ID; propagated unchanged. `createChannelEnvelope` and `api-gateway` self-correlate with their own `id`; `buildEventEnvelope` mints a NEW `randomUUID()` when `correlationId` is not passed (`envelope.utils.ts:332`) |
| `tenant` | string | Tenant ID |
| `producer` | string | Servicio publicador. Reales: `api-gateway`, `channel-service`, `registry-service`, `agent-admin-service`, `ai-agent-gateway` |
| `domain` | string | `messaging`, `automation`, `platform` |
| `channel` | string | `whatsapp`, `telegram`, `instagram`, `http`, `platform`. The `Channel` type (`channel.interfaces.ts:3`) is `whatsapp \| instagram \| telegram \| http`; `EventEnvelope.channel` is a free `string` (`interfaces.ts:42`) because internal producers use `platform` |
| `provider` | string | `meta`, `telegram`, `http`, `internal`, `webhook`. `ChannelProvider` (`channel.interfaces.ts:4`) is `meta \| telegram \| http` |
| `accountid` | string | ID de la cuenta lógica (omitido en `WebhookIngressEnvelope`) |
| `idempotencykey` | string | `sha256:<hex>(canonicalJson(payload))` |
| `transport` | EventTransport | Ver §6 |
| `data` | EventData | Ver §7 |

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
| `producer` | Servicio publicador | `channel-service`, `api-gateway`, `agent-admin-service` |
| `domain` | Dominio de negocio | `messaging`, `automation`, `platform` |
| `channel` | Channel | `whatsapp`, `instagram`, `telegram`, `http`, `platform` |
| `provider` | Provider | `meta`, `telegram`, `http`, `internal`, `webhook` |
| `kind` | Tipo de evento | `webhook_received`, `received`, `sent`, `delivered`, `send`, `execution_requested` |
| `v1` | Versión | `v1` |

**Wildcards:**
- `*` — match de un token exacto
- `>` — match de uno o más tokens (solo al final)

```
evt.acme.*.messaging.>                                           -- todo messaging del tenant acme (cualquier producer)
evt.acme.channel-service.messaging.whatsapp.>                   -- todo whatsapp del tenant acme
evt.*.channel-service.messaging.>                               -- todo messaging, todos los tenants
evt.*.api-gateway.messaging.*.webhook.webhook_received.v1       -- todos los pre-ingress (etapa 1)
evt.*.channel-service.messaging.telegram.*.received.v1          -- todos los mensajes recibidos de telegram
```

Constantes en `channel.constants.ts`:
- `CHANNEL_STREAM_SUBJECTS_PATTERN` = `"evt.*.channel-service.messaging.>"`
- `WEBHOOK_INGRESS_SUBJECT_FILTER` = `"evt.*.api-gateway.messaging.*.webhook.webhook_received.v1"`

### 3. Topología de Streams

| Stream / Bucket | Tipo | Subjects | Propósito |
|---|---|---|---|
| `INGRESS-<TENANT>` | JetStream stream | `evt.<tenant>.>` | Bus de eventos canónico por tenant |
| `DLQ-<tenant>` | JetStream stream | `dlq.<tenant>.>` | Dead letters por tenant |
| `PAYLOAD-<tenant>` | JetStream Object Store | keys `<event-id>-payload` | Claim-check para payloads grandes |
| `GATEWAY_AUDIT` | JetStream stream | `audit.gateway.>` | Audit trail cross-tenant del gateway |
| `PLATFORM_TENANTS` | JetStream stream | `platform.tenant.>` | Lifecycle de tenants |

Los streams legacy `EVENTS` y `RESULTS` están deprecados — no usarlos en código nuevo.

Helpers canónicos: `buildIngressStreamName(tenant)` → `INGRESS-<tenant>`, `buildClaimCheckBucket(tenant)` → `PAYLOAD-<tenant>`, `buildDlqStreamName(tenant)` → `DLQ-<tenant>` (todos en `@yoizen/shared`).

### 4. Kinds de Evento

| Kind | Quién publica | Descripción |
|---|---|---|
| `webhook_received` | `api-gateway` | Pre-ingress — webhook recibido antes de verificar firma |
| `received` | `channel-service` | Mensaje entrante del provider (post-verificación) |
| `sent` | `channel-service` | Confirmación de envío del provider |
| `delivered` | `channel-service` | Confirmación de entrega |
| `read` | `channel-service` | Confirmación de lectura |
| `failed` | `channel-service` | Fallo en envío |
| `send` | `channel-service` / workflow | Comando de envío saliente |
| `execution_requested` | `ai-agent-gateway` | Solicitud de ejecución de agente |
| `config_sync` | `agent-admin-service` | Sincronización de configuración de agente |

Tipo canónico `MessageKind` en `packages/shared/src/channel.interfaces.ts`: `"received" | "sent" | "delivered" | "read" | "failed" | "send"`.

El kind `webhook_received` es exclusivo de `WebhookIngressEnvelope` (pre-ingress de `api-gateway`).

### 5. Flujo de Dos Etapas (Webhook Bridge)

```
Provider HTTP POST
      │
      ▼
api-gateway  ──── publishWebhook() ────►  INGRESS-<tenant>
  producer: "api-gateway"                  subject: evt.<t>.api-gateway.messaging.<ch>.webhook.webhook_received.v1
  kind: "webhook_received"                 (WebhookIngressEnvelope — sin accountid)
  data.raw_body_b64: base64(rawBody)
  data.headers: allowlist filtrado
  causation_id: null, correlation_id: <id_propio>
      │
      ▼
channel-service (WebhookIngressConsumerService)
  filterSubject: WEBHOOK_INGRESS_SUBJECT_FILTER
  durableName: "channel-webhook-ingress"
      │
      ▼
  verifica firma HMAC, resuelve accountId
      │
      ▼
  createChannelEnvelope() → IngressService.publish() ──► INGRESS-<tenant>
    producer: "channel-service"                           subject: evt.<t>.channel-service.messaging.<ch>.<prov>.received.v1
    source: "//channel-service/accounts/<accountId>"      (ChannelEnvelope — con accountid real)
    causation_id: <id_webhook_envelope>
    correlation_id: <propagado del webhook envelope>
    transport.depth: 1
```

Archivos clave:
- Publisher etapa 1: `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts`
- Consumer etapa 2: `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts`
- Factory canónica: `services/channel-service/src/domain/envelope.factory.ts` (`createChannelEnvelope`)
- Ingress publish + claim-check: `services/channel-service/src/modules/ingress/ingress.service.ts`

### 6. Transporte

Campo `transport` (tipo `EventTransport` en `packages/shared/src/interfaces.ts`):

| Campo | Tipo | Descripción |
|---|---|---|
| `method` | string | `"webhook"`, `"poll"`, `"stream"`, `"queue_bridge"`, `"agent"` |
| `protocol` | string | `"https"`, `"wss"`, `"amqp"`, `"internal"` |
| `agent_id` | string? | ID del agente (solo para `method: "agent"`) |
| `depth` | number? | Profundidad causal para anti-loop (ver §10) |

El campo `transport.headers` es usado en práctica para el allowlist de webhook headers (ver §8) pero no está declarado en `EventTransport` — es una extensión de facto del factory.

### 7. Data Payload

Campo `data` (tipo `EventData` en `packages/shared/src/interfaces.ts`):

| Campo | Tipo | Descripción |
|---|---|---|
| `received_at` | string | Timestamp ISO 8601; coincide con `envelope.time` |
| `payload_inline` | boolean | `true` si el payload viaja en el mensaje; `false` si se aplicó claim-check |
| `payload_ref` | string \| null | URI al Object Store cuando `payload_inline = false`. Formato: `nats://objstore/PAYLOAD-<tenant>/<event_id>-payload` |
| `payload_bytes` | number | Longitud en bytes del canonical JSON del payload (`canonicalByteLength`) |
| `payload_checksum` | string | `sha256:<hex>` sobre los bytes exactos almacenados en Object Store |
| `payload` | object \| null | Raw del provider, intacto. `null` cuando `payload_inline = false` |

### 8. Headers Allowlist (Webhook)

`WEBHOOK_FORWARDED_HEADERS` constant in `packages/shared/src/channel.constants.ts:55-63` — 7 entries:

```
content-type
x-hub-signature-256
x-hub-signature
x-telegram-bot-api-secret-token
x-http-channel-token
x-request-id
user-agent
```

Lookup O(1) disponible como `WEBHOOK_FORWARDED_HEADERS_SET` (Set). Cualquier otro header debe descartarse.

### 9. Idempotencia

- `idempotencykey = "sha256:" + hex(sha256(canonicalJson(rawPayload)))`.
- `canonicalJson` ordena claves alfabéticamente en todos los niveles — implementado en `canonicalJson` de `packages/shared/src/envelope.utils.ts`.
- Al publicar a JetStream se mapea a `Nats-Msg-Id` header. JetStream deduplica por `duplicate_window` (default del servidor NATS: 2 minutos).
- `computeIdempotencyKey(payload)` y `computePayloadChecksum(payload)` son alias — mismo resultado, distintos propósitos semánticos.

**Violaciones comunes (evitar):**
- Incluir `Date.now()`, `randomUUID()` u otros valores no determinísticos en la key.
- Usar `envelope.id` como `idempotencykey`.
- Omitir el prefijo `sha256:`.

### 10. Claim Check

Activado cuando `JSON.stringify(envelope).byteLength > CLAIM_CHECK_THRESHOLD_BYTES` (256 KB). La medida se toma sobre el **envelope completo serializado**, no solo el payload.

**Invariante central:**

```
Producer almacena: rawBytes = UTF8(canonicalJson(envelope.data.payload))
Consumer verifica: sha256(rawBytes) === envelope.data.payload_checksum
```

No re-canonicalizar en el consumer — los bytes almacenados son el resultado canónico; un round-trip parse→stringify puede alterar el orden de claves y romper la verificación.

**Productor** (`services/channel-service/src/modules/ingress/ingress.service.ts`):

```typescript
// 1. Serializar el payload a bytes canónicos
const rawBytes = Buffer.from(canonicalJson(envelope.data.payload), "utf8");
// 2. Almacenar en Object Store (ANTES de publicar al bus)
await os.putBlob(`${envelope.id}-payload`, rawBytes);
// 3. Publicar slim envelope
publish({ ...envelope, data: { ...envelope.data, payload_inline: false, payload: null,
  payload_ref: `nats://objstore/PAYLOAD-${tenant}/${envelope.id}-payload` } });
```

Bucket `PAYLOAD-<tenant>`: TTL = 7 días (`CLAIM_CHECK_BUCKET_TTL_NS`), max_bytes = 512 MB (`CLAIM_CHECK_BUCKET_MAX_BYTES`). Creado por `IngressService.getClaimCheckBucket` vía `buildClaimCheckBucket(tenant)`.

En caso de fallo al escribir al Object Store: se publica un mensaje al DLQ (`dlq.<tenant>.<subject>`) con header `X-Dlq-Reason: claim_check_store_failed`, y luego se relanza el error (el publish al bus nunca ocurre).

**Consumidor** (`packages/database/src/claim-check.ts` + `MultiTenantConsumerManager`):

La resolución es transparente para el handler — `wrapHandler` en `MultiTenantConsumerManager` la maneja automáticamente:

1. Pre-check de bytes: `looksLikeClaimCheck(msg.data)` busca `'"payload_inline":false'` en raw bytes (sin parsear). Passthrough en el 99% de los casos.
2. Si detectado: `JSON.parse` + `isCompliantEnvelope` + `payload_inline === false`.
3. `resolveClaimCheckEnvelope(envelope, getStore)` → fetch blob → `sha256(rawBytes)` verificado contra `payload_checksum` → `JSON.parse` → envelope inflado.
4. Handler recibe `JsMsg` proxeado con el envelope inflado. `ack/nak/term` delegan al mensaje original (via `Proxy` para preservar el `this` interno de NATS).
5. Fallo → `ClaimCheckResolveError` (no `PermanentError`) → nak → backoff → DLQ tras `MAX_DELIVER`.

Códigos de error (`ClaimCheckErrorCode`): `ref_missing`, `ref_malformed`, `blob_not_found`, `checksum_mismatch`.

### 11. Cadena Causal

- **`causation_id`**: ID del evento que causó este. `null` si es raíz.
- **`correlation_id`**: business flow ID. Propagated unchanged (`deriveEnvelope`, `envelope.utils.ts:197`). The default is producer-specific: `createChannelEnvelope` and `api-gateway` use the root envelope's own `id`; `buildEventEnvelope` falls back to a fresh `randomUUID()` when `correlationId` is not passed (`envelope.utils.ts:332`).
- **`transport.depth`**: profundidad incremental para anti-loop.

`deriveEnvelope` (en `@yoizen/shared`) propaga automáticamente `causation_id`, `correlation_id`, `traceid` y `depth`. `buildEventEnvelope` crea envelopes raíz con `depth: 0`.

`MAX_DEPTH_BY_CATEGORY` en `packages/shared/src/envelope.utils.ts`:

| Categoría (`ProducerCategory`) | MAX_DEPTH |
|---|---|
| `root` | 0 |
| `internal_service` (default) | 5 |
| `internal_agent` | 5 |
| `platform_agent` | 3 |
| `thirdparty_agent` | 2 |

`deriveEnvelope` lanza `DepthExceededError` cuando `newDepth > maxDepth`. La categoría default es `internal_service`.

Ejemplo de cadena:

```
WebhookIngressEnvelope (api-gateway)
  id = evt_A, causation_id = null, correlation_id = evt_A, depth = 0

ChannelEnvelope received (channel-service)         ← deriveEnvelope
  id = evt_B, causation_id = evt_A, correlation_id = evt_A, depth = 1

Evento derivado (workflow/agente)                  ← deriveEnvelope
  id = evt_C, causation_id = evt_B, correlation_id = evt_A, depth = 2
```

---

## References

- `DOCS/messaging/envelope.md` — contrato canónico de envelope, subjects, idempotencia, cadena causal, claim-check (as-built)
- `DOCS/messaging/claim-check.md` — protocolo completo de claim-check: producer, consumer middleware, Object Store, métricas (as-built)
- `DOCS/messaging/service-bus.md` — topología de streams, taxonomía de subjects y referencia operativa de NATS/JetStream
- `packages/shared/src/interfaces.ts` — tipos `EventEnvelope`, `EventTransport`, `EventData`
- `packages/shared/src/channel.interfaces.ts` — `Channel`, `ChannelProvider`, `MessageKind`, `ChannelEnvelope`
- `packages/shared/src/channel.constants.ts` — `CHANNEL_PRODUCER`, `WEBHOOK_FORWARDED_HEADERS`, `CLAIM_CHECK_THRESHOLD_BYTES`, `CLAIM_CHECK_BUCKET_TTL_NS`, `CLAIM_CHECK_BUCKET_MAX_BYTES`
- `packages/shared/src/channel.utils.ts` — `buildChannelSubject`, `buildWebhookIngressSubject`, `buildClaimCheckBucket`, `parseChannelSubject`
- `packages/shared/src/envelope.utils.ts` — `computeIdempotencyKey`, `computePayloadChecksum`, `canonicalJson`, `buildSubject`, `deriveEnvelope`, `buildEventEnvelope`, `isCompliantEnvelope`, `MAX_DEPTH_BY_CATEGORY`
- `packages/shared/src/webhook.interfaces.ts` — `WebhookIngressEnvelope`, `IWebhookIngressData`
- `services/channel-service/src/domain/envelope.factory.ts` — `createChannelEnvelope` (producer canónico)
- `services/channel-service/src/modules/ingress/ingress.service.ts` — lógica de claim check (producer)
- `packages/database/src/claim-check.ts` — `resolveClaimCheckEnvelope`, `looksLikeClaimCheck`, `ClaimCheckResolveError`, `ClaimCheckErrorCode`
- `references/diseno-mensajes.md` — índice de fuentes de verdad as-built
