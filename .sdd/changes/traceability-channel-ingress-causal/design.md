# Design — `traceability-channel-ingress-causal`

## Problem Statement

`WebhookIngressConsumerService.processMessage` holds the `WebhookIngressEnvelope` (stage-1 envelope
from api-gateway) but discards its causal fields when it calls `processEnvelope`. Every downstream
call through to `createChannelEnvelope` therefore omits `correlationId`, `causationId`, and `depth`,
so the factory defaults to a fresh `correlation_id` (own `id`), `causation_id = null`, and `depth =
0`. The canonical `ChannelEnvelope` (stage-2) is severed from the webhook envelope in the
audit chain; `GET /audit/events/chain/:correlationId` never returns both events.

## Solution

Thread three optional causal fields through the existing call chain. No new types, no new files, no
service boundaries changed. `createChannelEnvelope` already accepts `correlationId`, `causationId`,
and `depth`; the sole fix is ensuring the values are extracted at the consumer and forwarded all the
way to the factory call.

### Causal field values

| Field | Source |
|---|---|
| `correlationId` | `webhookEnvelope.correlation_id` |
| `causationId` | `webhookEnvelope.id` |
| `depth` | `(webhookEnvelope.transport?.depth ?? 0) + 1` |

### Data Flow (ASCII)

```
WebhookIngressConsumerService.processMessage          (L115)
  │  extracts from WebhookIngressEnvelope:
  │    correlationId = envelope.correlation_id
  │    causationId   = envelope.id
  │    depth         = (envelope.transport?.depth ?? 0) + 1
  │
  ▼
WebhookIngressService.processEnvelope(                (L70)
  channel, tenantId, rawBody, headers, parsedBody,
+ causal?: { correlationId?, causationId?, depth? }
)
  │  passes causal to ▼
  ▼
WebhookIngressService.scheduleIngress(options)         (L250)
  options now includes causal
  │  passes causal inside processInbound options to ▼
  ▼
IngressService.processInbound(options)                 (L109)
  IProcessInboundOptions gains:
    correlationId?: string
    causationId?:  string | null
    depth?:        number
  │  passes to ▼
  ▼
IngressService.publishMessage(options)                 (L142)
  IPublishMessageOptions gains the same 3 fields
  │  passes to ▼
  ▼
createChannelEnvelope({
  ...,
  correlationId,   // ← now forwarded
  causationId,     // ← now forwarded
  depth,           // ← now forwarded
})
```

## Interface Changes

### `webhook-ingress.service.ts`

Add a new parameter to `processEnvelope`:

```typescript
// new optional 6th parameter
causal?: { correlationId?: string; causationId?: string | null; depth?: number }
```

Add `causal` to the `scheduleIngress` options object (private, no interface to export).

### `ingress.service.ts`

Extend both private interfaces with three optional fields:

```typescript
interface IProcessInboundOptions {
  // existing fields unchanged
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}

interface IPublishMessageOptions {
  // existing fields unchanged
  correlationId?: string;
  causationId?: string | null;
  depth?: number;
}
```

All additions are optional — existing callers (if any future non-webhook path calls `processInbound`)
continue to work unchanged. The factory defaults (`correlationId ?? id`, `causationId = null`,
`depth = 0`) are preserved as fallbacks.

## Test Approach

**File:** `services/channel-service/test/unit/webhook-ingress-causal.spec.ts`

The test mocks `IngressService.publishMessage` (or captures the `createChannelEnvelope` call via a
spy on the factory) and asserts that the `ChannelEnvelope` produced when processing a
`WebhookIngressEnvelope` with known `id="W"`, `correlation_id="C"`, `transport.depth=0` has:

- `causation_id === "W"`
- `correlation_id === "C"`
- `transport.depth === 1`

A second case passes a webhook without `transport` (undefined) and asserts `transport.depth === 1`
(i.e., `(undefined?.depth ?? 0) + 1`).

A third case omits causal fields entirely (simulating a non-webhook caller) and asserts the factory
defaults: `causation_id === null` and `correlation_id === envelope.id`.

The test should be a pure unit test of the factory with causal params injected directly — no NATS
mock required. This isolates the contract without infrastructure.

## Docs Change

In `DOCS/messaging/envelope.md §6.2`, the example already shows the correct causal chain
(`Event B causation_id = evt_A`). The note to remove is the as-built inconsistency note that
appeared in an earlier version of the doc. Based on the current file, the section to verify is
**§6.3** — specifically the `> **Status: partial implementation — inconsistent behavior**` block.
That block documents depth-tracker inconsistencies, not the ingress causal break; it should be left
alone. The actual "as-built inconsistency" referenced in the spec is in **§8 / the §6.2 example**
if the example was annotated as broken. The current §6.2 already shows the intended correct flow as
a design diagram — the docs task is to confirm the example no longer needs a caveat annotation and
remove any such annotation if it exists.

**Specific target:** if there is a caveat block under §6.2 or in §8 (Traceability section) noting
that channel-service does NOT actually propagate causal fields during webhook ingress, that block
must be removed. No other content changes.

## Non-Goals

- No changes to audit-service.
- No changes to NATS consumer subscriptions or stream configuration.
- No schema migrations (MongoDB or PostgreSQL).
- No changes to api-gateway (stage-1 already produces `correlation_id`/`id`/`transport.depth`
  correctly in the `WebhookIngressEnvelope`).
- No changes to other ingress paths (HTTP direct, non-webhook callers of `processInbound`).
- No new packages, no new providers, no new interfaces exported from `@yoizen/shared`.
