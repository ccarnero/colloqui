# Observability

Class: descriptive
Summary: The as-built observability stack: OTel tracing, the metric names each service emits, dashboards, and the implemented Prometheus alerts.

**Status:** Operational reference — system implemented
**Audience:** Infra + Dev
**Last updated:** 2026-06-11

> Operational reference as-built: `DOCS/messaging/service-bus.md`

---

## 1. Summary

This document describes the observability standards for the messaging system. For each area
it distinguishes the **current state** (metrics, logs, and alerts that are actually emitted)
from the **target design** (planned but not yet implemented). All metric names documented
here are what the code actually emits; names from the original design draft did not match the
implementation.

---

## 2. Metrics

### 2.1 Ingress Pipeline (channel-service)

Source: `services/channel-service/src/modules/ingress/ingress.metrics.ts`

| Metric | Tags | Type | Description |
|---|---|---|---|
| `channel.webhook.requests` | `channel`, `tenant` | counter | Total webhook requests received |
| `channel.webhook.verification_failures` | `channel`, `tenant` | counter | HMAC / token verification failures |
| `channel.ingress.messages_received` | `channel`, `tenant` | counter | Inbound messages parsed from the webhook |
| `channel.ingress.messages_published` | `channel`, `tenant` | counter | Messages successfully published to JetStream |
| `channel.ingress.publish_failures` | `channel`, `tenant` | counter | Failures publishing to JetStream |
| `channel.ingress.publish_duration_ms` | `channel`, `tenant` | histogram | Publish duration in ms (recorded on both the inline and claim-check paths) |
| `channel.ingress.claim_check_count` | `channel`, `tenant` | counter | Messages that exceeded the threshold and used claim-check |
| `channel.ingress.claimcheck.stored` | `tenant` | counter | Payloads successfully written to the Object Store |
| `channel.ingress.claimcheck.store_failed` | `tenant` | counter | Failures writing to the Object Store |

**Ingress metrics from the original design that are not implemented:**

> **Status: pending — not implemented**
> `ingress.verified`, `ingress.validation_failed`, `ingress.rate_limited`,
> `ingress.payload_bytes`, `ingress.claimcheck.inline`, `ingress.claimcheck.store_latency_ms`.

### 2.2 Egress Pipeline (channel-service)

Source: `services/channel-service/src/modules/egress/egress.metrics.ts`

| Metric | Tags | Type | Description |
|---|---|---|---|
| `channel.egress.messages_sent` | — | counter | Outbound messages sent via the provider API |
| `channel.egress.send_failures` | — | counter | Errors sending outbound messages |
| `channel.egress.send_duration_ms` | — | histogram | Outbound send duration in ms |

`egress.shadow_publish_ok` from the original design **is not implemented**.

### 2.3 Shared Consumer (observability package)

Source: `packages/observability/src/nats-consumer-metrics.ts`

Emitted by `NatsConsumerRunner` / `MultiTenantConsumerManager`. The `durable` label identifies
the consumer.

| Metric | Labels | Type | Description |
|---|---|---|---|
| `nats.consumer.messages.processed` | `durable`, `result` | counter | Total messages processed; `result` ∈ `ack \| nak \| term` |
| `nats.consumer.processing.duration` | `durable` | histogram | End-to-end handler latency in ms |
| `nats.consumer.in_flight` | `durable` | up/down counter | Messages in flight; increments on dispatch, decrements on ack/nak/term |
| `nats.consumer.claimcheck.resolved` | `durable` | counter | Claim-check envelopes resolved successfully |
| `nats.consumer.claimcheck.resolve_failed` | `durable`, `code` | counter | Resolution failures; `code` ∈ `ref_missing \| ref_malformed \| blob_not_found \| checksum_mismatch` |

In Prometheus (via OTLP → collector pipeline) the names appear as:

```
nats_consumer_messages_processed_total{durable, result}
nats_consumer_processing_duration_milliseconds_bucket{durable, le}
nats_consumer_in_flight{durable}
```

**Consumer metrics from the original design that are not implemented:**

> **Status: pending — not implemented**
> `consumer.claimcheck.resolve_latency_ms`, `consumer.claimcheck.checksum_mismatch` as a
> standalone metric (covered by `nats.consumer.claimcheck.resolve_failed{code="checksum_mismatch"}`).

### 2.4 HTTP Server

Source: `packages/observability/src/http-metrics.ts`

| Metric | Labels | Type | Description |
|---|---|---|---|
| `http.server.request.total` | `method`, `route`, `status_code` | counter | Total HTTP requests received |
| `http.server.request.duration` | `method`, `route`, `status_code` | histogram | Request duration in ms |
| `http.server.active_requests` | `method` | up/down counter | In-flight HTTP requests |

429 rate-limit rejections are visible as `http.server.request.total{status_code="429"}`.
There is no dedicated `ingress.rate_limited` metric.

> **Note:** Prometheus alert expressions reference `http_server_request_total` and
> `http_server_request_duration_milliseconds_bucket` (underscore form, as converted by the
> OTLP → Prometheus pipeline from the dot-separated OTLP names).

### 2.5 Circuit Breaker

Source: `packages/observability/src/circuit-breaker-metrics.ts`

| Metric | Labels | Type | Description |
|---|---|---|---|
| `circuit_breaker.decisions` | `key`, `action`, `status`, `reason` | counter | allow/deny decisions by the circuit breaker |
| `circuit_breaker.transitions` | `key`, `from`, `to` | counter | State transitions (closed/open/half_open) |
| `circuit_breaker.l1_hits` | `key` | counter | Decisions served from the in-process L1 cache (500 ms) |
| `circuit_breaker.redis_errors` | — | counter | Redis errors; each one triggers fallback to the local breaker |
| `circuit_breaker.decide_duration` | — | histogram | End-to-end latency of `canProceed` in ms |

### 2.6 SSE

> **Status: pending — not implemented**

The SSE metrics from the original design (`sse.connections_active`, `sse.events_streamed`,
`sse.events_dropped`) are not implemented.

### 2.7 NATS Infrastructure — Exporter Metrics

NATS infrastructure metrics come from the **NATS Prometheus exporter** (not from application
code). The exporter exposes `gnatsd_*` and JetStream metrics. The original design names
(`nats.stream.bytes`, `nats.objstore.*`) do not exist; the real names are those from the
exporter:

| Exporter Metric | Description |
|---|---|
| `gnatsd_varz_connections` | Active connections |
| `gnatsd_varz_slow_consumers` | Slow consumers |
| `jetstream_server_total_message_bytes` | Total bytes in JetStream |
| `jetstream_server_max_storage` | Configured maximum capacity |
| `jetstream_stream_messages{stream_name}` | Messages per stream (includes DLQ-* streams) |
| `jetstream_consumer_num_pending{consumer_name}` | Pending messages per consumer |
| `jetstream_consumer_num_ack_pending{consumer_name}` | Ack-pending per consumer |

### 2.8 Agent Metrics

> **Status: pending — not implemented**

The agent metrics from the original design (`ingress.agent.events`, `ingress.agent.depth_exceeded`,
`ingress.agent.confidence`, `ingress.agent.auth_failed`, `ingress.agent.authorization_denied`)
are not implemented.

---

## 3. Structured Logging

### 3.1 Implemented Fields

Source: `packages/observability/src/envelope-logging.ts` — `IStructuredLogFields`

Each step in the ingress pipeline logs at minimum:

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

Exact fields extracted: `event_id`, `trace_id`, `causation_id`, `correlation_id`, `tenant`,
`channel`, `provider`, `producer`, `domain`, `idempotency_key`, `depth`, `step`.

### 3.2 Agent Audit Fields

> **Status: pending — not implemented**

The additional agent fields from the original design (`agent_id`, `agent_model`, `confidence`,
`tool_chain`, `agent_vendor`, `api_key_id`, `origin_ip`, `platform_*`) are not present in
`IStructuredLogFields` and are not emitted.

### 3.3 Log Level Table

| Situation | Level | Includes payload |
|---|---|---|
| Webhook received | warn (on failure) / implicit (on success) | No |
| Signature verification failed | warn | No (failure reason only) |
| Invalid payload (not a JSON object) | warn | No |
| No active accounts for tenant | warn | No |
| Successful publish | info (batch summary) | No |
| Individual publish failure | warn | No |
| Claim-check: payload stored | info | No (metadata only: bytes, ref) |
| Claim-check: Object Store write failure | error | Metadata only (event_id, key, error) |
| DLQ publish failure | error | Metadata only |

### 3.4 PII Rule in Logs

**`data.payload` is never logged.** The `envelopeLogFields` function extracts exclusively
metadata fields from the envelope. The raw payload (which may contain phone numbers, names,
and message content) is only accessible directly from the JetStream stream or the Object
Store with appropriate credentials.

---

## 4. Implemented Alerts

Alerts are defined in `infrastructure/base/observability/prometheus/alerts.yaml`.

### 4.1 Group `nats-dlq` — Primary Alerting Surface for Poison-Pill Messages

| Alert | Expression | Severity | Description |
|---|---|---|---|
| `DlqMessageDetected` | `sum by (stream_name) (increase(jetstream_stream_messages{stream_name=~"DLQ-.*"}[1m])) > 0` for 0m | **critical** | New message on any DLQ-* stream. Inspect headers `X-Dlq-Reason / X-Dlq-Stage / X-Dlq-Original-Subject` to identify the cause and tenant. |
| `DlqIngestRateSustained` | `sum by (stream_name) (rate(jetstream_stream_messages{stream_name=~"DLQ-.*"}[5m])) > 0.05` for 10m | **warning** | Repeated permanent failures — likely a broken deploy or misconfigured tenant. |
| `DlqBacklogGrowing` | `deriv(jetstream_stream_messages{stream_name=~"DLQ-.*"}[15m]) > 0` for 30m | **warning** | DLQ backlog growing without being drained; triage and/or manual replay. |

### 4.2 Group `nats-consumer-lag` — Consumer Backpressure

Monitored consumers: **all** JetStream consumers, by default. The matcher is
inverted — there is no allow-list to keep in sync, so a new durable is monitored
the moment it registers. A durable whose lag is by-design is excluded with a
`consumer_name!~"..."` matcher on both expressions, listed here with its reason.
Exclusions today: **none**.

Every literal name used in a `consumer_name` matcher must be a real durable
declared in the code — enforced by guard `G15` in
`scripts/checks/doc-code-guards.sh`.

| Alert | Condition | Severity |
|---|---|---|
| `NatsConsumerPendingHigh` | `jetstream_consumer_num_pending > 500` for 2m | **warning** |
| `NatsConsumerAckPendingHigh` | `jetstream_consumer_num_ack_pending > 200` for 5m | **warning** |

### 4.3 Group `nats` — Infrastructure Health

| Alert | Condition | Severity |
|---|---|---|
| `NatsDown` | `up{job="nats"} == 0` for 1m | **critical** |
| `NatsSlowConsumers` | `gnatsd_varz_slow_consumers > 0` for 5m | **warning** |
| `NatsJetStreamStorageHigh` | `(jetstream_server_total_message_bytes / jetstream_server_max_storage) > 0.8` for 10m | **warning** |
| `NatsHighConnectionCount` | `gnatsd_varz_connections > 1000` for 5m | **warning** |

### 4.4 Group `api-gateway` — HTTP Errors

| Alert | Expression | Severity |
|---|---|---|
| `HighErrorRate` | `sum(rate(http_server_request_total{service_name="api-gateway", status_code=~"5.."}[5m])) / sum(rate(http_server_request_total{service_name="api-gateway"}[5m])) > 0.05` for 5m | **critical** |
| `HighP99Latency` | `histogram_quantile(0.99, sum(rate(http_server_request_duration_milliseconds_bucket{service_name="api-gateway"}[5m])) by (le)) > 5000` for 5m | **warning** |
| `HighRateLimitRate` | `sum(rate(http_server_request_total{service_name="api-gateway", status_code="429"}[5m])) / sum(rate(http_server_request_total{service_name="api-gateway"}[5m])) > 0.20` for 5m | **warning** |

### 4.5 Group `services` — Cross-Service Errors

| Alert | Expression | Severity |
|---|---|---|
| `ServiceHighErrorRate` | `sum(rate(http_server_request_total{status_code=~"5.."}[5m])) by (service_name) / sum(rate(http_server_request_total[5m])) by (service_name) > 0.05` for 5m | **critical** |
| `ServiceHighLatency` | `histogram_quantile(0.99, sum(rate(http_server_request_duration_milliseconds_bucket[5m])) by (le, service_name)) > 5000` for 5m | **warning** |

### 4.6 Group `temporal-postgres` — Temporal Persistence Health

| Alert | Condition | Severity |
|---|---|---|
| `TemporalPostgresDown` | `up{job="cnpg-postgres-temporal"} == 0` for 1m | **critical** |
| `TemporalPostgresReplicationLagHigh` | `cnpg_pg_replication_lag > 10` for 2m | **warning** |
| `TemporalPostgresDeadTuplesHigh` | `cnpg_pg_stat_user_tables_n_dead_tup{relname=~"history_node\|tasks\|executions\|transfer_tasks\|timer_tasks"} > 100000` for 10m | **warning** |
| `TemporalPostgresConnectionsSaturated` | `sum(cnpg_backends_total{job="cnpg-postgres-temporal"}) / max(cnpg_pg_settings_setting{job="cnpg-postgres-temporal", name="max_connections"}) > 0.8` for 5m | **warning** |
| `TemporalPostgresCheckpointSyncSlow` | `rate(cnpg_pg_stat_bgwriter_checkpoint_sync_time{job="cnpg-postgres-temporal"}[5m]) > 1000` for 5m | **warning** |
| `TemporalPostgresWalSizeGrowing` | `cnpg_pg_wal_size_bytes / (1024 * 1024 * 1024) > 10` for 10m | **warning** |
| `TemporalServerErrors` | `sum(rate(temporal_service_errors[5m])) > 0.5` for 5m | **warning** |

### 4.7 Group `temporal-server` — Temporal Server Health

| Alert | Condition | Severity |
|---|---|---|
| `TemporalServerDown` | `up{job="temporal-server"} == 0` for 1m | **critical** |
| `TemporalScheduleToStartHigh` | workflow task schedule-to-start p95 > 5000ms by task_queue for 2m | **warning** |
| `TemporalActivityScheduleToStartHigh` | activity schedule-to-start p95 > 5000ms by task_queue for 2m | **warning** |
| `TemporalWorkflowTimeoutsSpike` | `sum(rate(temporal_workflow_timeout_total[2m])) > 0.5` for 2m | **critical** |
| `TemporalPersistenceLatencyHigh` | persistence operation p99 > 100ms by operation for 2m | **warning** |
| `TemporalStickyCacheHitLow` | sticky cache hit ratio < 70% for 10m | **warning** |

> **Note:** `TemporalHistoryShardImbalance` was removed from alerts. The 4-role HA deployment
> (`temporal-history`, `-matching`, `-worker` as separate Deployments) no longer exists in
> developer mode. The single `temporalio/auto-setup` pod has no applicable shard imbalance.

### 4.8 Alerts from the Original Design That Are Not Implemented

> **Status: pending — not implemented**

Alerts based on application metrics invented in the original design
(`verification_failed rate > 20%`, `claimcheck.store_failed > 0`,
`claimcheck.checksum_mismatch`, `agent.depth_exceeded`, `agent.auth_failed`) have no
corresponding Prometheus expressions because those metrics do not exist under those names.
Their real equivalents:

- Verification failures: `channel.webhook.verification_failures` (available as OTLP — no
  Prometheus alert configured yet)
- Checksum mismatch: visible in logs and via
  `nats.consumer.claimcheck.resolve_failed{code="checksum_mismatch"}`
- Store failures: `channel.ingress.claimcheck.store_failed` → DLQ → fires `DlqMessageDetected`
  with `X-Dlq-Reason: claim_check_store_failed`

---

## 5. Suggested Dashboards

### 5.1 Dashboard: Bus Overview

General bus health. Audience: Infra.

| Panel | Type | Real Metric |
|---|---|---|
| Messages/sec published | Time series | `channel.ingress.messages_published` rate |
| Publish error rate | Time series | `channel.ingress.publish_failures` / `channel.ingress.messages_received` |
| Publish latency (p50, p95, p99) | Time series | `channel.ingress.publish_duration_ms` percentiles |
| DLQ messages by stream | Time series | `jetstream_stream_messages{stream_name=~"DLQ-.*"}` |
| Consumer pending | Bar chart | `jetstream_consumer_num_pending` per consumer |
| JetStream storage | Gauge | `jetstream_server_total_message_bytes / jetstream_server_max_storage` |

### 5.2 Dashboard: Ingress by Provider

Ingress detail by provider. Audience: Dev.

| Panel | Type | Real Metric |
|---|---|---|
| Requests/sec by channel/tenant | Time series | `channel.webhook.requests` rate |
| Failed verifications | Time series | `channel.webhook.verification_failures` by channel/tenant |
| Messages published | Time series | `channel.ingress.messages_published` rate |
| Claim-check ratio | Time series | `channel.ingress.claim_check_count` vs `channel.ingress.messages_published` |
| Object Store failures | Time series | `channel.ingress.claimcheck.store_failed` rate |

### 5.3 Dashboard: Claim-Check Health

Audience: Infra.

| Panel | Type | Real Metric |
|---|---|---|
| Stores/sec | Time series | `channel.ingress.claimcheck.stored` rate |
| Store failures | Time series | `channel.ingress.claimcheck.store_failed` rate |
| Successful resolutions | Time series | `nats.consumer.claimcheck.resolved` by durable |
| Resolution failures by code | Time series | `nats.consumer.claimcheck.resolve_failed` by durable, code |

### 5.4 Dashboard: Consumer Lag

Audience: Infra.

| Panel | Type | Real Metric |
|---|---|---|
| Pending per consumer | Time series | `jetstream_consumer_num_pending` |
| Ack-pending | Time series | `jetstream_consumer_num_ack_pending` |
| Messages processed (ack/nak/term) | Time series | `nats.consumer.messages.processed` by durable, result |
| In-flight | Time series | `nats.consumer.in_flight` by durable |

---

## 6. Distributed Tracing

### 6.1 OpenTelemetry — Implemented Configuration

Source: `packages/observability/src/telemetry.ts`

The SDK configures:

- **Propagator:** `W3CTraceContextPropagator` — propagates trace via `traceparent` /
  `tracestate` headers (W3C Trace Context)
- **Context manager:** `AsyncLocalStorageContextManager`
- **Exporters:** OTLP HTTP for traces (`/v1/traces`) and metrics (`/v1/metrics`); endpoint
  configurable via `OTEL_EXPORTER_OTLP_ENDPOINT`

### 6.2 NATS Trace Propagation — Two Distinct Mechanisms

> These two things look similar but are not the same:

**1. `traceid` field in the envelope** — snapshot of the trace ID at publish time

`envelope.traceid` is populated with `activeOrRandomTraceId()`
(`packages/observability/src/envelope-logging.ts`), which returns the active OTEL trace ID
or, if no trace is active, a random 32-char hex UUID. This field is a correlation snapshot
for logs; **it is not live context propagation**.

In the `buildEventEnvelope` path in `packages/shared`, the fallback is `randomUUID()` directly.
This means that if no active span exists when constructing the envelope (e.g. in routes without
HTTP instrumentation), the envelope `traceid` and the real HTTP request trace may differ.

**2. NATS headers `traceparent` / `tracestate`** — live OTel context propagation

Source: `packages/observability/src/nats-propagation.ts`

- **Producer:** `injectTraceContext(headers)` — uses `propagation.inject` with the active
  context and the W3C propagator. Writes `traceparent` (and `tracestate` if present) into
  the NATS message headers.
- **Consumer:** `extractTraceContext(headers)` — uses `propagation.extract` to recover the
  parent context. `startNatsConsumerSpan` creates a new child span under that parent context.

This mechanism allows consumer spans to appear as children of producer spans in Jaeger/Tempo,
forming real distributed traces.

### 6.3 Propagation Flow

```
HTTP Request → api-gateway (HTTP span) → publish NATS
                                           ↓ traceparent in header
                                       channel-service consumer
                                       startNatsConsumerSpan → child span
                                           ↓ injectTraceContext
                                       next NATS publish
                                           ↓ traceparent in header
                                       next consumer → child span
```

For causal chains (a consumer publishes a new event), the new event starts its own trace but
preserves `causation_id` and `correlation_id` in the envelope to reconstruct the full flow
from logs.

### 6.4 Claim-Check and Tracing

The producer span covers both the inline path and the claim-check path (Object Store write
+ slim envelope publish). Duration is recorded in `channel.ingress.publish_duration_ms` on
both paths.
