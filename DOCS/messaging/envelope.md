# Envelope Design

Class: prescriptive
Summary: The canonical bus envelope contract — mandatory fields, subject grammar, causal chain, idempotency, traceability — that every producer on the platform must obey.

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
  "source": "channel-service/accounts/69bea8cd",
  "type": "io.yoizen.messaging.telegram.telegram.received.v1",
  "resource": "tenant/acme/account/69bea8cd/channel/telegram/provider/telegram",
  "time": "2026-04-17T15:40:11.382Z",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "causation_id": "a3c8f1d2-4b5e-7f9a-b2c3-d4e5f6a7b8c9",
  "correlation_id": "a3c8f1d2-4b5e-7f9a-b2c3-d4e5f6a7b8c9",
  "tenant": "acme",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "telegram",
  "provider": "telegram",
  "accountid": "69bea8cd868e860918359cc7",
  "idempotencykey": "sha256:a1b2c3d4...",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 1
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
| `source` | string | Plain identifier of the service that produced the event, plus context. Format: `channel-service/accounts/{id}` or `api-gateway/webhooks` — no `//` prefix, not a URI. Do not invent new formats. |
| `type` | string | Logical type in dot-notation. **Two sanctioned shapes** — see the note below the table. Channel/webhook producers emit the 5-segment `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`; internal producers with no channel and no provider emit the shorter `io.yoizen.<domain>.<area>.<kind>.v1`. |
| `resource` | string | Resource path of the affected resource. |
| `time` | string | ISO 8601 UTC timestamp — when the producer created the envelope. |
| `traceid` | string | OpenTelemetry trace ID (32 hex chars). Extracted from the active span via `activeOrRandomTraceId()` from `@yoizen/observability`. See D9 caveat in §8. |
| `causation_id` | string \| null | ID of the event that caused this one. `null` only for root events. |
| `correlation_id` | string | Groups the entire chain end-to-end. Defaults are producer-specific: `api-gateway` and `createChannelEnvelope()` self-correlate when no value is passed, while shared `buildEventEnvelope()` currently falls back to a fresh UUID unless `correlationId` is passed explicitly. `deriveEnvelope()` copies it unchanged. |
| `tenant` | string | Tenant ID. |
| `producer` | string | Service that publishes. Active producers: `api-gateway` (`WebhookIngressEnvelope`), `channel-service` (`CHANNEL_PRODUCER`), `registry-service` (`REGISTRY_PRODUCER`), `agent-admin-service` (`AGENT_ADMIN_PRODUCER`), `agent-ai-service` (`AGENT_AI_PRODUCER`, since the 2026-08-07 E3 migration — see the note below), `agent-memory-service` (`AGENT_MEMORY_PRODUCER`), `agent-scheduler-service` (`AGENT_SCHEDULER_PRODUCER`), `ai-agent-gateway` (`AI_AGENT_GATEWAY_PRODUCER`, via `execution-client.ts`), plus three services that do **not** use a `@yoizen/shared` constant: `connector-runtime` and `workflow-service` inline the string literal at each publish site, while `provisioning-service` declares a file-local `const PRODUCER` in `apply-events.publisher.ts` and `secret-audit.publisher.ts`. |
| `domain` | string | Business domain. Examples: `messaging`, `automation`, `platform`. |
| `channel` | string | Channel. Examples: `telegram`, `http`, `platform`. |
| `provider` | string | Provider. Examples: `telegram`, `http`, `internal`. |
| `accountid` | string | Logical account ID (not the tenant). **Absent** in the initial `WebhookIngressEnvelope` — `channel-service` resolves it in stage 2. |
| `idempotencykey` | string | `sha256:` + hex(sha256(canonical_json(rawPayload))). Must be deterministic. |
| `transport` | object | See §4. |
| `data` | object | See §5. |

#### Producer constants — `agent-ai-service` moved (E3, 2026-08-07)

`agent-ai-service` used to belong to the inline-literal group above. The E3
subject migration (`PENDIENTES/04-e3-subject.spec.md`, commits 931d16dd +
a3bd82c0) gave it `AGENT_AI_PRODUCER = "agent-ai-service"` and an
`AGENT_AI_SUBJECT_PREFIX` built from it, so its subject token and its
`producer` field are projected from ONE constant and cannot disagree — the same
shape that closed the `agent-memory-service` drift (`DRIFT.md` item 9). It is
used at every bus publish site: `execution.handler.ts` and
`job-executor.service.ts` (`publishStatus`, both branches) and
`heartbeat.service.ts`.

One literal survives, deliberately out of this contract's scope: the ephemeral
runtime-token envelope in `execution.handler.ts` still writes
`producer: "agent-ai-service"` inline. That path publishes on the `rt.`
namespace, which carries no producer subject token at all (see
`DOCS/architecture/runtime-streaming.md` §1.1), so there is nothing for it to
disagree with. The service therefore appears in both the constant list above and
in a literal-string census of the source — that is expected, not drift.

#### The two `type` shapes (E1, ruled 2026-08-04)

Until this ruling §2.1 prescribed the 5-segment form for every producer, and
only the channel/webhook path obeyed it. The code has always carried two shapes,
and both are now sanctioned because they reflect a real semantic distinction:
an event that came through a messaging channel HAS a channel and a provider, and
an internal platform event does not.

| Shape | Who emits it | Verified examples in code |
|---|---|---|
| `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1` | anything carrying a real channel + provider: the api-gateway webhook receipt, `channel-service` ingress/egress, `workflow-service`'s `channelSend`, `agent-memory-service` | `io.yoizen.messaging.telegram.webhook.webhook_received.v1` (`webhook-ingress-type.ts`), `` `io.yoizen.messaging.${channel}.${provider}.${kind}.v1` `` (`envelope.factory.ts`), `io.yoizen.agent-memory.platform.internal.memory_proposed.v1` (`agent-memory-event-type.ts` — internal, but it fills `platform`/`internal` to keep the 5-segment shape) |
| `io.yoizen.<domain>.<area>.<kind>.v1` | internal producers with no channel/provider: runtime streaming, workflow, registry, provisioning, agent-admin, scheduler | `io.yoizen.platform.runtime.token.v1` / `.tool_call.v1` / `.tool_result.v1` / `.cancel.v1` (`RUNTIME_*_EVENT_TYPE` in `packages/shared/src/constants.ts`), `io.yoizen.workflow.execution.completed.v1` (`execution-completed-publisher.activity.ts`), `io.yoizen.registry.service.upserted.v1` (`platform.utils.ts`), `` `io.yoizen.provisioning.${kind}.v1` `` (`secret-audit.publisher.ts`), `io.yoizen.platform.admin.skill_changed.v1` (`agent-admin-service/src/providers/nats.provider.ts`), `io.yoizen.platform.scheduler.heartbeat.v1` (`SCHEDULER_HEARTBEAT_TYPE`) |

Neither form is deprecated and no producer was asked to change: **the `type`
field is a label, the subject is the routing key** (§3), and consumers that
filter by `type` do it verbatim on the value the producer wrote. What IS
forbidden is a third shape — if a new producer has a channel and a provider it
uses the first form, otherwise the second.

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
| `channel` | Channel | `telegram`, `http`, `platform` |
| `provider` | Provider | `telegram`, `http`, `internal`, `webhook` |
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
- `audit.gateway.>` (stream `GATEWAY_AUDIT`) does not use the canonical envelope: `publishGatewayAuditEvent` publishes a `GatewayAuditEvent`, a control-channel format of its own.
- `dlq.<tenant>.>` (stream `DLQ-<tenant>`) is not a *new* format — it re-publishes the **original message bytes verbatim** and puts the dead-letter metadata in headers (`X-Dlq-Reason`, `X-Dlq-Stage`, `X-Dlq-Original-Subject`, `X-Dlq-Stream`, `X-Dlq-Deliveries`/`X-Dlq-Original-Msg-Id`). So a canonical envelope that dies arrives on the DLQ still canonical: `MultiTenantConsumerManager.buildTenantDlqHandler` forwards `msg.data`, and `IngressService.publishWithClaimCheck` forwards the full inlined envelope on a store failure. Subjects are built by `buildDlqMessageSubject`; the separate global `DLQ` stream owns only `dlq.webhook` (`DLQ_STREAM_SUBJECTS`).

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

Five headers may be forwarded. Defined in `WEBHOOK_FORWARDED_HEADERS` (`packages/shared/src/channel.constants.ts`), with `WEBHOOK_FORWARDED_HEADERS_SET` as its O(1) lookup:

```
content-type
x-telegram-bot-api-secret-token
x-http-channel-token
x-request-id
user-agent
```

All other headers must be discarded.

**Verification-secret strip (2026-08-01).** Two of the five exist so that
channel-service can AUTHENTICATE the webhook (`x-telegram-bot-api-secret-token`,
`x-http-channel-token` — `WEBHOOK_SECRET_HEADERS`, same file: exactly the
`signatureHeader` each registered provider declares). They ride the stage-1 envelope to the
verifier, and once the signature check has used them
(`WebhookIngressService.resolveAccount`) they are stripped
(`stripSecretHeaders`), so stage-2 `data.headers` carries only `content-type`,
`x-request-id` and `user-agent`. A secret's job ends at verification; nothing
downstream reads it, and forwarding it would only widen the exposure surface
of every stage-2 consumer and store.

**Placement.** The allowlisted headers are carried under `data`, not under
`transport`: the typed stage-1 shape is `IWebhookIngressData.headers`
(`packages/shared/src/webhook.interfaces.ts`), and `EventTransport`
(`packages/shared/src/interfaces.ts`) declares only `method`, `protocol`,
`agent_id?` and `depth?` — it has no header field at all. A consumer must read
`data.headers`.

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

When a canonical channel envelope serialized by `channel-service` exceeds `CLAIM_CHECK_THRESHOLD_BYTES` (256 KB, `packages/shared/src/channel.constants.ts`), the producer stores the payload in the Object Store and publishes a slim envelope with `payload_inline: false`. Consumers resolve the reference transparently via `MultiTenantConsumerManager.wrapHandler`. Stage-1 `WebhookIngressEnvelope` messages from `api-gateway` do not use claim-check and are published inline. See [`claim-check.md`](claim-check.md) for the full protocol.

**Important:** the threshold is measured on the full serialized envelope, not on `data.payload_bytes` alone. These are two distinct measurements.

---

## 6. Causal Chain

### 6.1 Propagation rules

When a consumer generates a derived event (`deriveEnvelope`, `packages/shared/src/envelope.utils.ts`):

- `correlation_id` — copied **unchanged** from the incoming event.
- `causation_id` — set to the `id` of the incoming event.
- `traceid` — copied from the incoming envelope; the caller should overwrite with the active OTel trace ID when available.
- `transport.depth` — incremented: `new.depth = incoming.depth + 1`.

For root events, defaults depend on the producer helper:

- `api-gateway` stage-1 webhook publish creates an `id` first and sets `correlation_id` to that same `id`.
- `createChannelEnvelope()` self-correlates (`correlation_id = id`) when no `correlationId` is passed, but stage-2 webhook processing passes the incoming correlation instead.
- Shared `buildEventEnvelope()` currently uses a fresh `randomUUID()` when `correlationId` is omitted; callers that need self-correlation must pass it explicitly.
- `causation_id` defaults to `null`.
- `traceid` defaults to `randomUUID()` in `buildEventEnvelope()` if not passed (see D9 caveat in §8).

### 6.2 Example

```
Event A  (webhook ingress — api-gateway)
  id             = evt_A
  causation_id   = null
  correlation_id = evt_A   (api-gateway self-correlates)
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

> **Status: enforcement unified; DLQ/metric still pending**
>
> - `deriveEnvelope` / `buildEventEnvelope` in `@yoizen/shared` use `MAX_DEPTH_BY_CATEGORY` with a strict `>` comparison.
> - `DepthTrackerService` in `agent-ai-service` (`services/agent-ai-service/src/modules/depth-tracker/depth-tracker.service.ts`) does the same as of 2026-07-31 (envelope-drift T02, commit `e0c2e42f`). It previously used its own hardcoded `DEFAULT_MAX_DEPTH = 5` with `>=`, rejecting one level earlier than the shared library and ignoring the per-category limits. The category is a parameter defaulting to `internal_service`, mirroring the shared default. No other service enforces depth locally — every other producer goes through the shared helpers.
> - Still **not implemented**: the documented original behavior on depth exceeded (write to DLQ with reason `depth_exceeded` and emit metric `agent.depth_exceeded`). The two thrower families differ, and neither does it: agent-ai's LOCAL `DepthExceededError extends PermanentError` (`depth-tracker.service.ts`) is routed to the DLQ by the consumer runner, but with no `depth_exceeded` reason header; the SHARED `DepthExceededError` thrown by `deriveEnvelope`/`buildEventEnvelope` extends plain `Error` (`packages/shared/src/envelope.utils.ts`), so it is NAK'd and retried like any other failure rather than dead-lettered. No targeted metric exists on either path.
>
> **Objective design (pending):**
> - On depth exceeded: publish to `DLQ-<tenant>` with `X-Dlq-Reason: depth_exceeded` and emit the corresponding metric.

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

**Causal chain — now queryable via audit-service (from 2026-06-20):**

The lineage backbone is `correlation_id` + `causation_id` + `transport.depth`. These three fields
are persisted top-level (indexed) in the per-tenant `events` store by audit-service. `traceid` is
**not** used for lineage (it is unreliable per D9); it continues to be stored in `metadata.traceid`
for forward reference only.

New audit-service API endpoints:

- `GET /audit/events?correlation_id=<id>` — paginated flat list of all events in a correlation group.
- `GET /audit/events/chain/<correlationId>` — assembled causal-chain tree for the full flow.
- `GET /audit/channel-events/chain/<correlationId>` — assembled causal-chain tree for channel events (Telegram in → reply out). Returns the same `ChainTreeResult` shape. Tenant-scoped (`X-Tenant-Id` header required). Returns 404 when no channel events are found for the correlation_id.

Response shape for the chain endpoint:

```json
{
  "correlation_id": "string",
  "root": { "id": "...", "type": "...", "subject": "...", "depth": 0, "children": [] },
  "node_count": 3,
  "max_depth": 2,
  "truncated": false,
  "synthetic_root": false,
  "orphans": [],
  "extra_roots": []
}
```

Cutover note: events persisted before 2026-06-20 have `null` in `correlation_id`, `causation_id`,
and `depth` (cutover strategy — no backfill). Historical events are accessible via the flat
`?correlation_id=` filter only if they were written after the deploy date.

---

## 9. Two-Stage Ingress Summary

The webhook ingress follows a two-stage process. Full detail is in [`ingress.md`](ingress.md).

**Stage 1 — api-gateway:**

Receives the provider's HTTP POST and immediately publishes a `WebhookIngressEnvelope` (`packages/shared/src/webhook.interfaces.ts`):

```
type:     io.yoizen.messaging.<channel>.webhook.webhook_received.v1
source:   api-gateway/webhooks
subject:  evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1
```

This envelope contains `raw_body_b64` and filtered `headers`, is published inline, and **does not** include `accountid` — the account is not yet resolved.

**Stage 2 — channel-service:**

Consumes the `webhook_received`, verifies the provider signature, resolves the account, and publishes the canonical envelope:

```
type:     io.yoizen.messaging.<channel>.<provider>.<kind>.v1
source:   channel-service/accounts/<accountId>
subject:  evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v1
```

This envelope includes `accountid`, carries `causation_id` from the stage-1 webhook envelope, propagates the original `correlation_id`, increments `transport.depth`, and is what downstream consumers (workflow-service, audit-service, agent-ai-service, etc.) process.

---

## 10. Envelope Examples

### 10.1 Webhook — stage 1 (api-gateway → bus)

```json
{
  "type": "io.yoizen.messaging.telegram.webhook.webhook_received.v1",
  "source": "api-gateway/webhooks",
  "producer": "api-gateway",
  "domain": "messaging",
  "channel": "telegram",
  "provider": "webhook",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 0
  },
  "data": {
    "raw_body_b64": "...",
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
  "source": "channel-service/accounts/69bea8cd868e860918359cc7",
  "producer": "channel-service",
  "domain": "messaging",
  "channel": "telegram",
  "provider": "telegram",
  "accountid": "69bea8cd868e860918359cc7",
  "causation_id": "<stage-1-webhook-envelope-id>",
  "correlation_id": "<stage-1-webhook-correlation-id>",
  "transport": {
    "method": "webhook",
    "protocol": "https",
    "depth": 1
  },
  "data": {
    "headers": {
      "content-type": "application/json",
      "x-request-id": "…",
      "user-agent": "…"
    }
  }
}
```

Subject: `evt.acme.channel-service.messaging.telegram.telegram.received.v1`

> The allowlist sits under `data.headers`, the same home it has on stage 1
> (§4.1). `createChannelEnvelope` emits it there as of 2026-07-31
> (envelope-drift T06); the stage-2 `data` block is typed as
> `IChannelEventData` (`packages/shared/src/channel.interfaces.ts`). Envelopes
> published before that date carry no `headers` key at all — the option had no
> caller, so `transport.headers` never reached the wire.
>
> The forwarding shipped on 2026-07-31 (envelope-drift post-loop item 3): the
> webhook consumer's allowlist — which it also uses for signature verification
> — is threaded through `WebhookIngressService.scheduleIngress` and
> `IngressService.processInbound` to `createChannelEnvelope`, so webhook-derived
> stage-2 envelopes now carry the block shown above. api-gateway is the
> allowlist filter (`WebhookIngressPublisherService.filterHeaders`, which
> consults `WEBHOOK_FORWARDED_HEADERS_SET`) and channel-service lowercases keys
> (`WebhookIngressConsumerService.normalizeHeaders`); since
> 2026-08-01 channel-service additionally strips the verification-secret
> subset (`WEBHOOK_SECRET_HEADERS`, §4.1) after the signature check, so the
> block above can only contain `content-type`, `x-request-id` and
> `user-agent`. Envelopes published before 2026-07-31, and any non-webhook
> flow, carry no `headers` key at all (the option is optional and simply
> omitted); envelopes published between 2026-07-31 and 2026-08-01 may still
> carry the secret headers.

### 10.3 Internal agent (agent-admin-service)

```json
{
  "type": "io.yoizen.platform.admin.agent.published.v1",
  "source": "agent-admin-service/admin/agents/publish",
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
(`AGENT_ADMIN_AGENT_PUBLISHED` over `AGENT_ADMIN_SUBJECT_PREFIX`).

Note the `type` does **not** mirror the subject tokens: it is
`EVENT_TYPES.AGENT_PUBLISHED` in `agent-admin-service`'s `nats.provider.ts`, a
`io.yoizen.platform.admin.…` value that predates the
`io.yoizen.<domain>.<channel>.<provider>.<kind>.v1` convention of §2.1.
The envelope-level fields come from `AGENT_ADMIN_PRODUCER`, `AUTOMATION_DOMAIN`,
`PLATFORM_CHANNEL`, `PLATFORM_PROVIDER` and `DEFAULT_TRANSPORT`.

### 10.4 ai-agent-gateway

```json
{
  "type": "io.yoizen.platform.runtime.execution_requested.v1",
  "source": "<the calling service's own name>",
  "producer": "ai-agent-gateway",
  "resource": "execution/<executionId>",
  "domain": "automation",
  "channel": "platform",
  "provider": "internal",
  "accountid": "ai-agent-gateway",
  "transport": {
    "method": "agent",
    "protocol": "internal",
    "agent_id": "ai-agent-gateway",
    "depth": 0
  }
}
```

Subject: `evt.acme.ai-agent-gateway.automation.platform.internal.execution_requested.v1`
(`AI_AGENT_GATEWAY_EXECUTION_REQUESTED` resolved by `buildPlatformSubject`).

This envelope is built by `ExecutionClient.submitExecution`
(`packages/shared/src/execution-client.ts`), so `producer`/`accountid` are
`AI_AGENT_GATEWAY_PRODUCER` while `source` is the **client's** `serviceName` —
the shared client is embedded in whichever service submits the execution. Here
too the `type` (`io.yoizen.platform.runtime.…`) does not mirror the subject
tokens.

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
- [ ] If the canonical channel envelope serializes above 256 KB: payload stored in Object Store and `payload_inline = false`; stage-1 webhook envelopes stay inline.
- [ ] `source` follows format `channel-service/accounts/<id>` or `api-gateway/webhooks` — no `//` prefix, not a URI — do not invent new formats.
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

The flat `EVENTS` (`events.>`) and `RESULTS` (`results.>`) streams were deprecated here and have since been **removed from the code entirely**: `packages/shared/src/constants.ts` no longer declares them (nor any deprecation marker), and no service publishes or subscribes to `events.>` / `results.>`. The only surviving mentions are a comment in `tracking-ingester-service`'s `classify.ts` and one api-gateway unit fixture. They must not be used in new code.

Two cross-tenant streams are retained on purpose because they are not part of the business flow:

| Stream | Subjects | Constants |
|---|---|---|
| `GATEWAY_AUDIT` | `audit.gateway.>` (published on `audit.gateway.request`) | `GATEWAY_AUDIT_STREAM_NAME`, `GATEWAY_AUDIT_STREAM_SUBJECTS`, `GATEWAY_AUDIT_SUBJECT` |
| `DLQ` | `dlq.webhook` only | `DLQ_STREAM_NAME`, `DLQ_STREAM_SUBJECTS` |

Note that dead-lettering of tenant traffic is **not** on that global `DLQ`: the `dlq.<tenant>.>` namespace belongs to per-tenant `DLQ-<tenant>` streams provisioned by `ensureTenantDlqStream` (`DLQ_TENANT_STREAM_PREFIX`), so the two never overlap.
