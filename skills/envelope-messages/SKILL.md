---
name: envelope-messages
description: >
  Message envelope handling for THIS platform (platform-cluster): the CloudEvents-inspired
  `EventEnvelope` contract adapted for NATS, 8-token subjects, idempotency, the causal
  chain, and the claim-check pattern.
  Trigger: When working with messaging, NATS events, envelopes, subjects, or event transport.
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

> **As-built sources of truth:**
> - `DOCS/messaging/envelope.md` — envelope contract, subjects, idempotency, causal chain, claim-check (canonical reference for the implemented system).
> - `DOCS/messaging/claim-check.md` — full claim-check protocol (producer + consumer).
> - `DOCS/messaging/service-bus.md` — stream topology, subject taxonomy and NATS/JetStream operational reference.
>
> Whenever the documents and the code disagree, the code wins.
> Source of truth for types: `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).

## Activation Contract

Apply this skill when creating, consuming or auditing messages on the NATS event bus, designing subjects, building envelopes, implementing idempotency, or handling the claim-check pattern.

## Hard Rules

- Every message MUST follow the canonical `EventEnvelope` contract defined in `packages/shared/src/interfaces.ts`.
- Envelope IDs are generated with `crypto.randomUUID()`. Do not use ULIDs or any other scheme.
- Format of the `type` field for messaging: `io.yoizen.messaging.<channel>.<provider>.<kind>.v1`. For other domains the second token varies (e.g. `io.yoizen.ai-agent-gateway.automation...`).
- Real bus producers: `api-gateway`, `channel-service`, `registry-service`, `agent-admin-service`, `ai-agent-gateway`. Channel constant: `CHANNEL_PRODUCER = "channel-service"`.
- `source` follows the format `//channel-service/accounts/<accountId>` or `//api-gateway/webhooks`. Do not invent new formats.
- `correlation_id` defaults to the envelope's own `id` when it is not propagated explicitly (`createChannelEnvelope`). Careful: `buildEventEnvelope` in `@yoizen/shared` uses `randomUUID()` as its fallback — pass an explicit `correlationId` on that path. It is copied unchanged by `deriveEnvelope`.
- The `idempotencykey` is `sha256(canonicalJson(payload))` — use `computeIdempotencyKey` from `@yoizen/shared`. Map it to the NATS `Nats-Msg-Id` header when publishing.
- The ingress flow is a two-stage bridge: `api-gateway` publishes a `WebhookIngressEnvelope` (kind `webhook_received`, no `accountid`), then `channel-service` consumes it, verifies the signature, and emits the canonical `ChannelEnvelope` with the real `accountid`.
- Never duplicate subject or envelope logic. Always use the functions from `@yoizen/shared` (`buildChannelSubject`, `buildWebhookIngressSubject`, `computeIdempotencyKey`, `deriveEnvelope`, `isCompliantEnvelope`, etc.).
- Claim check kicks in when `JSON.stringify(envelope).byteLength > CLAIM_CHECK_THRESHOLD_BYTES` (256 KB). Bucket: `PAYLOAD-<tenant>` (TTL 7 days, max 512 MB). URI: `nats://objstore/PAYLOAD-<tenant>/<envelope.id>-payload`. Invariant: `sha256(storedBytes) === computePayloadChecksum(payload)`.
- Canonical per-tenant stream: `INGRESS-<TENANT>` (subjects `evt.<tenant>.>`). Do not use the legacy `EVENTS` or `RESULTS` streams.

## Decision Gates

| Situation | Action |
|---|---|
| I need to generate an event ID | `crypto.randomUUID()` — never a ULID |
| I need the producer name (channel) | `CHANNEL_PRODUCER` = `"channel-service"` |
| I need to build the `type` field (channel) | `io.yoizen.messaging.${channel}.${provider}.${kind}.v1` — see `envelope.factory.ts:98` |
| I need the header allowlist | `WEBHOOK_FORWARDED_HEADERS` in `channel.constants.ts` — 7 entries; the `WEBHOOK_SECRET_HEADERS` subset is stripped before stage two |
| I need to build a channel subject | `buildChannelSubject(tenant, channel, provider, kind)` from `@yoizen/shared` |
| I need to build a generic subject | `buildSubject(params)` from `@yoizen/shared/envelope.utils` |
| I need a root envelope (non-channel) | `buildEventEnvelope(options)` from `@yoizen/shared/envelope.utils` |
| I need a derived envelope | `deriveEnvelope(incoming, overrides)` from `@yoizen/shared/envelope.utils` |
| I need to check that an object is an envelope | `isCompliantEnvelope(value)` from `@yoizen/shared` |
| I need the payload checksum | `computePayloadChecksum(payload)` from `@yoizen/shared` — same as `computeIdempotencyKey` |
| Serialized envelope > 256 KB | Claim check: store `UTF8(canonicalJson(payload))` in the Object Store, publish a slim envelope with `payload_inline: false` |
| I am a consumer and I see `payload_inline: false` | Transparent resolution via `MultiTenantConsumerManager.wrapHandler` — uses `resolveClaimCheckEnvelope` from `packages/database/src/claim-check.ts` |
| Claim-check fails on read | `ClaimCheckResolveError` (not `PermanentError`) → nak → backoff → DLQ after `MAX_DELIVER` |

---

## Critical Patterns

### 1. Envelope Structure (CloudEvents-inspired)

The canonical contract lives in `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`).

Example of an envelope produced by `channel-service` (stage 2 of the ingress):

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

**Mandatory fields** (all required by `isCompliantEnvelope`):

| Field | Type | Notes |
|---|---|---|
| `specversion` | string | Always `"1.0"` |
| `id` | string | UUID v4 (`crypto.randomUUID()`) |
| `source` | string | Service URI. E.g. `//channel-service/accounts/<id>` or `//api-gateway/webhooks` |
| `type` | string | `io.yoizen.messaging.<channel>.<provider>.<kind>.v1` for messaging |
| `resource` | string | Resource path of the affected resource |
| `time` | string | ISO 8601 UTC |
| `traceid` | string | OpenTelemetry traceId (32 hex chars via `activeOrRandomTraceId()`) |
| `causation_id` | string \| null | ID of the causing event. `null` when it is a root |
| `correlation_id` | string | Business flow ID; propagated unchanged. `createChannelEnvelope` and `api-gateway` self-correlate with their own `id`; `buildEventEnvelope` mints a NEW `randomUUID()` when `correlationId` is not passed (`envelope.utils.ts:332`) |
| `tenant` | string | Tenant ID |
| `producer` | string | Publishing service. Real ones: `api-gateway`, `channel-service`, `registry-service`, `agent-admin-service`, `ai-agent-gateway` |
| `domain` | string | `messaging`, `automation`, `platform` |
| `channel` | string | `whatsapp`, `telegram`, `instagram`, `http`, `platform`. The `Channel` type (`channel.interfaces.ts:3`) is `whatsapp \| instagram \| telegram \| http`; `EventEnvelope.channel` is a free `string` (`interfaces.ts:42`) because internal producers use `platform` |
| `provider` | string | `meta`, `telegram`, `http`, `internal`, `webhook`. `ChannelProvider` (`channel.interfaces.ts:4`) is `meta \| telegram \| http` |
| `accountid` | string | Logical account ID (omitted in `WebhookIngressEnvelope`) |
| `idempotencykey` | string | `sha256:<hex>(canonicalJson(payload))` |
| `transport` | EventTransport | See §6 |
| `data` | EventData | See §7 |

Optional pipeline extensions: `callback_url`, `adapter_id`, `enrich_adapter`, `forward_adapter`.

### 2. NATS Subjects

Canonical format (8 tokens):

```
evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>
```

| Token | Description | Examples |
|---|---|---|
| `evt` | Fixed prefix | always `evt` |
| `tenant` | Tenant ID | `acme`, `globex` |
| `producer` | Publishing service | `channel-service`, `api-gateway`, `agent-admin-service` |
| `domain` | Business domain | `messaging`, `automation`, `platform` |
| `channel` | Channel | `whatsapp`, `instagram`, `telegram`, `http`, `platform` |
| `provider` | Provider | `meta`, `telegram`, `http`, `internal`, `webhook` |
| `kind` | Event kind | `webhook_received`, `received`, `sent`, `delivered`, `send`, `execution_requested` |
| `v1` | Version | `v1` |

**Wildcards:**
- `*` — matches exactly one token
- `>` — matches one or more tokens (only at the end)

```
evt.acme.*.messaging.>                                           -- all messaging for tenant acme (any producer)
evt.acme.channel-service.messaging.whatsapp.>                   -- all whatsapp for tenant acme
evt.*.channel-service.messaging.>                               -- all messaging, all tenants
evt.*.api-gateway.messaging.*.webhook.webhook_received.v1       -- all pre-ingress (stage 1)
evt.*.channel-service.messaging.telegram.*.received.v1          -- all received telegram messages
```

Constants in `channel.constants.ts`:
- `CHANNEL_STREAM_SUBJECTS_PATTERN` = `"evt.*.channel-service.messaging.>"`
- `WEBHOOK_INGRESS_SUBJECT_FILTER` = `"evt.*.api-gateway.messaging.*.webhook.webhook_received.v1"`

### 3. Stream Topology

| Stream / Bucket | Type | Subjects | Purpose |
|---|---|---|---|
| `INGRESS-<TENANT>` | JetStream stream | `evt.<tenant>.>` | Canonical per-tenant event bus |
| `DLQ-<tenant>` | JetStream stream | `dlq.<tenant>.>` | Per-tenant dead letters |
| `PAYLOAD-<tenant>` | JetStream Object Store | keys `<event-id>-payload` | Claim-check for large payloads |
| `GATEWAY_AUDIT` | JetStream stream | `audit.gateway.>` | Cross-tenant gateway audit trail |
| `PLATFORM_TENANTS` | JetStream stream | `platform.tenant.>` | Tenant lifecycle |

The legacy `EVENTS` and `RESULTS` streams are deprecated — do not use them in new code.

Canonical helpers (all in `@yoizen/shared`): `getTenantStreamName(tenant)` → `INGRESS-<TENANT>` (upper-cased, `tenant-stream.constants.ts:58-59`), `buildClaimCheckBucket(tenant)` → `PAYLOAD-<tenant>`, `buildDlqStreamName(tenant)` → `DLQ-<tenant>` (both verbatim). Mind the case asymmetry: only the ingress stream upper-cases. A second, verbatim ingress builder was removed on 2026-07-31 (envelope-drift T07) — `getTenantStreamName` is the only one.

### 4. Event Kinds

| Kind | Who publishes | Description |
|---|---|---|
| `webhook_received` | `api-gateway` | Pre-ingress — webhook received before the signature is verified |
| `received` | `channel-service` | Inbound provider message (post-verification) |
| `sent` | `channel-service` | Provider send confirmation |
| `delivered` | `channel-service` | Delivery confirmation |
| `read` | `channel-service` | Read confirmation |
| `failed` | `channel-service` | Send failure |
| `send` | `channel-service` / workflow | Outbound send command |
| `execution_requested` | `ai-agent-gateway` | Agent execution request |
| `config_sync` | `agent-admin-service` | Agent configuration sync |

Canonical `MessageKind` type in `packages/shared/src/channel.interfaces.ts`: `"received" | "sent" | "delivered" | "read" | "failed" | "send"`.

The `webhook_received` kind is exclusive to `WebhookIngressEnvelope` (`api-gateway` pre-ingress).

### 5. Two-Stage Flow (Webhook Bridge)

```
Provider HTTP POST
      │
      ▼
api-gateway  ──── publishWebhook() ────►  INGRESS-<tenant>
  producer: "api-gateway"                  subject: evt.<t>.api-gateway.messaging.<ch>.webhook.webhook_received.v1
  kind: "webhook_received"                 (WebhookIngressEnvelope — no accountid)
  data.raw_body_b64: base64(rawBody)
  data.headers: filtered allowlist
  causation_id: null, correlation_id: <own id>
      │
      ▼
channel-service (WebhookIngressConsumerService)
  filterSubject: WEBHOOK_INGRESS_SUBJECT_FILTER
  durableName: "channel-webhook-ingress"
      │
      ▼
  verifies the HMAC signature, resolves accountId
      │
      ▼
  createChannelEnvelope() → IngressService.publish() ──► INGRESS-<tenant>
    producer: "channel-service"                           subject: evt.<t>.channel-service.messaging.<ch>.<prov>.received.v1
    source: "//channel-service/accounts/<accountId>"      (ChannelEnvelope — with the real accountid)
    causation_id: <webhook envelope id>
    correlation_id: <propagated from the webhook envelope>
    transport.depth: 1
    data.headers: <stage-1 allowlist minus WEBHOOK_SECRET_HEADERS (stripped post-verification)>
```

Key files:
- Stage-1 publisher: `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts`
- Stage-2 consumer: `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts`
- Canonical factory: `services/channel-service/src/domain/envelope.factory.ts` (`createChannelEnvelope`)
- Ingress publish + claim-check: `services/channel-service/src/modules/ingress/ingress.service.ts`

### 6. Transport

The `transport` field (type `EventTransport` in `packages/shared/src/interfaces.ts`):

| Field | Type | Description |
|---|---|---|
| `method` | string | `"webhook"`, `"poll"`, `"stream"`, `"queue_bridge"`, `"agent"` |
| `protocol` | string | `"https"`, `"wss"`, `"amqp"`, `"internal"` |
| `agent_id` | string? | Agent ID (only for `method: "agent"`) |
| `depth` | number? | Causal depth for anti-loop enforcement (see §10) |

The webhook header allowlist (§8) lives under `data.headers`, NOT under `transport` — `IWebhookIngressData.headers` on stage 1 (`webhook.interfaces.ts:18`) and `IChannelEventData.headers` on stage 2 (`channel.interfaces.ts`). `EventTransport` declares exactly the four fields above. Until 2026-07-31 `createChannelEnvelope` spread an undeclared `headers` key into `transport` (envelope-drift T06); that spread had no caller, so `transport.headers` never reached the wire. Since 2026-07-31 the stage-1 allowlist IS forwarded to stage-2 `data.headers` on webhook-derived envelopes (envelope-drift post-loop item 3). Two filtering points: api-gateway applies the allowlist at stage 1; since 2026-08-01 channel-service strips the `WEBHOOK_SECRET_HEADERS` subset after the signature check (§8), so stage 2 carries only the non-secret entries.

### 7. Data Payload

The `data` field (type `EventData` in `packages/shared/src/interfaces.ts`):

| Field | Type | Description |
|---|---|---|
| `received_at` | string | ISO 8601 timestamp; matches `envelope.time` |
| `payload_inline` | boolean | `true` when the payload travels in the message; `false` when claim-check was applied |
| `payload_ref` | string \| null | Object Store URI when `payload_inline = false`. Format: `nats://objstore/PAYLOAD-<tenant>/<event_id>-payload` |
| `payload_bytes` | number | Byte length of the payload's canonical JSON (`canonicalByteLength`) |
| `payload_checksum` | string | `sha256:<hex>` over the exact bytes stored in the Object Store |
| `payload` | object \| null | Raw provider body, untouched. `null` when `payload_inline = false` |

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

An O(1) lookup is available as `WEBHOOK_FORWARDED_HEADERS_SET` (a Set). Every other header must be discarded.

The four signature/token entries form `WEBHOOK_SECRET_HEADERS` (same file):
they exist so channel-service can verify the webhook, and are stripped after
the signature check (since 2026-08-01). Stage-1 `data.headers` may carry all
seven; stage-2 `data.headers` can only carry `content-type`, `x-request-id`
and `user-agent`.

### 9. Idempotency

- `idempotencykey = "sha256:" + hex(sha256(canonicalJson(rawPayload)))`.
- `canonicalJson` sorts keys alphabetically at every level — implemented in `canonicalJson` in `packages/shared/src/envelope.utils.ts`.
- On publish to JetStream it maps to the `Nats-Msg-Id` header. JetStream deduplicates within `duplicate_window` (NATS server default: 2 minutes).
- `computeIdempotencyKey(payload)` and `computePayloadChecksum(payload)` are aliases — same result, different semantic purposes.

**Common violations (avoid):**
- Including `Date.now()`, `randomUUID()` or any other non-deterministic value in the key.
- Using `envelope.id` as the `idempotencykey`.
- Omitting the `sha256:` prefix.

### 10. Claim Check

Triggered when `JSON.stringify(envelope).byteLength > CLAIM_CHECK_THRESHOLD_BYTES` (256 KB). The measurement is taken over the **fully serialized envelope**, not just the payload.

**Central invariant:**

```
Producer stores:   rawBytes = UTF8(canonicalJson(envelope.data.payload))
Consumer verifies: sha256(rawBytes) === envelope.data.payload_checksum
```

Do not re-canonicalize in the consumer — the stored bytes are the canonical result; a parse→stringify round-trip can change key order and break verification.

**Producer** (`services/channel-service/src/modules/ingress/ingress.service.ts`):

```typescript
// 1. Serialize the payload to canonical bytes
const rawBytes = Buffer.from(canonicalJson(envelope.data.payload), "utf8");
// 2. Store it in the Object Store (BEFORE publishing to the bus)
await os.putBlob(`${envelope.id}-payload`, rawBytes);
// 3. Publish the slim envelope
publish({ ...envelope, data: { ...envelope.data, payload_inline: false, payload: null,
  payload_ref: `nats://objstore/PAYLOAD-${tenant}/${envelope.id}-payload` } });
```

Bucket `PAYLOAD-<tenant>`: TTL = 7 days (`CLAIM_CHECK_BUCKET_TTL_NS`), max_bytes = 512 MB (`CLAIM_CHECK_BUCKET_MAX_BYTES`). Created by `IngressService.getClaimCheckBucket` via `buildClaimCheckBucket(tenant)`.

If the Object Store write fails: a message is published to the DLQ (`dlq.<tenant>.<subject>`) with the header `X-Dlq-Reason: claim_check_store_failed`, and the error is then rethrown (the publish to the bus never happens).

**Consumer** (`packages/database/src/claim-check.ts` + `MultiTenantConsumerManager`):

Resolution is transparent to the handler — `wrapHandler` in `MultiTenantConsumerManager` handles it automatically:

1. Byte pre-check: `looksLikeClaimCheck(msg.data)` looks for `'"payload_inline":false'` in the raw bytes (without parsing). Passthrough in 99% of cases.
2. If detected: `JSON.parse` + `isCompliantEnvelope` + `payload_inline === false`.
3. `resolveClaimCheckEnvelope(envelope, getStore)` → fetch blob → `sha256(rawBytes)` verified against `payload_checksum` → `JSON.parse` → inflated envelope.
4. The handler receives a proxied `JsMsg` carrying the inflated envelope. `ack/nak/term` delegate to the original message (via `Proxy`, to preserve NATS's internal `this`).
5. Failure → `ClaimCheckResolveError` (not `PermanentError`) → nak → backoff → DLQ after `MAX_DELIVER`.

Error codes (`ClaimCheckErrorCode`): `ref_missing`, `ref_malformed`, `blob_not_found`, `checksum_mismatch`.

### 11. Causal Chain

- **`causation_id`**: ID of the event that caused this one. `null` when it is a root.
- **`correlation_id`**: business flow ID. Propagated unchanged (`deriveEnvelope`, `envelope.utils.ts:197`). The default is producer-specific: `createChannelEnvelope` and `api-gateway` use the root envelope's own `id`; `buildEventEnvelope` falls back to a fresh `randomUUID()` when `correlationId` is not passed (`envelope.utils.ts:332`).
- **`transport.depth`**: incremental depth for anti-loop enforcement.

`deriveEnvelope` (in `@yoizen/shared`) automatically propagates `causation_id`, `correlation_id`, `traceid` and `depth`. `buildEventEnvelope` creates root envelopes with `depth: 0`.

`MAX_DEPTH_BY_CATEGORY` in `packages/shared/src/envelope.utils.ts`:

| Category (`ProducerCategory`) | MAX_DEPTH |
|---|---|
| `root` | 0 |
| `internal_service` (default) | 5 |
| `internal_agent` | 5 |
| `platform_agent` | 3 |
| `thirdparty_agent` | 2 |

`deriveEnvelope` throws `DepthExceededError` when `newDepth > maxDepth`. The default category is `internal_service`.

Example chain:

```
WebhookIngressEnvelope (api-gateway)
  id = evt_A, causation_id = null, correlation_id = evt_A, depth = 0

ChannelEnvelope received (channel-service)         ← deriveEnvelope
  id = evt_B, causation_id = evt_A, correlation_id = evt_A, depth = 1

Derived event (workflow/agent)                     ← deriveEnvelope
  id = evt_C, causation_id = evt_B, correlation_id = evt_A, depth = 2
```

---

## References

- `DOCS/messaging/envelope.md` — canonical envelope contract, subjects, idempotency, causal chain, claim-check (as-built)
- `DOCS/messaging/claim-check.md` — full claim-check protocol: producer, consumer middleware, Object Store, metrics (as-built)
- `DOCS/messaging/service-bus.md` — stream topology, subject taxonomy and NATS/JetStream operational reference
- `packages/shared/src/interfaces.ts` — `EventEnvelope`, `EventTransport`, `EventData` types
- `packages/shared/src/channel.interfaces.ts` — `Channel`, `ChannelProvider`, `MessageKind`, `ChannelEnvelope`
- `packages/shared/src/channel.constants.ts` — `CHANNEL_PRODUCER`, `WEBHOOK_FORWARDED_HEADERS`, `CLAIM_CHECK_THRESHOLD_BYTES`, `CLAIM_CHECK_BUCKET_TTL_NS`, `CLAIM_CHECK_BUCKET_MAX_BYTES`
- `packages/shared/src/channel.utils.ts` — `buildChannelSubject`, `buildWebhookIngressSubject`, `buildClaimCheckBucket`, `parseChannelSubject`
- `packages/shared/src/envelope.utils.ts` — `computeIdempotencyKey`, `computePayloadChecksum`, `canonicalJson`, `buildSubject`, `deriveEnvelope`, `buildEventEnvelope`, `isCompliantEnvelope`, `MAX_DEPTH_BY_CATEGORY`
- `packages/shared/src/webhook.interfaces.ts` — `WebhookIngressEnvelope`, `IWebhookIngressData`
- `services/channel-service/src/domain/envelope.factory.ts` — `createChannelEnvelope` (canonical producer)
- `services/channel-service/src/modules/ingress/ingress.service.ts` — claim-check logic (producer)
- `packages/database/src/claim-check.ts` — `resolveClaimCheckEnvelope`, `looksLikeClaimCheck`, `ClaimCheckResolveError`, `ClaimCheckErrorCode`
- `references/diseno-mensajes.md` — index of as-built sources of truth
