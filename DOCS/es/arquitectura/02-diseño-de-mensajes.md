# 02 — Diseño de Mensajes

**Estado:** Referencia del sistema implementado
**Audiencia:** Dev
**Fecha:** 2026-06-11 (actualizado desde borrador 2026-04-17)

> **Nota:** Este documento describe el sistema **implementado**. La referencia operacional
> canónica es [`DOCS/03-messaging.md`](../../../DOCS/03-messaging.md).
> El contrato **fuente de verdad** del envelope está en
> [`packages/shared/src/interfaces.ts`](../../../packages/shared/src/interfaces.ts)
> (`EventEnvelope`, `EventTransport`, `EventData`).

---

## 1. Resumen

Este documento define el contrato canónico de los eventos que viajan por el bus. Consolida las decisiones D1, D3, D4, D8, D9, D10, D11 y D12 del índice. Cualquier divergencia con el skill `envelope-messages` debe actualizar ambos lados.

El contrato cubre cinco aspectos:

1. Envelope genérico + raw payload intacto (D1).
2. Routing por NATS subject (D4) con formato fijo de 8 tokens.
3. Allowlist explícito de headers HTTP en el ingress (D8).
4. `traceid`, `causation_id` y `correlation_id` en el envelope (D9, D11).
5. Campo `depth` en `transport` para anti-loop (D12).

El flujo de ingress tiene **dos etapas**: `api-gateway` publica un `WebhookIngressEnvelope` (kind `webhook_received`, sin `accountid`), y `channel-service` lo consume, verifica la firma, resuelve la cuenta y re-emite el envelope canónico.

---

## 2. Envelope (CloudEvents-inspired)

Todo mensaje publicado al bus **debe** serializarse como el siguiente envelope. El orden de las claves no es significativo, pero los tipos sí lo son.

```json
{
  "specversion": "1.0",
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "source": "//channel-service/accounts/69bea8cd",
  "type": "io.yoizen.messaging.whatsapp.meta.received.v1",
  "resource": "tenant/acme/account/69bea8cd/channel/whatsapp/provider/meta",
  "time": "2026-04-17T15:40:11.382Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "tenant": "acme",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:a1b2c3d4...",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 0
  },
  "data": {
    "received_at": "2026-04-17T15:40:11.382Z",
    "payload_inline": true,
    "payload_ref": null,
    "payload_bytes": 480,
    "payload_checksum": "sha256:a1b2c3d4...",
    "payload": { "...": "raw del provider, intacto (D1)" }
  }
}
```

### 2.1 Campos obligatorios

| Campo | Tipo | Semántica |
|-------|------|-----------|
| `specversion` | string | Siempre `"1.0"` |
| `id` | string | UUID v4 (`crypto.randomUUID()`). |
| `source` | string | URI del servicio que produjo el evento. Ej: `//channel-service/accounts/{id}` o `//api-gateway/webhooks`. |
| `type` | string | Tipo lógico en dot-notation. Formato: `io.yoizen.messaging.<channel>.<provider>.<kind>.v1`. |
| `resource` | string | Resource path del recurso afectado (D10). |
| `time` | string | ISO 8601 UTC, momento en que el producer creó el envelope. |
| `traceid` | string | OpenTelemetry traceId (32 hex chars). Se extrae del span activo via `activeOrRandomTraceId()` de `@yoizen/observability`. Ver nota D9 en §8. |
| `causation_id` | string \| null | ID del evento que causó este. `null` solo si es raíz. |
| `correlation_id` | string | ID que agrupa toda la cadena (D11). **Implementado:** defaults al propio `id` del envelope cuando no se propaga explícitamente. Se copia sin modificar en `deriveEnvelope`. |
| `tenant` | string | Tenant ID. |
| `producer` | string | Servicio que publica. Productores reales: `api-gateway`, `channel-service`, `registry-service`, `agent-admin-service`, `ai-agent-gateway`. |
| `domain` | string | Dominio de negocio. Ej: `messaging`, `automation`, `platform`. |
| `channel` | string | Canal. Ej: `whatsapp`, `telegram`, `platform`. |
| `provider` | string | Proveedor. Ej: `meta`, `telegram`, `internal`. |
| `accountid` | string | ID de la cuenta lógica (no del tenant). En el `WebhookIngressEnvelope` inicial este campo es omitido hasta que `channel-service` resuelve la cuenta. |
| `idempotencykey` | string | `sha256:` + hex(sha256(canonical_json(rawPayload))). Debe ser determinístico. |
| `transport` | object | Ver §4. |
| `data` | object | Ver §5. |

### 2.2 Extensiones internas permitidas

Los campos opcionales siguientes extienden el envelope sin romper el contrato (definidos en `packages/shared/src/interfaces.ts`):

- `callback_url` — URL HTTP a la que se debe POSTear el resultado.
- `adapter_id` — ID del adapter para autenticar la entrega HTTP del resultado.
- `enrich_adapter` — `{ adapterId, endpointId }` para enrichment pre-handler.
- `forward_adapter` — `{ adapterId, endpointId }` para forwarding post-handler.

Cualquier otra extensión requiere revisión de diseño y actualización de este documento.

---

## 3. Subject Design (NATS)

Formato canónico (8 tokens):

```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
```

| Token | Semántica | Ejemplos |
|-------|-----------|----------|
| `evt` | Prefijo fijo. | `evt` |
| `tenant` | Tenant ID (mismo valor que `envelope.tenant`). | `acme`, `globex` |
| `producer` | Servicio que publica. | `channel-service`, `api-gateway`, `agent-admin-service` |
| `domain` | Dominio de negocio. | `messaging`, `automation`, `platform` |
| `channel` | Canal. | `whatsapp`, `telegram`, `platform` |
| `provider` | Proveedor. | `meta`, `telegram`, `internal`, `webhook` |
| `kind` | Tipo operacional. | `webhook_received`, `received`, `sent`, `delivered`, `send`, `agent_outbound`, `config_sync`, `job_trigger` |
| `version` | Versión del subject. | `v1` |

**Subscripción por wildcard:**

- Todo el dominio messaging del tenant: `evt.acme.*.messaging.>`
- Solo recibidos por telegram del tenant: `evt.acme.*.messaging.telegram.*.received.v1`
- Todo lo que publique un producer: `evt.*.channel-service.>`
- Todos los webhooks de ingress (etapa 1): `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1`

### 3.1 Relación stream ↔ subjects

- Stream `INGRESS-<tenant>` captura `evt.<tenant>.>` (todos los eventos del tenant).
- Los subjects `dlq.<tenant>.>`, `audit.gateway.>` no usan el envelope canónico — son canales de control con su propio formato.

---

## 4. Transport

Los campos de `EventTransport` implementados en código (`packages/shared/src/interfaces.ts`):

```typescript
interface EventTransport {
  method: "webhook" | "poll" | "stream" | "queue_bridge" | "agent";
  protocol: "https" | "wss" | "amqp" | "internal";
  agent_id?: string;
  depth?: number;
}
```

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `method` | Sí | Cómo llegó el evento al producer. |
| `protocol` | Sí | Sub-protocolo. |
| `depth` | Recomendado | Profundidad causal (ver §6). `0` para eventos raíz. |
| `agent_id` | No | ID del agente (cuando `method: "agent"`). |

### 4.1 Allowlist de headers webhook (D8)

Seis headers pueden copiarse al `transport.headers`. Definidos en `WEBHOOK_FORWARDED_HEADERS`, `packages/shared/src/channel.constants.ts:55`:

```
content-type
x-hub-signature-256
x-hub-signature
x-telegram-bot-api-secret-token
x-request-id
user-agent
```

Cualquier otro header debe descartarse.

### 4.2 Campos del transport pendientes de implementación

> **Estado: pendiente — diseño no implementado**
>
> Los siguientes campos estaban en el diseño inicial pero no se encuentran en `EventTransport`:
>
> - `agent_category` — `internal` \| `thirdparty` \| `platform`
> - `confidence` — score del agente, `[0, 1]`
> - `tool_chain` — lista de tools usados por el agente
> - `vendor` — proveedor de plataforma AI

---

## 5. Data

```typescript
interface EventData {
  received_at: string;
  payload_inline: boolean;
  payload_ref: string | null;
  payload_bytes: number;
  payload_checksum: string;
  payload: Record<string, unknown> | null;
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `received_at` | string | ISO 8601, coincide con `envelope.time`. |
| `payload_inline` | boolean | `true` si `payload` contiene el raw. `false` si se aplicó claim-check. |
| `payload_ref` | string \| null | URI al store cuando `payload_inline = false`. Formato: `nats://objstore/PAYLOAD-<tenant>/<event_id>-payload`. |
| `payload_bytes` | number | Longitud en bytes del canonical JSON del payload. |
| `payload_checksum` | string | `sha256:` + hex(sha256 sobre los bytes exactos almacenados). |
| `payload` | object \| null | Raw del provider, intacto (D1). `null` cuando `payload_inline = false`. |

### 5.1 Claim-check (payloads > 256 KB)

Cuando `payload_bytes > CLAIM_CHECK_THRESHOLD_BYTES` (256 KB, `packages/shared/src/channel.constants.ts`), el producer almacena el payload en el Object Store y publica un envelope con:

- `payload_inline: false`
- `payload_ref: "nats://objstore/PAYLOAD-<tenant>/<event_id>-payload"`
- `payload: null`
- `payload_bytes`: longitud en bytes del canonical JSON del payload
- `payload_checksum`: `sha256` sobre los bytes exactos almacenados (utf8 del canonical JSON)

Los consumers resuelven el claim-check transparentemente a través del middleware central en `packages/database/src/claim-check.ts` + `multi-tenant-consumer-manager.ts` — el handler recibe siempre el envelope inflado. El bucket `PAYLOAD-<tenant>` es creado por `channel-service` con TTL 7 días y max_bytes 512 MB.

Ver doc 04 para el protocolo completo.

---

## 6. Cadena causal (D11)

### 6.1 Propagación

Cuando un consumer genera un nuevo evento derivado (`deriveEnvelope`, `packages/shared/src/envelope.utils.ts`):

- `correlation_id` se copia **sin modificar** del evento entrante.
- `causation_id` se setea al `id` del evento entrante.
- `traceid` se copia del envelope entrante (el caller debería sobrescribirlo con el traceId OTEL activo cuando sea posible).
- `transport.depth` se incrementa: `new.depth = incoming.depth + 1`.

Para eventos raíz (`buildEventEnvelope`):
- `correlation_id` defaults al `id` del envelope si no se pasa explícitamente.
- `causation_id` defaults a `null`.
- `traceid` defaults a `randomUUID()` si no se pasa (ver nota en §8 sobre D9).

### 6.2 Ejemplo

```
Evento A (ingress webhook — api-gateway)
  id             = evt_A
  causation_id   = null
  correlation_id = evt_A   (default al propio id)
  transport.depth = 0
    ↓ (channel-service publica canonical envelope)
Evento B (channel-service — canonical)
  id             = evt_B
  causation_id   = evt_A
  correlation_id = evt_A   (copiado del evento entrante)
  transport.depth = 1
    ↓ (workflow-service genera evento de respuesta)
Evento C (workflow completion)
  id             = evt_C
  causation_id   = evt_B
  correlation_id = evt_A   (copiado sin modificar)
  transport.depth = 2
```

### 6.3 Anti-loop (D12)

`MAX_DEPTH_BY_CATEGORY` en `packages/shared/src/envelope.utils.ts`:

| Categoría (`ProducerCategory`) | MAX_DEPTH |
|-------------------------------|-----------|
| `root` (provider externo) | 0 |
| `internal_service` | 5 |
| `internal_agent` | 5 |
| `platform_agent` | 3 |
| `thirdparty_agent` | 2 |

`deriveEnvelope` y `buildEventEnvelope` lanzan `DepthExceededError` cuando `newDepth > maxDepth`.

> **Estado: implementación parcial — comportamiento inconsistente**
>
> - `deriveEnvelope` / `buildEventEnvelope` en `@yoizen/shared` usan `MAX_DEPTH_BY_CATEGORY` correctamente.
> - `DepthTrackerService` en `agent-ai-service` usa su propio `DEFAULT_MAX_DEPTH = 5` hardcodeado y rechaza cuando `depth >= DEFAULT_MAX_DEPTH` (comparación distinta a `>`).
> - El comportamiento documentado originalmente (al exceder el depth: escribir al DLQ con razón `depth_exceeded` y emitir métrica `agent.depth_exceeded`) **no está implementado**. Los errores se lanzan como excepciones sin ruteo automático al DLQ ni emisión de métricas.

> **Diseño objetivo (pendiente):**
>
> - Unificar el enforcement usando `MAX_DEPTH_BY_CATEGORY` en todos los servicios.
> - Cuando se excede el depth: publicar al `DLQ-<tenant>` con `X-Dlq-Reason: depth_exceeded` y emitir la métrica correspondiente, en lugar de lanzar una excepción que puede perder el mensaje.

---

## 7. Idempotencia

- `idempotencykey = "sha256:" + hex(sha256(canonical_json(rawPayload)))`.
- `canonical_json` ordena claves alfabéticamente en todos los niveles. Implementado en `canonicalJson` de `packages/shared/src/envelope.utils.ts`.
- Al publicar a JetStream se mapea a `Nats-Msg-Id` header (o `msgID` del SDK). JetStream deduplica por `duplicate_window`, que **no se configura explícitamente** — se usa el default del servidor NATS (2 minutos).

**Violaciones comunes (evitar):**

- Incluir `Date.now()`, `randomUUID()` u otros valores no determinísticos en la key.
- Usar el `envelope.id` como `idempotencykey` (es unicidad del evento, no deduplicación del payload).
- Omitir el prefijo `sha256:`.

---

## 8. Trazabilidad

Tres IDs se mantienen:

- `envelope.traceid` — OpenTelemetry traceId (32 hex chars).
- `envelope.correlation_id` — ID de negocio del flujo/conversación.
- `envelope.causation_id` — ID del evento inmediatamente anterior.

**Nota sobre D9 (`traceid`):**

- `createChannelEnvelope` (channel-service) y el código de api-gateway usan `activeOrRandomTraceId()` de `@yoizen/observability`, que extrae el traceId del span OTEL activo.
- `buildEventEnvelope` en `@yoizen/shared` fallback a `randomUUID()` cuando no se pasa `traceid` explícitamente. Este fallback produce un UUID (formato 8-4-4-4-12) en lugar de un traceId OTEL válido (32 hex chars). Los callers deben pasar el traceId activo explícitamente.
- `deriveEnvelope` copia el `traceid` del envelope entrante; el caller debería sobrescribirlo con el traceId del span activo cuando corresponda.

Además, en los headers NATS se inyecta el `traceparent` W3C para que el consumer pueda reanudar el span sin parsear el body.

---

## 9. Ingress en dos etapas

El ingreso de webhooks externos sigue un proceso en dos etapas:

**Etapa 1 — api-gateway:**

Recibe el POST del provider y publica inmediatamente un `WebhookIngressEnvelope` (definido en `packages/shared/src/webhook.interfaces.ts`):

```
type:     io.yoizen.messaging.<channel>.webhook.webhook_received.v1
source:   //api-gateway/webhooks
subject:  evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1
```

Este envelope incluye `raw_body_b64` y `headers` (allowlist), pero **no** tiene `accountid` porque la cuenta aún no está resuelta.

**Etapa 2 — channel-service:**

Consume el `webhook_received`, verifica la firma del provider, resuelve la cuenta y publica el envelope canónico:

```
type:     io.yoizen.messaging.<channel>.<provider>.<kind>.v1
source:   //channel-service/accounts/<accountId>
subject:  evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v1
```

Este envelope sí contiene `accountid` y es el que procesan el resto de los consumers (workflow-service, audit-service, etc.).

---

## 10. Ejemplos por tipo de fuente

### 10.1 Webhook externo — etapa 1 (api-gateway → bus)

```json
{
  "type": "io.yoizen.messaging.telegram.webhook.webhook_received.v1",
  "source": "//api-gateway/webhooks",
  "producer": "api-gateway",
  "domain": "messaging",
  "channel": "telegram",
  "provider": "webhook",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 0,
    "headers": { "x-telegram-bot-api-secret-token": "..." }
  }
}
```

Subject: `evt.acme.api-gateway.messaging.telegram.webhook.webhook_received.v1`

### 10.2 Webhook externo — etapa 2 (channel-service → bus, envelope canónico)

```json
{
  "type": "io.yoizen.messaging.telegram.telegram.received.v1",
  "source": "//channel-service/accounts/69bea8cd",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "telegram",
  "provider": "telegram",
  "accountid": "69bea8cd868e860918359cc7",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 1,
    "headers": { "x-telegram-bot-api-secret-token": "..." }
  }
}
```

Subject: `evt.acme.channel-service.messaging.telegram.telegram.received.v1`

### 10.3 Agente interno (agent-admin-service)

```json
{
  "type": "io.yoizen.agent-admin-service.automation.platform.internal.agent_published.v1",
  "source": "agent-admin-service",
  "producer": "agent-admin-service",
  "domain": "automation",
  "channel": "platform",
  "provider": "internal",
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "agent-admin-service",
    "depth": 0
  }
}
```

Subject: `evt.acme.agent-admin-service.automation.platform.internal.agent_published.v1`

### 10.4 ai-agent-gateway

```json
{
  "type": "io.yoizen.ai-agent-gateway.automation.platform.internal.execution_requested.v1",
  "source": "ai-agent-gateway",
  "producer": "ai-agent-gateway",
  "domain": "automation",
  "channel": "platform",
  "provider": "internal",
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "ai-agent-gateway",
    "depth": 0
  }
}
```

Subject: `evt.acme.ai-agent-gateway.automation.platform.internal.execution_requested.v1`

---

## 11. Checklist para implementadores

Antes de publicar cualquier mensaje al bus, verificar:

- [ ] El envelope incluye todos los campos obligatorios de §2.1.
- [ ] `idempotencykey` usa `sha256:canonical(rawPayload)` (§7).
- [ ] `traceid` viene del span activo via `activeOrRandomTraceId()` (§8).
- [ ] Si es un evento derivado: `causation_id` apunta al id del entrante y `correlation_id` se copia sin modificar.
- [ ] `transport.depth` se incrementó si corresponde (usar `deriveEnvelope` de `@yoizen/shared`).
- [ ] El subject sigue el formato de §3 (8 tokens).
- [ ] El publish setea `Nats-Msg-Id` con `idempotencykey`.
- [ ] El publish inyecta `traceparent` con `injectTraceContext(headers)`.
- [ ] Si `payload_bytes > 256 KB`: guardó en Object Store y `payload_inline = false`.
- [ ] `source` sigue el formato `//channel-service/accounts/<id>` o `//api-gateway/webhooks` (no inventar formatos nuevos).

---

## 12. Decisión: taxonomía de streams `INGRESS-<tenant>` (D13)

La **única taxonomía canónica** para eventos de dominio es:

| Elemento | Valor canónico |
|----------|----------------|
| Stream | `INGRESS-<TENANT_EN_MAYÚSCULAS>` |
| Subject filter | `evt.<tenant>.>` (8 tokens, ver §3) |
| Object Store | `PAYLOAD-<tenant>` |

Los streams planos `EVENTS` (`events.>`) y `RESULTS` (`results.>`) quedan **deprecados** y están marcados en `packages/shared/src/constants.ts`. No deben usarse en código nuevo.

Las métricas/auditoría de plataforma que usan streams compartidos (`GATEWAY_AUDIT`, `DLQ`) se mantienen porque son cross-tenant por diseño y no forman parte del flujo de negocio.
