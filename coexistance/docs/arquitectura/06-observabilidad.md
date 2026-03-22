# 06 — Observabilidad

**Estado:** Borrador para revisión
**Audiencia:** Infra + Dev
**Fecha:** 2026-03-21

---

## 1. Resumen

Este documento define los estándares de observabilidad del bus: métricas mínimas, formato de logging, alertas recomendadas, y dashboards sugeridos. Nada debe fallar silenciosamente.

---

## 2. Métricas

### 2.1 Ingress pipeline

| Métrica | Tags | Tipo | Descripción |
|---------|------|------|-------------|
| `ingress.received` | tenant, channel, provider | counter | Requests recibidos (antes de validación) |
| `ingress.verified` | tenant, channel, provider | counter | Requests que pasaron verificación de firma |
| `ingress.verification_failed` | tenant, channel, provider | counter | Firmas inválidas o ausentes |
| `ingress.validation_failed` | tenant, channel, provider | counter | Payloads con estructura inválida |
| `ingress.published` | tenant, channel, provider | counter | Eventos publicados exitosamente al bus |
| `ingress.publish_failed` | tenant, channel, provider | counter | Fallos en publish a JetStream |
| `ingress.publish_latency_ms` | tenant, channel, provider | histogram | Latencia de publish (desde build envelope hasta ack) |
| `ingress.payload_bytes` | tenant, channel, provider | histogram | Tamaño del payload por evento |
| `ingress.rate_limited` | tenant, channel, provider | counter | Eventos rechazados por rate limit |

### 2.2 Claim check

| Métrica | Tags | Tipo | Descripción |
|---------|------|------|-------------|
| `ingress.claimcheck.stored` | tenant, channel, provider | counter | Payloads guardados en Object Store |
| `ingress.claimcheck.inline` | tenant, channel, provider | counter | Payloads que viajaron inline |
| `ingress.claimcheck.store_failed` | tenant, channel, provider | counter | Fallos al escribir en Object Store |
| `ingress.claimcheck.store_latency_ms` | tenant | histogram | Latencia de escritura al Object Store |
| `consumer.claimcheck.resolved` | tenant, consumer_id | counter | Payloads resueltos exitosamente por referencia |
| `consumer.claimcheck.resolve_failed` | tenant, consumer_id | counter | Fallos al resolver referencia |
| `consumer.claimcheck.resolve_latency_ms` | tenant, consumer_id | histogram | Latencia de lectura desde Object Store |
| `consumer.claimcheck.checksum_mismatch` | tenant, consumer_id | counter | Checksums que no coinciden |

### 2.3 Agentes

| Métrica | Tags | Tipo | Descripción |
|---------|------|------|-------------|
| `ingress.agent.events` | tenant, agent_id, kind | counter | Eventos publicados por agentes |
| `ingress.agent.depth_exceeded` | tenant, agent_id | counter | Eventos rechazados por depth limit |
| `ingress.agent.confidence` | tenant, agent_id | histogram | Distribución de confidence scores |
| `ingress.agent.auth_failed` | tenant, agent_category | counter | Fallos de autenticación de agentes |
| `ingress.agent.authorization_denied` | tenant, agent_id | counter | Fallos de autorización (solo terceros) |

### 2.4 Infraestructura del bus

| Métrica | Tags | Tipo | Descripción |
|---------|------|------|-------------|
| `nats.stream.bytes` | tenant, stream_name | gauge | Uso de storage por stream |
| `nats.stream.messages` | tenant, stream_name | gauge | Cantidad de mensajes por stream |
| `nats.stream.consumers` | tenant, stream_name | gauge | Consumers activos por stream |
| `nats.objstore.bytes` | tenant, bucket_name | gauge | Uso de storage por bucket de Object Store |
| `nats.objstore.objects` | tenant, bucket_name | gauge | Cantidad de objetos por bucket |
| `nats.cluster.nodes_healthy` | — | gauge | Nodos saludables en el cluster |

---

## 3. Logging

### 3.1 Campos obligatorios

Cada paso en el pipeline de ingress loguea como mínimo:

```json
{
  "level": "info",
  "timestamp": "2026-03-21T15:40:11.382Z",
  "event_id": "01JQXXXX",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": null,
  "correlation_id": "conv_acme_wa_5551234_20260321",
  "tenant": "acme",
  "channel": "whatsapp",
  "provider": "meta",
  "step": "publish",
  "message": "Event published successfully"
}
```

### 3.2 Campos adicionales para agentes

Cuando `transport.method: "agent"`, se agrega:

```json
{
  "agent_id": "cs-agent-v2",
  "agent_category": "internal",
  "depth": 1,
  "confidence": 0.92,
  "tool_chain": ["read_conversation", "classify_intent", "generate_reply"]
}
```

Para agentes de terceros:

```json
{
  "agent_id": "partner-acme-sales-bot",
  "agent_category": "thirdparty",
  "agent_vendor": "partner-xyz",
  "api_key_id": "key_abc123",
  "origin_ip": "203.0.113.42",
  "depth": 1
}
```

### 3.3 Niveles de log

| Situación | Nivel | Incluye payload |
|-----------|-------|-----------------|
| Evento recibido | debug | No |
| Verificación exitosa | debug | No |
| Verificación fallida | warn | No (solo razón del fallo) |
| Validación fallida | warn | No (solo razón del fallo) |
| Publish exitoso | info | No |
| Publish fallido | error | Envelope completo MENOS `data.payload` (evitar PII) |
| Rate limited | warn | No |
| Depth exceeded | warn | Envelope completo MENOS `data.payload` |
| Object Store write failed | error | Solo metadata (event_id, tenant, bytes) |
| Checksum mismatch | error | event_id, ref, expected checksum, actual checksum |

### 3.4 Regla de PII en logs

**Nunca loguear `data.payload`.** El raw payload puede contener teléfonos, nombres, y contenido de mensajes. Los logs deben contener suficiente contexto para diagnosticar sin exponer datos personales.

Si es absolutamente necesario inspeccionar el payload para debugging, hacerlo via acceso directo al stream o Object Store con las credenciales apropiadas — nunca via logs.

---

## 4. Alertas

### 4.1 Alertas críticas

| Condición | Severidad | Acción |
|-----------|-----------|--------|
| `verification_failed` rate > 20% por 5 min | **critical** | Posible ataque o rotación de key del provider. Verificar configuración de secrets |
| `claimcheck.store_failed` > 0 sostenido | **critical** | Object Store no disponible. Verificar estado del cluster NATS |
| `claimcheck.checksum_mismatch` > 0 | **critical** | Posible corrupción de datos. Investigar inmediatamente |
| `nats.cluster.nodes_healthy` < quorum | **critical** | Cluster degradado. Riesgo de pérdida de datos si cae otro nodo |

### 4.2 Alertas de warning

| Condición | Severidad | Acción |
|-----------|-----------|--------|
| `publish_failed` rate > 5% por 5 min | **warning** | Revisar conectividad con NATS y estado del stream |
| `nats.stream.bytes` > 80% de `max_bytes` | **warning** | Revisar retención o elevar tier del tenant |
| `nats.objstore.bytes` > 80% de max bucket | **warning** | Revisar retención del bucket |
| `agent.depth_exceeded` count > 0 | **warning** | Posible loop entre agentes. Revisar cadena causal |
| `agent.auth_failed` rate > 10% por 5 min | **warning** | Posible intento de acceso no autorizado |

### 4.3 Alertas informativas

| Condición | Severidad | Acción |
|-----------|-----------|--------|
| `rate_limited` count > 0 sostenido | **info** | Revisar tier del tenant o rate limit del agente |
| `agent.confidence` p50 < 0.5 sostenido | **info** | Revisar calidad del modelo del agente |
| `ingress.payload_bytes` p99 > 200 KB | **info** | Monitorear tendencia. Puede requerir ajuste del umbral de claim check |

---

## 5. Dashboards sugeridos

### 5.1 Dashboard: Bus Overview

Vista general de salud del bus. Audiencia: Infra.

| Panel | Tipo | Datos |
|-------|------|-------|
| Eventos/seg (total) | Time series | `ingress.published` rate |
| Eventos/seg por tenant | Time series (stacked) | `ingress.published` rate by tenant |
| Tasa de error | Time series | `publish_failed` / `received` ratio |
| Latencia de publish (p50, p95, p99) | Time series | `publish_latency_ms` percentiles |
| Storage por tenant | Bar chart | `nats.stream.bytes` by tenant |
| Nodos del cluster | Status | `nats.cluster.nodes_healthy` |

### 5.2 Dashboard: Ingress por Provider

Detalle de ingress por provider. Audiencia: Dev.

| Panel | Tipo | Datos |
|-------|------|-------|
| Eventos/seg por provider | Time series (stacked) | `ingress.published` rate by provider |
| Verificaciones fallidas | Time series | `verification_failed` by provider |
| Validaciones fallidas | Time series | `validation_failed` by provider |
| Tamaño de payload (distribución) | Histogram | `payload_bytes` by provider |
| Claim check ratio | Pie chart | `claimcheck.stored` vs `claimcheck.inline` |

### 5.3 Dashboard: Agentes

Comportamiento de agentes. Audiencia: Dev.

| Panel | Tipo | Datos |
|-------|------|-------|
| Eventos de agentes/seg | Time series | `agent.events` rate by agent_id |
| Distribución de confidence | Histogram | `agent.confidence` by agent_id |
| Depth exceeded | Time series | `agent.depth_exceeded` by agent_id |
| Auth failures | Time series | `agent.auth_failed` by agent_category |
| Authorization denied (terceros) | Time series | `agent.authorization_denied` by agent_id |

### 5.4 Dashboard: Claim Check

Health del Object Store. Audiencia: Infra.

| Panel | Tipo | Datos |
|-------|------|-------|
| Writes/seg | Time series | `claimcheck.stored` rate |
| Write failures | Time series | `claimcheck.store_failed` rate |
| Write latency (p50, p95) | Time series | `claimcheck.store_latency_ms` |
| Resolve failures | Time series | `claimcheck.resolve_failed` rate |
| Resolve latency (p50, p95) | Time series | `claimcheck.resolve_latency_ms` |
| Checksum mismatches | Counter | `claimcheck.checksum_mismatch` |
| Storage por bucket | Bar chart | `nats.objstore.bytes` by tenant |

---

## 6. Tracing

### 6.1 OpenTelemetry

Cada evento lleva un `traceid` de OpenTelemetry. Este ID permite correlacionar:

- El request HTTP entrante (webhook o API call)
- El procesamiento en el ingress service
- El publish al bus
- La resolución de claim check (si aplica)
- El procesamiento en cada consumer

### 6.2 Propagación

```
Provider → Ingress → JetStream → Consumer A → Acción
                                → Consumer B → Acción
```

El `traceid` se propaga en el envelope del evento. Cada consumer crea un nuevo span hijo bajo el mismo trace.

Para cadenas causales (agente consume y publica), el nuevo evento tiene su propio `traceid` pero mantiene `causation_id` y `correlation_id` para reconstruir el flujo completo.
