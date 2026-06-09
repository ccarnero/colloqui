# 02 — Diseño de Mensajes

**Estado:** Borrador para revisión
**Audiencia:** Dev
**Fecha:** 2026-04-17

---

## 1. Resumen

Este documento define el contrato canónico de los eventos que viajan por el bus. Consolida las decisiones D1, D3, D4, D8, D9, D10, D11 y D12 del índice y es la fuente de verdad para los implementadores. Cualquier divergencia con el skill `envelope-messages` debe actualizar ambos lados.

El contrato cubre cinco aspectos:

1. Envelope genérico + raw payload intacto (D1).
2. Routing por NATS subject (D4) con formato fijo de 8 tokens.
3. Allowlist explícito de headers HTTP en el ingress (D8).
4. `traceid`, `causation_id` y `correlation_id` en el envelope (D9, D11).
5. Campo `depth` en `transport` para anti-loop (D12).

---

## 2. Envelope (CloudEvents-inspired)

Todo mensaje publicado al bus **debe** serializarse como el siguiente envelope. El orden de las claves no es significativo, pero los tipos sí lo son.

```json
{
  "specversion": "1.0",
  "id": "01JQXXXX",
  "source": "//channel-service/accounts/69bea8cd",
  "type": "io.yoizen.messaging.whatsapp.meta.received.v1",
  "resource": "tenant/acme/account/69bea8cd/channel/whatsapp/provider/meta",
  "time": "2026-04-17T15:40:11.382Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "conv_acme_wa_5551234_20260321",
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
| `id` | string | Identificador único del evento (ULID o UUIDv4). |
| `source` | string | URI/URN del servicio que produjo el evento. Ej: `//channel-service/accounts/{id}`. |
| `type` | string | Tipo lógico en dot-notation, versionado. Ej: `io.yoizen.messaging.whatsapp.meta.received.v1`. |
| `resource` | string | Resource path del recurso afectado (D10). Formato: `tenant/{t}/account/{a}/channel/{c}/provider/{p}`. |
| `time` | string | ISO 8601 UTC, momento en que el producer creó el envelope. |
| `traceid` | string | OpenTelemetry traceId (32 hex chars). **Debe** extraerse del span activo — no generarse ad-hoc (D9). |
| `causation_id` | string \| null | ID del evento que causó este. `null` solo si es raíz. |
| `correlation_id` | string | ID de negocio que agrupa toda la cadena (D11). |
| `tenant` | string | Tenant ID (snake_case en el envelope). |
| `producer` | string | Servicio que publica. Ej: `channel-service`, `api-gateway`, `agent-admin-service`. |
| `domain` | string | Dominio de negocio. Ej: `messaging`, `automation`, `platform`. |
| `channel` | string | Canal. Ej: `whatsapp`, `telegram`, `events`. |
| `provider` | string | Proveedor. Ej: `meta`, `telegram`, `internal`, `gateway`. |
| `accountid` | string | ID de la cuenta lógica (no del tenant). Puede ser una constante cuando no aplica. |
| `idempotencykey` | string | `sha256:` + hex(sha256(canonical_json(rawPayload))). Debe ser determinístico. |
| `transport` | object | Ver §4. |
| `data` | object | Ver §5. |

### 2.2 Extensiones internas permitidas

Los campos opcionales siguientes extienden el envelope sin romper el contrato:

- `callback_url` — URL HTTP a la que se debe POSTear el resultado cuando un consumer procesa el evento.
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
| `domain` | Dominio de negocio (mismo valor que `envelope.domain`). | `messaging`, `automation`, `platform` |
| `channel` | Canal (mismo que `envelope.channel`). | `whatsapp`, `telegram`, `events` |
| `provider` | Proveedor (mismo que `envelope.provider`). | `meta`, `telegram`, `internal`, `gateway` |
| `kind` | Tipo operacional. | `received`, `sent`, `delivered`, `send`, `agent_outbound`, `agent_action`, `config_sync`, `job_trigger` |
| `version` | Versión semántica del subject, siempre prefijo `v`. | `v1`, `v2` |

**Subscripción por wildcard:**

- Todo el dominio messaging del tenant: `evt.acme.*.messaging.>`
- Solo recibidos por whatsapp del tenant: `evt.acme.*.messaging.whatsapp.*.received.v1`
- Todo lo que publique un producer específico: `evt.*.channel-service.>`
- Eventos de plataforma api-gateway de un tenant: `evt.acme.api-gateway.platform.>`

### 3.1 Relación stream ↔ subjects

- Stream `INGRESS-<tenant>` captura `evt.<tenant>.>` (todos los eventos del tenant).
- Subjects derivados como `events.*`, `results.*`, `dlq.*`, `audit.gateway.*` permanecen como streams administrativos internos y **no** llevan envelope del spec — son canales de control.

---

## 4. Transport

```json
{
  "method": "webhook" | "poll" | "stream" | "queue_bridge" | "agent",
  "protocol": "https" | "wss" | "amqp" | "internal",
  "depth": 0
}
```

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `method` | Sí | Cómo llegó el evento al producer. |
| `protocol` | Sí | Sub-protocolo. |
| `depth` | Sí | Profundidad causal (ver §6). `0` para eventos raíz. |
| `headers` | No | Allowlist de headers HTTP (ver §4.1). Solo válido para `method: "webhook"`. |
| `agent_id` | No | ID del agente (obligatorio cuando `method: "agent"`). |
| `agent_category` | No | `internal` \| `thirdparty` \| `platform`. |
| `confidence` | No | Score del agente, `[0, 1]`. |
| `tool_chain` | No | Lista de tools usados por el agente. |

### 4.1 Allowlist de headers webhook (D8)

Solo estos headers pueden copiarse al `transport.headers`:

```
content-type
x-hub-signature-256
x-hub-signature
x-request-id
user-agent
```

Cualquier otro header debe descartarse.

---

## 5. Data

```json
{
  "received_at": "ISO 8601",
  "payload_inline": true,
  "payload_ref": null,
  "payload_bytes": 480,
  "payload_checksum": "sha256:...",
  "payload": { "...": "..." }
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `received_at` | string | ISO 8601, coincide con `envelope.time` salvo que el producer reciba el evento y lo reempaquete más tarde. |
| `payload_inline` | boolean | `true` si `payload` contiene el raw. `false` si se aplicó claim-check. |
| `payload_ref` | string \| null | URI al store. Obligatorio si `payload_inline = false`. Formato inicial: `nats://objstore/PAYLOAD-<tenant>/<event_id>-payload`. |
| `payload_bytes` | number | Tamaño en bytes del raw (antes del claim-check). |
| `payload_checksum` | string | `sha256:` + hex(sha256(canonical_json(rawPayload))). |
| `payload` | object \| null | Raw del provider, intacto (D1). `null` cuando `payload_inline = false`. |

---

## 6. Cadena causal (D11)

### 6.1 Propagación

Cuando un consumer genera un nuevo evento derivado:

- `correlation_id` se copia **sin modificar** del evento entrante.
- `causation_id` se setea al `id` del evento entrante.
- `traceid` se deriva del span activo. Si el consumer abrió un nuevo trace, el flujo completo se reconstruye por `correlation_id`.
- `transport.depth` se incrementa: `new.depth = incoming.depth + 1`.

### 6.2 Ejemplo

```
Evento A (ingress webhook)
  id           = evt_A
  causation_id = null
  correlation_id = conv_123
  transport.depth = 0
    ↓ (channel-service publica, event-processor consume)
Evento B (event-processor completion)
  id           = evt_B
  causation_id = evt_A
  correlation_id = conv_123
  transport.depth = 1
    ↓ (webhook-service consume y re-emite ack)
Evento C (webhook delivered)
  id           = evt_C
  causation_id = evt_B
  correlation_id = conv_123
  transport.depth = 2
```

### 6.3 Anti-loop (D12)

`MAX_DEPTH` por categoría de producer:

| Producer | MAX_DEPTH |
|----------|-----------|
| Provider externo (raíz) | 0 |
| Servicio interno | 5 |
| Agente interno | 5 |
| Agente de plataforma | 3 |
| Agente de tercero | 2 |

Si `incoming.transport.depth + 1 > MAX_DEPTH`, el producer **no publica**; escribe a DLQ con razón `depth_exceeded` y emite la métrica `agent.depth_exceeded` o `ingress.depth_exceeded` según el contexto.

---

## 7. Idempotencia

- `idempotencykey = "sha256:" + hex(sha256(canonical_json(rawPayload)))`.
- `canonical_json` ordena claves alfabéticamente recursivamente (la util está en `@yoizen/shared/envelope-utils`).
- Al publicar a JetStream, se **mapea** a `Nats-Msg-Id` header (o `msgID` del SDK). JetStream deduplica por `duplicate_window` (default 2 min).
- Cuando se usa `nc.publish` (core NATS, sin dedup), setear `Nats-Msg-Id` igual es obligatorio para compatibilidad con una futura migración a JetStream.

**Violaciones comunes (evitar):**

- Incluir `Date.now()`, `randomUUID()` u otros valores no determinísticos en la key.
- Usar el `envelope.id` como `idempotencykey` (es una garantía de unicidad del evento, no de deduplicación del payload).
- Omitir el prefijo `sha256:`.

---

## 8. Trazabilidad

Tres IDs se mantienen:

- `envelope.traceid` — OpenTelemetry traceId del span activo al momento de publicar (32 hex chars).
- `envelope.correlation_id` — ID de negocio de la conversación/flujo.
- `envelope.causation_id` — ID del evento inmediatamente anterior.

Además, en los headers NATS se inyecta el `traceparent` W3C (ver doc 06 §6) para que el consumer pueda reanudar el span sin parsear el body.

**Regla:** si un producer recibe un request HTTP con `traceparent` válido, debe reutilizarlo en el envelope (`traceid`) y en los headers NATS del publish.

---

## 9. Ejemplos por tipo de fuente

### 9.1 Webhook externo (Meta / WhatsApp)

```json
{
  "type": "io.yoizen.messaging.whatsapp.meta.received.v1",
  "source": "//channel-service/webhooks/meta",
  "tenant": "acme",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "whatsapp",
  "provider": "meta",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 0,
    "headers": { "x-hub-signature-256": "..." }
  }
}
```

Subject: `evt.acme.channel-service.messaging.whatsapp.meta.received.v1`.

### 9.2 Comando interno (api-gateway)

```json
{
  "type": "io.yoizen.platform.events.gateway.command.v1",
  "source": "//api-gateway/events",
  "tenant": "acme",
  "producer": "api-gateway",
  "domain": "platform",
  "channel": "events",
  "provider": "gateway",
  "transport": { "method": "stream", "protocol": "internal", "depth": 0 }
}
```

Subject: `evt.acme.api-gateway.platform.events.gateway.command.v1`.

### 9.3 Completion de event-processor

```json
{
  "type": "io.yoizen.platform.events.gateway.completion.v1",
  "source": "//event-processor/completion",
  "tenant": "acme",
  "producer": "event-processor",
  "domain": "platform",
  "channel": "events",
  "provider": "gateway",
  "causation_id": "<envelope entrante>.id",
  "transport": { "method": "stream", "protocol": "internal", "depth": 1 }
}
```

### 9.4 Agente interno (agent-admin-service)

```json
{
  "type": "io.yoizen.agent-admin-service.admin.agent.published.v1",
  "source": "//agent-admin-service/admin/agents/publish",
  "tenant": "acme",
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

Subject: `evt.acme.agent-admin-service.automation.platform.internal.agent_published.v1`.

---

## 10. Checklist para implementadores

Antes de publicar cualquier mensaje al bus, verificar:

- [ ] El envelope incluye todos los campos obligatorios de §2.1.
- [ ] `idempotencykey` usa `sha256:canonical(rawPayload)` (§7).
- [ ] `traceid` viene del span activo, no `randomBytes()` ni `id`.
- [ ] Si es un evento derivado: `causation_id` apunta al id del entrante y `correlation_id` se copia.
- [ ] `transport.depth` se incrementó si corresponde.
- [ ] El subject sigue el formato de §3 (8 tokens).
- [ ] El publish setea `Nats-Msg-Id` con `idempotencykey`.
- [ ] El publish inyecta `traceparent` con `injectTraceContext(headers)`.
- [ ] Si `payload_bytes > 256 KB`: guardó en Object Store y `payload_inline = false`.

---

## 11. Decisión: taxonomía de streams `INGRESS-<tenant>` (D13)

### 11.1 Contexto

Históricamente, `packages/shared/src/constants.ts` declara dos streams planos:

```ts
export const STREAM_NAME = "EVENTS";
export const STREAM_SUBJECTS = ["events.>"] as const;

export const RESULTS_STREAM_NAME = "RESULTS";
export const RESULTS_STREAM_SUBJECTS = ["results.>"] as const;
```

Esto entra en conflicto con la taxonomía prescrita por [`01-service-bus.md` §4](./01-service-bus.md), que define **un stream por tenant**:

```
Stream:   INGRESS-{tenant}
Subjects: evt.{tenant}.>
```

La coexistencia de ambas nomenclaturas hace que, según qué servicio publique, un mensaje termine en un stream u otro, rompiendo el aislamiento por tenant y multiplicando el número de consumers necesarios.

### 11.2 Decisión

La **única taxonomía canónica** para eventos de dominio (ingress, messaging, workflow, platform) es:

| Elemento | Valor canónico |
|----------|----------------|
| Stream | `INGRESS-<tenant>` |
| Subject filter | `evt.<tenant>.>` (8 tokens, ver §3) |
| Object Store | `PAYLOAD-<tenant>` |

Los streams planos `EVENTS` (`events.>`) y `RESULTS` (`results.>`) quedan **deprecados**. Los prefijos `events.` y `results.` no son válidos en nuevos publishes: todo evento debe viajar por un subject `evt.<tenant>.*` dentro del stream del tenant propietario.

Las métricas/auditoría de plataforma que hoy usan streams compartidos (`GATEWAY_AUDIT`, `DLQ`) se mantienen porque son **cross-tenant por diseño** (SRE-facing) y no forman parte del flujo de negocio.

### 11.3 Migración

1. **Nuevo código**: prohibido publicar en `events.>` o `results.>`. Siempre `evt.<tenant>.>`.
2. **`packages/shared/src/constants.ts`**: `STREAM_NAME`, `STREAM_SUBJECTS`, `SUBJECT_PREFIX`, `RESULTS_STREAM_NAME`, `RESULTS_STREAM_SUBJECTS` y `RESULTS_SUBJECT_PREFIX` se marcan `@deprecated`. El docstring apunta a esta sección.
3. **Event-processor**: los resultados de ejecución se re-emiten como envelopes canónicos en un subject `evt.<tenant>.event-processor.workflow.internal.native.completed.v1` dentro de `INGRESS-<tenant>`, reemplazando el uso del stream `RESULTS` (ver `processor.service.ts`).
4. **Webhook-service**: el consumer se reconfigura para leer del stream del tenant vía filter subject `evt.<tenant>.event-processor.>`, eliminando la dependencia del stream `RESULTS`.
5. **API gateway / channel-service**: ya publican a `evt.<tenant>.>`; no requieren cambios.
6. **Provisioning**: al dar de alta un tenant se crea `INGRESS-<tenant>` (stream) + `PAYLOAD-<tenant>` (object store). Los streams `EVENTS` y `RESULTS` dejan de aprovisionarse en entornos nuevos.

### 11.4 Checklist de retiro

Los siguientes símbolos están programados para eliminarse en una iteración posterior, una vez que ningún servicio los importe:

- `STREAM_NAME`, `STREAM_SUBJECTS`, `SUBJECT_PREFIX`
- `RESULTS_STREAM_NAME`, `RESULTS_STREAM_SUBJECTS`, `RESULTS_SUBJECT_PREFIX`
- `METRICS_SUBJECT = "events.metrics"` → reemplazar por subject tenant-scoped.
- `WEBHOOK_DLQ_SUBJECT = "dlq.webhook"` → conservar. El stream `DLQ` queda restringido al único subject `dlq.webhook` (reentregas agotadas del webhook-service). El namespace `dlq.<tenant>.>` lo consumen los streams per-tenant `DLQ-<tenant>` aprovisionados por `ensureTenantDlqStream`, y la separación de subjects evita el error "subjects overlap with an existing stream" de JetStream.
