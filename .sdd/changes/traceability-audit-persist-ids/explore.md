# Exploration Brief — traceability-audit-persist-ids

## Problem Statement
The prior change `traceability-causal-chain-ingress` made `correlation_id`, `causation_id`,
and `depth` first-class indexed fields in the **core `events`** audit stream
(`audit-service` per-tenant `events` collection). However, the SAME traceability IDs
are carried end-to-end on the wire (NATS envelopes + headers) but are **dropped at
persistence time** by the two OTHER audit surfaces in `audit-service`:

- `gateway_audit_events` — persists only `trace_id`; has NO `correlation_id` / `causation_id`.
- `channel_events` (audit variant) — persists NO traceability IDs at all
  (`correlation_id`, `causation_id`, `depth`, and even `trace_id` are absent).

The result: you can reconstruct a causal chain inside the `events` stream, but you
CANNOT join gateway HTTP audit rows or channel message audit rows into that chain.
A request that enters at the gateway (which DOES mint `correlation_id` at ingress) loses
that linkage the moment it is audited, breaking cross-surface traceability.

## End Goal (observable behavior when done)
Given a `correlation_id` minted at ingress (api-gateway webhook publisher or
channel-service envelope factory), an operator can query ALL THREE audit surfaces
(`events`, `gateway_audit_events`, `channel_events`) by that `correlation_id` (and
`causation_id`) and get the complete causal chain across HTTP ingress, channel
messages, and domain events — with consistent indexing for efficient lookup.

## Current State (what persists today vs. what doesn't)

### Wire / ingress — IDs ARE present and correct
- `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:74-114`
  mints `id = crypto.randomUUID()`, sets `correlation_id = id`, `causation_id = null`,
  `depth: 0`, `traceid`, and writes `X-Correlation-Id` NATS header.
- `services/channel-service/src/domain/envelope.factory.ts:53-102,154-187`
  defaults `correlationId ?? id`, `causationId = null`, `depth = 0`, `traceid`.
- NATS headers carry traceability: `services/agent-memory-service/src/providers/nats.provider.ts:331-333`
  sets `Nats-Msg-Id`, `X-Correlation-Id`, and conditionally `X-Causation-Id`.
- W3C `traceparent` is propagated across the JetStream hop
  (`services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts:94-98`).
- Causal derivation helper exists:
  `packages/shared/src/envelope.utils.ts:156-197` (causation_id = incoming.id,
  correlation_id copied, traceid copied, depth+1).

### Persistence — IDs ARE DROPPED on two surfaces
- **Core `events`** (DONE in prior change): indexes `correlation_id+depth+created_at`
  and `causation_id` — `packages/shared/src/audit-mongo-schema.ts:30-39`. Good.
- **`gateway_audit_events`**: interface `GatewayAuditEvent`
  (`packages/shared/src/audit.interfaces.ts:1-18`) has `traceId` but NO
  correlation/causation. Mongo doc (`gateway-audit.mongo.repository.ts:79-99`) and
  Postgres DDL (`gateway-audit.postgres.repository.ts:60-79`) store `trace_id` only.
  Schema indexes only `trace_id` (`audit-mongo-schema.ts:41-66`).
  NOTE: the producing interceptor
  (`services/api-gateway/src/interceptors/audit.interceptor.ts:71-90`) does NOT
  currently have `correlation_id` in scope — it builds the event from the HTTP request,
  not from an envelope. This is a propagation gap, not just a persistence gap.
- **`channel_events` (audit)**: the `ChannelEnvelope` HAS `correlation_id`,
  `causation_id`, `depth`, `traceid` available, but `insertChannelEvent`
  (`channel-audit.mongo.repository.ts:66-82` and the Postgres twin
  `channel-audit.postgres.repository.ts:87-102`) builds the doc WITHOUT them.
  Projection (`services/audit-service/src/common/channel-audit-projection.ts:7-37`)
  has no traceability columns. Pure persistence drop — the data is in hand.

### ID propagation gaps (events produced without a proper chain)
- Scheduler heartbeat mints a fresh `correlation_id = crypto.randomUUID()` per batch
  (`services/agent-scheduler-service/src/modules/heartbeat/heartbeat.service.ts:87-99`),
  `causation_id` absent — expected for a root, but worth confirming as intentional.
- Memory events use synthetic `correlationId: memory:${id}`
  (`agent-memory-service/src/providers/nats.provider.ts:374-442`) — not joinable to an
  ingress correlation chain.

## Options

### Option A — Persistence-only backfill (channel_events first; gateway as data allows)
Add `correlation_id` / `causation_id` / `depth` columns+indexes to `channel_events`
(audit) and map them from the already-available `ChannelEnvelope` in both Mongo and
Postgres repos. For `gateway_audit_events`, add the columns but only populate what the
interceptor can reach today (likely nothing without extra work, so leave nullable).
- Pros: smallest blast radius; `channel_events` is a pure win with data already in hand;
  matches the prior `events` change pattern exactly (mirror the index shape).
- Cons: gateway surface stays half-linked (columns exist but empty) until ingress
  propagation is fixed — partial value.

### Option B — Full end-to-end (persist + close the gateway propagation gap)
Option A PLUS thread `correlation_id`/`causation_id` into the gateway audit interceptor
so HTTP audit rows are joinable. Gateway ingress already mints `correlation_id` for
webhooks; extend the interceptor to read it from request context / response header and
include it in `GatewayAuditEvent`.
- Pros: delivers the real end goal — all three surfaces joinable by `correlation_id`.
- Cons: touches api-gateway request lifecycle (interceptor + where the id is stamped on
  the request); larger surface; the gateway mints correlation only on the webhook path —
  generic platform/dynamic routes may have no correlation_id to persist (still nullable).

### Option C — Persist raw IDs everywhere now, defer indexing/joins
Store the IDs as plain (unindexed) fields across both surfaces for forensic value,
skip new indexes, decide join/index strategy later.
- Pros: cheapest schema change; preserves data for later.
- Cons: violates the prior change's established pattern (indexed top-level fields);
  unindexed correlation lookups across audit volumes will be slow; likely needs a
  follow-up change anyway.

## Risks
1. **Schema drift Mongo vs Postgres**: both backends have parallel repos for each surface
   (`*.mongo.repository.ts` + `*.postgres.repository.ts` + shared projection). Any column
   added MUST land in all of: shared interface, mongo doc, mongo schema indexes,
   postgres DDL, postgres INSERT, and the projection — or list/read endpoints drift.
2. **Backfill / lazy-DDL semantics**: tables/collections are created lazily per tenant
   (`ensureTenantNamespaceOnce` / per-tenant `gateway_audit` namespace). New columns/
   indexes must be additive and idempotent (`IF NOT EXISTS`), and existing rows will have
   NULL correlation/causation — queries must tolerate that.
3. **Gateway propagation reach (Option B)**: the interceptor has no envelope; correlation
   exists only on the webhook ingress path. Forcing a correlation_id onto every HTTP audit
   row risks fabricating IDs that don't join to anything — keep it nullable, don't invent.

## Recommended Direction
**Option B, sequenced as A-then-gateway**, with persistence mirrored across both
backends and indexes matching the prior `events` change shape
(`correlation_id+depth+created_at` composite + `causation_id`).

Rationale: `channel_events` is a pure, low-risk win — the `ChannelEnvelope` already
carries the IDs and the repos simply drop them; fixing it immediately restores
cross-surface joins for the channel path with no upstream changes. The gateway surface
needs a small propagation step in the api-gateway interceptor to be truly useful, so do
it in the same change to actually hit the end goal, but treat the gateway correlation as
**nullable** (only the webhook ingress path will populate it today). Avoid Option C — it
breaks the established indexed-field convention and guarantees a rework follow-up.

## Open Questions (resolve before design)
1. **Gateway scope**: is closing the gateway interceptor propagation gap in-scope for THIS
   change, or is "persist IDs" strictly the persistence layer (Option A) with gateway
   propagation deferred to a separate change?
2. **Backfill expectation**: existing audit rows pre-date these columns. Is leaving them
   NULL acceptable, or is a historical backfill (e.g. recompute from `data`/`trace_id`)
   expected?
3. **`trace_id` on channel_events**: should the channel audit surface also start storing
   `trace_id` (the envelope has `traceid`) for parity with `gateway_audit_events`, or only
   correlation/causation/depth?
4. **Heartbeat / memory synthetic correlation ids**: are the synthetic correlation ids in
   scheduler heartbeat and agent-memory considered correct roots, or is unifying them into
   the ingress correlation scheme part of "persist IDs"?
5. **Read/query surface**: should the audit-service query endpoints + DTOs expose filtering
   by `correlation_id`/`causation_id` on the gateway and channel surfaces (like the
   existing chain-tree builder for `events`), or is storage-only enough for this change?
