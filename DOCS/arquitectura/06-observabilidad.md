# 06 — Observabilidad

**Estado:** Referencia operacional — sistema implementado
**Audiencia:** Infra + Dev
**Fecha:** 2026-06-11 (actualizado desde borrador 2026-03-21)

> **Referencia operacional as-built:** `DOCS/03-NATS-JETSTREAM.md`

---

## 1. Resumen

Este documento describe los estándares de observabilidad del sistema de mensajería. Para cada área se distingue el **estado actual** (métricas, logs y alertas realmente emitidos) del **diseño objetivo** (planificado pero no implementado). Las métricas documentadas aquí son las que el código emite realmente; los nombres del borrador original no coincidían con la implementación.

---

## 2. Métricas

### 2.1 Ingress pipeline (channel-service)

Fuente: `services/channel-service/src/modules/ingress/ingress.metrics.ts`

| Métrica | Tags | Tipo | Descripción |
|---------|------|------|-------------|
| `channel.webhook.requests` | `channel`, `tenant` | counter | Total de requests webhook recibidos |
| `channel.webhook.verification_failures` | `channel`, `tenant` | counter | Fallos de verificación HMAC / token |
| `channel.ingress.messages_received` | `channel`, `tenant` | counter | Mensajes inbound parseados del webhook |
| `channel.ingress.messages_published` | `channel`, `tenant` | counter | Mensajes publicados exitosamente a JetStream |
| `channel.ingress.publish_failures` | `channel`, `tenant` | counter | Fallos en publish a JetStream |
| `channel.ingress.publish_duration_ms` | `channel`, `tenant` | histogram | Duración de publish en ms (se registra en el path inline y en el path claim-check) |
| `channel.ingress.claim_check_count` | `channel`, `tenant` | counter | Mensajes que superaron el umbral y usaron claim-check |
| `channel.ingress.claimcheck.stored` | `tenant` | counter | Payloads guardados exitosamente en Object Store |
| `channel.ingress.claimcheck.store_failed` | `tenant` | counter | Fallos al escribir en Object Store |

**Métricas de ingress del diseño original no implementadas:**

> **Estado: pendiente — no implementado**
> `ingress.verified`, `ingress.validation_failed`, `ingress.rate_limited`, `ingress.payload_bytes`, `ingress.claimcheck.inline`, `ingress.claimcheck.store_latency_ms`.

### 2.2 Egress pipeline (channel-service)

Fuente: `services/channel-service/src/modules/egress/egress.metrics.ts`

| Métrica | Tags | Tipo | Descripción |
|---------|------|------|-------------|
| `channel.egress.messages_sent` | — | counter | Mensajes outbound enviados via API del provider |
| `channel.egress.send_failures` | — | counter | Errores al enviar |
| `channel.egress.send_duration_ms` | — | histogram | Duración del envío outbound en ms |

`egress.shadow_publish_ok` del diseño original **no está implementado**.

### 2.3 Consumer compartido (paquete observabilidad)

Fuente: `packages/observability/src/nats-consumer-metrics.ts`

Emitido por `NatsConsumerRunner` / `MultiTenantConsumerManager`. Label `durable` identifica el consumer.

| Métrica | Labels | Tipo | Descripción |
|---------|--------|------|-------------|
| `nats.consumer.messages.processed` | `durable`, `result` | counter | Total mensajes procesados; `result` ∈ `ack \| nak \| term` |
| `nats.consumer.processing.duration` | `durable` | histogram | Latencia end-to-end del handler en ms |
| `nats.consumer.in_flight` | `durable` | up/down counter | Mensajes en vuelo; sube al dispatch, baja en ack/nak/term |
| `nats.consumer.claimcheck.resolved` | `durable` | counter | Envelopes claim-check resueltos exitosamente |
| `nats.consumer.claimcheck.resolve_failed` | `durable`, `code` | counter | Fallos de resolución; `code` ∈ `ref_missing \| ref_malformed \| blob_not_found \| checksum_mismatch` |

En Prometheus (via pipeline OTLP → collector) los nombres aparecen como:

```
nats_consumer_messages_processed_total{durable, result}
nats_consumer_processing_duration_milliseconds_bucket{durable, le}
nats_consumer_in_flight{durable}
```

**Métricas de consumer del diseño original no implementadas:**

> **Estado: pendiente — no implementado**
> `consumer.claimcheck.resolve_latency_ms`, `consumer.claimcheck.checksum_mismatch` como métrica independiente (está cubierto por `nats.consumer.claimcheck.resolve_failed{code="checksum_mismatch"}`).

### 2.4 HTTP server

Fuente: `packages/observability/src/http-metrics.ts`

| Métrica | Labels | Tipo | Descripción |
|---------|--------|------|-------------|
| `http.server.request.total` | `method`, `route`, `status_code` | counter | Total de requests HTTP recibidos |
| `http.server.request.duration` | `method`, `route`, `status_code` | histogram | Duración del request en ms |
| `http.server.active_requests` | `method` | up/down counter | Requests HTTP en vuelo |

Los 429 por rate-limiting son visibles como `http.server.request.total{status_code="429"}`. No hay una métrica dedicada `ingress.rate_limited`.

### 2.5 Circuit breaker

Fuente: `packages/observability/src/circuit-breaker-metrics.ts`

| Métrica | Labels | Tipo | Descripción |
|---------|--------|------|-------------|
| `circuit_breaker.decisions` | `key`, `action`, `status`, `reason` | counter | Decisiones allow/deny del circuit breaker |
| `circuit_breaker.transitions` | `key`, `from`, `to` | counter | Transiciones de estado (closed/open/half_open) |
| `circuit_breaker.l1_hits` | `key` | counter | Decisiones servidas desde cache L1 in-process (500 ms) |
| `circuit_breaker.redis_errors` | — | counter | Errores de Redis; cada uno activa fallback al breaker local |
| `circuit_breaker.decide_duration` | — | histogram | Latencia end-to-end de `canProceed` en ms |

### 2.6 SSE

> **Estado: pendiente — no implementado**

Las métricas de SSE del diseño original (`sse.connections_active`, `sse.events_streamed`, `sse.events_dropped`) no están implementadas.

### 2.7 Infraestructura NATS — métricas del exporter (no emitidas por código de aplicación)

Las métricas de infraestructura NATS **provienen del NATS Prometheus exporter** (no del código de aplicación). El exporter expone métricas `gnatsd_*` y JetStream. Los nombres del diseño original (`nats.stream.bytes`, `nats.objstore.*`) no existen; los nombres reales son los del exporter:

| Métrica del exporter | Descripción |
|---------------------|-------------|
| `gnatsd_varz_connections` | Conexiones activas |
| `gnatsd_varz_slow_consumers` | Slow consumers |
| `jetstream_server_total_message_bytes` | Bytes totales en JetStream |
| `jetstream_server_max_storage` | Capacidad máxima configurada |
| `jetstream_stream_messages{stream_name}` | Mensajes por stream (incluye DLQ-*) |
| `jetstream_consumer_num_pending{consumer_name}` | Mensajes pendientes por consumer |
| `jetstream_consumer_num_ack_pending{consumer_name}` | Ack-pending por consumer |

### 2.8 Métricas de agentes

> **Estado: pendiente — no implementado**

Las métricas de agentes del diseño original (`ingress.agent.events`, `ingress.agent.depth_exceeded`, `ingress.agent.confidence`, `ingress.agent.auth_failed`, `ingress.agent.authorization_denied`) no están implementadas.

---

## 3. Logging estructurado

### 3.1 Campos implementados

Fuente: `packages/observability/src/envelope-logging.ts` — `IStructuredLogFields`

Cada paso en el pipeline de ingress loguea como mínimo:

```json
{
  "level": "info",
  "timestamp": "2026-06-11T15:40:11.382Z",
  "event_id": "3f9c2d1e-8a47-4b6f-9c21-5d8e0a7b4c12",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "3f9c2d1e-8a47-4b6f-9c21-5d8e0a7b4c12",
  "tenant": "acme",
  "channel": "whatsapp",
  "provider": "meta",
  "producer": "channel-service",
  "domain": "messaging",
  "idempotency_key": "sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "depth": 0,
  "step": "publish"
}
```

Los campos exactos extraídos son: `event_id`, `trace_id`, `causation_id`, `correlation_id`, `tenant`, `channel`, `provider`, `producer`, `domain`, `idempotency_key`, `depth`, `step`.

### 3.2 Campos de audit para agentes

> **Estado: pendiente — no implementado**

Los campos adicionales para agentes del diseño original (`agent_id`, `agent_model`, `confidence`, `tool_chain`, `agent_vendor`, `api_key_id`, `origin_ip`, `platform_*`) no están en `IStructuredLogFields` ni se emiten.

### 3.3 Niveles de log

| Situación | Nivel | Incluye payload |
|-----------|-------|-----------------|
| Webhook recibido | warn (si falla) / implícito (si ok) | No |
| Verificación de firma fallida | warn | No (solo razón del fallo) |
| Payload inválido (no objeto JSON) | warn | No |
| Sin cuentas activas para el tenant | warn | No |
| Publish exitoso | info (resumen batch) | No |
| Publish fallido (individual) | warn | No |
| Claim-check: payload almacenado | info | No (solo metadatos: bytes, ref) |
| Claim-check: fallo de escritura en Object Store | error | Solo metadatos (event_id, key, error) |
| DLQ publish fallido | error | Solo metadatos |

### 3.4 Regla de PII en logs

**Nunca se loguea `data.payload`.** La función `envelopeLogFields` extrae exclusivamente campos de metadatos del envelope. El raw payload (que puede contener teléfonos, nombres y contenido de mensajes) solo es accesible directamente desde el stream JetStream o el Object Store con credenciales apropiadas.

---

## 4. Alertas implementadas

Las alertas están definidas en `infrastructure/base/observability/prometheus/alerts.yaml`.

### 4.1 Grupo `nats-dlq` — superficie de alerting principal para mensajes envenenados

| Alerta | Expresión | Severidad | Descripción |
|--------|-----------|-----------|-------------|
| `DlqMessageDetected` | `increase(jetstream_stream_messages{stream_name=~"DLQ-.*"}[1m]) > 0` for 0m | **critical** | Nuevo mensaje en cualquier stream DLQ-*. Inspeccionar headers `X-Dlq-Reason / X-Dlq-Stage / X-Dlq-Original-Subject` para identificar la causa y el tenant |
| `DlqIngestRateSustained` | tasa > 0.05 msg/s por 10 min | **warning** | Fallos permanentes repetidos — posible deploy roto o tenant mal configurado |
| `DlqBacklogGrowing` | `deriv(jetstream_stream_messages{DLQ-.*}[15m]) > 0` por 30 min | **warning** | El backlog del DLQ crece sin drenarse; repasar y/o replay manual |

### 4.2 Grupo `nats-consumer-lag` — backpressure de consumers

Consumers monitoreados: `workflow-triggers`, `channel-webhook-ingress`, `auto-reply`, `channel-egress`, `webhook-dispatcher`, `event-processor`.

| Alerta | Condición | Severidad |
|--------|-----------|-----------|
| `NatsConsumerPendingHigh` | `jetstream_consumer_num_pending > 500` por 2 min | **warning** |
| `NatsConsumerAckPendingHigh` | `jetstream_consumer_num_ack_pending > 200` por 5 min | **warning** |

### 4.3 Grupo `nats` — salud de infraestructura

| Alerta | Condición | Severidad |
|--------|-----------|-----------|
| `NatsDown` | exporter inalcanzable por 1 min | **critical** |
| `NatsSlowConsumers` | `gnatsd_varz_slow_consumers > 0` por 5 min | **warning** |
| `NatsJetStreamStorageHigh` | storage > 80% de max_file por 10 min | **warning** |
| `NatsHighConnectionCount` | conexiones > 1000 por 5 min | **warning** |

### 4.4 Grupo `api-gateway` — errores HTTP

| Alerta | Condición | Severidad |
|--------|-----------|-----------|
| `HighErrorRate` | tasa 5xx > 5% por 5 min | **critical** |
| `HighP99Latency` | p99 > 5 s por 5 min | **warning** |
| `HighRateLimitRate` | tasa 429 > 20% por 5 min | **warning** |

### 4.5 Alertas del diseño original no implementadas

> **Estado: pendiente — no implementado**

Las alertas basadas en métricas de aplicación inventadas en el diseño original (`verification_failed rate > 20%`, `claimcheck.store_failed > 0`, `claimcheck.checksum_mismatch`, `agent.depth_exceeded`, `agent.auth_failed`) no tienen expresiones Prometheus correspondientes porque esas métricas no existen con esos nombres. Los equivalentes reales son:

- Fallos de verificación: `channel.webhook.verification_failures` (disponible como OTLP, no tiene alerta Prometheus configurada aún)
- Checksum mismatch: visible en logs y en `nats.consumer.claimcheck.resolve_failed{code="checksum_mismatch"}`
- Store failures: `channel.ingress.claimcheck.store_failed` → DLQ → alerta `DlqMessageDetected` con `X-Dlq-Reason: claim_check_store_failed`

---

## 5. Dashboards sugeridos

### 5.1 Dashboard: Bus Overview

Vista general de salud del bus. Audiencia: Infra.

| Panel | Tipo | Métrica real |
|-------|------|-------------|
| Mensajes/seg publicados | Time series | `channel.ingress.messages_published` rate |
| Tasa de error de publish | Time series | `channel.ingress.publish_failures` / `channel.ingress.messages_received` |
| Latencia de publish (p50, p95, p99) | Time series | `channel.ingress.publish_duration_ms` percentiles |
| Mensajes DLQ por stream | Time series | `jetstream_stream_messages{stream_name=~"DLQ-.*"}` |
| Consumer pending | Bar chart | `jetstream_consumer_num_pending` por consumer |
| Storage JetStream | Gauge | `jetstream_server_total_message_bytes / jetstream_server_max_storage` |

### 5.2 Dashboard: Ingress por Provider

Detalle de ingress por provider. Audiencia: Dev.

| Panel | Tipo | Métrica real |
|-------|------|-------------|
| Requests/seg por channel/tenant | Time series | `channel.webhook.requests` rate |
| Verificaciones fallidas | Time series | `channel.webhook.verification_failures` by channel/tenant |
| Mensajes publicados | Time series | `channel.ingress.messages_published` rate |
| Claim-check ratio | Time series | `channel.ingress.claim_check_count` vs `channel.ingress.messages_published` |
| Fallos Object Store | Time series | `channel.ingress.claimcheck.store_failed` rate |

### 5.3 Dashboard: Claim Check Health

Audiencia: Infra.

| Panel | Tipo | Métrica real |
|-------|------|-------------|
| Stores/seg | Time series | `channel.ingress.claimcheck.stored` rate |
| Store failures | Time series | `channel.ingress.claimcheck.store_failed` rate |
| Resoluciones exitosas | Time series | `nats.consumer.claimcheck.resolved` by durable |
| Fallos de resolución por código | Time series | `nats.consumer.claimcheck.resolve_failed` by durable, code |

### 5.4 Dashboard: Consumer Lag

Audiencia: Infra.

| Panel | Tipo | Métrica real |
|-------|------|-------------|
| Pending por consumer | Time series | `jetstream_consumer_num_pending` |
| Ack-pending | Time series | `jetstream_consumer_num_ack_pending` |
| Mensajes procesados (ack/nak/term) | Time series | `nats.consumer.messages.processed` by durable, result |
| In-flight | Time series | `nats.consumer.in_flight` by durable |

---

## 6. Tracing

### 6.1 OpenTelemetry — configuración implementada

Fuente: `packages/observability/src/telemetry.ts`

El SDK configura:

- **Propagator:** `W3CTraceContextPropagator` — propaga trace via headers `traceparent` / `tracestate` (W3C Trace Context)
- **Context manager:** `AsyncLocalStorageContextManager`
- **Exporters:** OTLP HTTP para trazas (`/v1/traces`) y métricas (`/v1/metrics`); endpoint configurable via `OTEL_EXPORTER_OTLP_ENDPOINT`

### 6.2 Propagación en NATS — dos mecanismos distintos

> Es importante distinguir dos cosas que pueden parecer lo mismo pero no lo son:

**1. Campo `traceid` del envelope** — snapshot del trace id al momento de publicar

`envelope.traceid` se popula con `activeOrRandomTraceId()` (`packages/observability/src/envelope-logging.ts`), que retorna el trace id activo de OTEL o, si no hay trace activo, un UUID aleatorio de 32 hex chars. Este campo es un snapshot de correlación para logs; **no es propagación live de contexto**.

En el path de `buildEventEnvelope` del paquete shared, el fallback es `randomUUID()` directamente. Esto significa que si no hay span activo al momento de construir el envelope (por ejemplo en rutas sin instrumentación HTTP), el `traceid` del envelope y el trace real del request HTTP pueden ser distintos.

**2. Headers NATS `traceparent` / `tracestate`** — propagación live de contexto OTel

Fuente: `packages/observability/src/nats-propagation.ts`

- **Productor:** `injectTraceContext(headers)` — usa `propagation.inject` con el contexto activo y el propagator W3C. Escribe `traceparent` (y `tracestate` si existe) en los headers NATS del mensaje.
- **Consumidor:** `extractTraceContext(headers)` — usa `propagation.extract` para recuperar el contexto padre. `startNatsConsumerSpan` crea un nuevo span hijo bajo ese contexto padre.

Este mecanismo permite que los spans del consumidor aparezcan como hijos del span del productor en Jaeger/Tempo, formando trazas distribuidas reales.

### 6.3 Flujo de propagación

```
HTTP Request → api-gateway (span HTTP) → publish NATS
                                           ↓ traceparent en header
                                       channel-service consumer
                                       startNatsConsumerSpan → span hijo
                                           ↓ injectTraceContext
                                       siguiente publish NATS
                                           ↓ traceparent en header
                                       siguiente consumer → span hijo
```

Para cadenas causales (un consumer publica un nuevo evento), el nuevo evento tiene su propio trace iniciado pero mantiene `causation_id` y `correlation_id` en el envelope para reconstruir el flujo completo desde logs.

### 6.4 Claim-check y tracing

El span del productor cubre tanto el path inline como el path claim-check (escritura al Object Store + publish del slim envelope). La duración se registra en `channel.ingress.publish_duration_ms` en ambos paths.
