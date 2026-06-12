# Envelope Design

**Status:** Reference for the implemented system
**Audience:** Dev
**Last updated:** 2026-06-11

> Source of truth for the envelope contract: `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).
> For stream topology and server configuration see [`service-bus.md`](service-bus.md).
> For large-payload offload see [`claim-check.md`](claim-check.md).
> For the two-stage webhook bridge see [`ingress.md`](ingress.md).

---

## 1. Summary

This document defines the canonical contract for events that travel over the bus. It covers:

1. Envelope schema + mandatory fields.
2. Subject design (8-token format) with stream↔subject mapping.
3. Transport fields, webhook header allowlist, and pending transport fields.
4. `EventData` and claim-check trigger.
5. Causal chain — propagation rules and as-built inconsistencies.
6. Idempotency algorithm and common violations.
7. Traceability — three IDs and the D9 caveat.
8. Two-stage ingress summary (see [`ingress.md`](ingress.md) for full detail).
9. Envelope examples (four types).
10. Implementer checklist (12 points).
11. `EVENTS`/`RESULTS` deprecation decision.

---

## 2. Envelope Schema (CloudEvents-inspired)

Every message published to the bus **must** be serialized as the following envelope. Key order is not significant; types are.

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
    "payload": { "...": "raw provider payload, untouched" }
  }
}
```

### 2.1 Mandatory fields

| Field | Type | Semantics |
|-------|------|-----------|
| `specversion` | string | Always `"1.0"` |
| `id` | string | UUID v4 (`crypto.randomUUID()`). Uniqueness of the event — not the deduplication key. |
| `source` | string | URI of the service that produced the event. Format: `//channel-service/accounts/{id}` or `//api-gateway/webhooks`. Do not invent new formats. |
| `type` | string | Logical type in dot-notation. Format: `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`. |
| `resource` | string | Resource path of the affected resource. |
| `time` | string | ISO 8601 UTC timestamp — when the producer created the envelope. |
| `traceid` | string | OpenTelemetry trace ID (32 hex chars). Extracted from the active span via `activeOrRandomTraceId()` from `@yoizen/observability`. See D9 caveat in §8. |
| `causation_id` | string \| null | ID of the event that caused this one. `null` only for root events. |
| `correlation_id` | string | Groups the entire chain end-to-end. Defaults to the envelope's own `id` when not propagated explicitly; copied unchanged by `deriveEnvelope`. |
| `tenant` | string | Tenant ID. |
| `producer` | string | Service that publishes. Active producers: `api-gateway`, `channel-service`, `registry-service`, `agent-admin-service`, `ai-agent-gateway`. |
| `domain` | string | Business domain. Examples: `messaging`, `automation`, `platform`. |
| `channel` | string | Channel. Examples: `whatsapp`, `telegram`, `platform`. |
| `provider` | string | Provider. Examples: `meta`, `telegram`, `internal`. |
| `accountid` | string | Logical account ID (not the tenant). **Absent** in the initial `WebhookIngressEnvelope` — `channel-service` resolves it in stage 2. |
| `idempotencykey` | string | `sha256:` + hex(sha256(canonical_json(rawPayload))). Must be deterministic. |
| `transport` | object | See §4. |
| `data` | object | See §5. |

### 2.2 Allowed internal extensions

The following optional fields extend the envelope without breaking the contract (defined in `packages/shared/src/interfaces.ts`):

- `callback_url` — HTTP URL to POST the result to.
- `adapter_id` — Adapter ID for authenticating the HTTP result delivery.
- `enrich_adapter` — `{ adapterId, endpointId }` for pre-handler enrichment.
- `forward_adapter` — `{ adapterId, endpointId }` for post-handler forwarding.

**Any other extension requires a design review and an update to this document.**

---

## 3. Subject Design (NATS)

Canonical 8-token format:

```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
```

| Token | Semantics | Examples |
|-------|-----------|----------|
| `evt` | Fixed prefix | `evt` |
| `tenant` | Tenant ID (same value as `envelope.tenant`) | `acme`, `globex` |
| `producer` | Publishing service | `channel-service`, `api-gateway`, `agent-admin-service` |
| `domain` | Business domain | `messaging`, `automation`, `platform` |
| `channel` | Channel | `whatsapp`, `telegram`, `platform` |
| `provider` | Provider | `meta`, `telegram`, `internal`, `webhook` |
| `kind` | Operational type | `webhook_received`, `received`, `sent`, `delivered`, `send`, `agent_outbound`, `config_sync`, `job_trigger` |
| `version` | Subject schema version | `v1` |

Useful wildcard subscriptions:

- All messaging events for a tenant: `evt.acme.*.messaging.>`
- Only Telegram received for a tenant: `evt.acme.*.messaging.telegram.*.received.v1`
- Everything a producer publishes: `evt.*.channel-service.>`
- All webhook ingress (stage 1): `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1`

Subject builders: `buildChannelSubject`, `buildWebhookIngressSubject` in `packages/shared/src/channel.utils.ts`.

### 3.1 Stream ↔ subject mapping

- Stream `INGRESS-<tenant>` captures `evt.<tenant>.>` — all tenant events.
- Subjects `dlq.<tenant>.>` and `audit.gateway.>` do not use the canonical envelope — they are control channels with their own formats.

---

## 4. Transport

Implemented fields in `EventTransport` (`packages/shared/src/interfaces.ts`):

```typescript
interface EventTransport {
  method: "webhook" | "poll" | "stream" | "queue_bridge" | "agent";
  protocol: "https" | "wss" | "amqp" | "internal";
  agent_id?: string;
  depth?: number;
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `method` | Yes | How the event reached the producer. |
| `protocol` | Yes | Sub-protocol. |
| `depth` | Recommended | Causal depth (see §6). `0` for root events. |
| `agent_id` | No | Agent ID (when `method: "agent"`). |

### 4.1 Webhook header allowlist (D8)

Six headers may be copied to `transport.headers`. Defined in `WEBHOOK_FORWARDED_HEADERS`, `packages/shared/src/channel.constants.ts` (line ~55):

```
content-type
x-hub-signature-256
x-hub-signature
x-telegram-bot-api-secret-token
x-request-id
user-agent
```

All other headers must be discarded.

### 4.2 Pending transport fields

> **Status: pending — not implemented**
>
> The following fields were in the original design but are not present in `EventTransport`:
>
> - `agent_category` — `internal` | `thirdparty` | `platform`
> - `confidence` — agent score, `[0, 1]`
> - `tool_chain` — list of tools used by the agent
> - `vendor` — AI platform provider

---

## 5. EventData

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

| Field | Type | Description |
|-------|------|-------------|
| `received_at` | string | ISO 8601 — matches `envelope.time`. |
| `payload_inline` | boolean | `true` if `payload` contains the raw data. `false` if claim-check was applied. |
| `payload_ref` | string \| null | URI to the store when `payload_inline = false`. Format: `nats://objstore/PAYLOAD-<tenant>/<event_id>-payload`. |
| `payload_bytes` | number | Byte length of the canonical JSON of the payload (not the full envelope). |
| `payload_checksum` | string | `sha256:` + hex(sha256 over the exact stored bytes). |
| `payload` | object \| null | Raw provider payload, untouched. `null` when `payload_inline = false`. |

### 5.1 Claim-check trigger (payloads > 256 KB)

When the serialized envelope exceeds `CLAIM_CHECK_THRESHOLD_BYTES` (256 KB, `packages/shared/src/channel.constants.ts`), the producer stores the payload in the Object Store and publishes a slim envelope with `payload_inline: false`. Consumers resolve the reference transparently via `MultiTenantConsumerManager.wrapHandler`. See [`claim-check.md`](claim-check.md) for the full protocol.

**Important:** the threshold is measured on the full serialized envelope, not on `data.payload_bytes` alone. These are two distinct measurements.

---

## 6. Causal Chain

### 6.1 Propagation rules

When a consumer generates a derived event (`deriveEnvelope`, `packages/shared/src/envelope.utils.ts`):

- `correlation_id` — copied **unchanged** from the incoming event.
- `causation_id` — set to the `id` of the incoming event.
- `traceid` — copied from the incoming envelope; the caller should overwrite with the active OTel trace ID when available.
- `transport.depth` — incremented: `new.depth = incoming.depth + 1`.

For root events (`buildEventEnvelope`):

- `correlation_id` defaults to the envelope's own `id` if not passed explicitly.
- `causation_id` defaults to `null`.
- `traceid` defaults to `randomUUID()` if not passed (see D9 caveat in §8).

### 6.2 Example

```
Event A  (webhook ingress — api-gateway)
  id             = evt_A
  causation_id   = null
  correlation_id = evt_A   (defaults to own id)
  transport.depth = 0
    ↓  (channel-service publishes canonical envelope)
Event B  (channel-service — canonical)
  id             = evt_B
  causation_id   = evt_A
  correlation_id = evt_A   (copied from incoming)
  transport.depth = 1
    ↓  (workflow-service generates response event)
Event C  (workflow completion)
  id             = evt_C
  causation_id   = evt_B
  correlation_id = evt_A   (copied unchanged)
  transport.depth = 2
```

### 6.3 Anti-loop depth (D12)

`MAX_DEPTH_BY_CATEGORY` in `packages/shared/src/envelope.utils.ts`:

| Category (`ProducerCategory`) | MAX_DEPTH |
|-------------------------------|-----------|
| `root` (external provider) | 0 |
| `internal_service` | 5 |
| `internal_agent` | 5 |
| `platform_agent` | 3 |
| `thirdparty_agent` | 2 |

`deriveEnvelope` and `buildEventEnvelope` throw `DepthExceededError` when `newDepth > maxDepth`.

> **Status: partial implementation — inconsistent behavior**
>
> - `deriveEnvelope` / `buildEventEnvelope` in `@yoizen/shared` use `MAX_DEPTH_BY_CATEGORY` correctly (strict `>` comparison).
> - `DepthTrackerService` in `agent-ai-service` (`services/agent-ai-service/src/modules/depth-tracker/depth-tracker.service.ts`) uses its own hardcoded `DEFAULT_MAX_DEPTH = 5` and rejects when `depth >= DEFAULT_MAX_DEPTH` — a `>=` comparison, not `>`. This means it rejects one level earlier than the shared library.
> - The documented original behavior (on depth exceeded: write to DLQ with reason `depth_exceeded` and emit metric `agent.depth_exceeded`) is **not implemented**. Errors are thrown as exceptions without automatic DLQ routing or metric emission.
>
> **Objective design (pending):**
> - Unify enforcement using `MAX_DEPTH_BY_CATEGORY` across all services.
> - On depth exceeded: publish to `DLQ-<tenant>` with `X-Dlq-Reason: depth_exceeded` and emit the corresponding metric, instead of throwing an exception that may lose the message.

---

## 7. Idempotency

- `idempotencykey = "sha256:" + hex(sha256(canonical_json(rawPayload)))`.
- `canonical_json` sorts keys alphabetically at all levels. Implemented in `canonicalJson` in `packages/shared/src/envelope.utils.ts`.
- At publish time, maps to the `Nats-Msg-Id` NATS header (or the SDK's `msgID`). JetStream deduplicates within the `duplicate_window`, which is **not explicitly configured** — the NATS server default (2 minutes) applies.

**Common violations (avoid):**

- Including `Date.now()`, `randomUUID()`, or other non-deterministic values in the key.
- Using `envelope.id` as the `idempotencykey` — that is event uniqueness, not payload deduplication.
- Omitting the `sha256:` prefix.

---

## 8. Traceability

Three IDs are maintained throughout the event chain:

- `envelope.traceid` — OpenTelemetry trace ID (32 hex chars).
- `envelope.correlation_id` — business flow / conversation ID.
- `envelope.causation_id` — ID of the immediately preceding event.

**D9 caveat — `traceid` fallback:**

- `createChannelEnvelope` (channel-service) and api-gateway code use `activeOrRandomTraceId()` from `@yoizen/observability`, which extracts the trace ID from the active OTel span.
- `buildEventEnvelope` in `@yoizen/shared` falls back to `randomUUID()` when `traceid` is not passed explicitly. This fallback produces a UUID (format `8-4-4-4-12`) instead of a valid OTel trace ID (32 hex chars). Callers must pass the active trace ID explicitly to avoid this.
- `deriveEnvelope` copies `traceid` from the incoming envelope; the caller should overwrite with the active span's trace ID when appropriate.

In addition, the W3C `traceparent` header is injected into NATS message headers so consumers can resume the OTel span without parsing the body.

---

## 9. Two-Stage Ingress Summary

The webhook ingress follows a two-stage process. Full detail is in [`ingress.md`](ingress.md).

**Stage 1 — api-gateway:**

Receives the provider's HTTP POST and immediately publishes a `WebhookIngressEnvelope` (`packages/shared/src/webhook.interfaces.ts`):

```
type:     io.yoizen.messaging.<channel>.webhook.webhook_received.v1
source:   //api-gateway/webhooks
subject:  evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1
```

This envelope contains `raw_body_b64` and filtered `headers`, but **does not** include `accountid` — the account is not yet resolved.

**Stage 2 — channel-service:**

Consumes the `webhook_received`, verifies the provider signature, resolves the account, and publishes the canonical envelope:

```
type:     io.yoizen.messaging.<channel>.<provider>.<kind>.v1
source:   //channel-service/accounts/<accountId>
subject:  evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v1
```

This envelope includes `accountid` and is what downstream consumers (workflow-service, audit-service, agent-ai-service, etc.) process.

---

## 10. Envelope Examples

### 10.1 Webhook — stage 1 (api-gateway → bus)

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

Note: `accountid` is absent — `WebhookIngressEnvelope` is typed as `Omit<EventEnvelope, "accountid">`.

### 10.2 Webhook — stage 2 (channel-service → bus, canonical envelope)

```json
{
  "type": "io.yoizen.messaging.telegram.telegram.received.v1",
  "source": "//channel-service/accounts/69bea8cd868e860918359cc7",
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

### 10.3 Internal agent (agent-admin-service)

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

## 11. Implementer Checklist

Before publishing any message to the bus:

- [ ] Envelope includes all mandatory fields from §2.1.
- [ ] `idempotencykey` uses `sha256:canonical(rawPayload)` (§7).
- [ ] `traceid` comes from the active span via `activeOrRandomTraceId()` (§8).
- [ ] If a derived event: `causation_id` points to the incoming event's `id` and `correlation_id` is copied unchanged.
- [ ] `transport.depth` was incremented if applicable (use `deriveEnvelope` from `@yoizen/shared`).
- [ ] Subject follows the 8-token format from §3.
- [ ] Publish sets `Nats-Msg-Id` with `idempotencykey`.
- [ ] Publish injects `traceparent` via `injectTraceContext(headers)`.
- [ ] If `payload_bytes > 256 KB`: payload stored in Object Store and `payload_inline = false`.
- [ ] `source` follows format `//channel-service/accounts/<id>` or `//api-gateway/webhooks` — do not invent new formats.
- [ ] `accountid` is set for all events except the initial `WebhookIngressEnvelope`.
- [ ] Any new extension field was reviewed and added to `packages/shared/src/interfaces.ts` and this document.

---

## 12. Stream Taxonomy — Decision (D13)

The **only canonical taxonomy** for domain events is:

| Element | Canonical value |
|---------|----------------|
| Stream | `INGRESS-<TENANT_IN_UPPERCASE>` |
| Subject filter | `evt.<tenant>.>` (8 tokens, see §3) |
| Object Store | `PAYLOAD-<tenant>` |

The flat `EVENTS` (`events.>`) and `RESULTS` (`results.>`) streams are **deprecated** and marked in `packages/shared/src/constants.ts`. They must not be used in new code.

Platform monitoring and audit streams that use shared streams (`GATEWAY_AUDIT`, `DLQ`) are retained because they are cross-tenant by design and are not part of the business flow.
