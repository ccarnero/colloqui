# Exploration Brief — traceability-causal-chain-ingress

## Problem Statement

The platform already *propagates* a causal chain in every event envelope
(`correlation_id`, `causation_id`, `traceid`, `transport.depth`), but it does
not *persist that chain in a queryable shape*. Given an originating ingress
event, there is no way to ask "show me every downstream side effect this
request triggered" or, in reverse, "what root cause produced this event".

Concrete evidence of the gap:
- `audit-service` persists events but the write path
  (`audit.mongo.repository.ts:72-86`) stores only
  `metadata = { tenant, source, correlation_id, traceid }` —
  **`causation_id` is dropped** and never indexed.
- The audit query API (`audit.dto.ts:4-16`, `audit.controller.ts:16-34`)
  filters only by `type`, `from`, `to`. No filter by `correlation_id`,
  `causation_id`, or `traceid`.
- The `events` Mongo schema (`audit-mongo-schema.ts:11-32`) indexes only
  `type` and `created_at` — no correlation/causation index.
- The chain semantics ARE well-specified (`DOCS/messaging/envelope.md` §6, §8)
  and correctly built by `deriveEnvelope`/`buildEventEnvelope`
  (`packages/shared/src/envelope.utils.ts`). The data exists on the wire;
  it just is not landed in a way you can traverse.

So this is a **persistence + query** problem, NOT an envelope-redesign problem.
The propagation contract is sound.

## End Goal

When done, an operator (or an API consumer / admin-console view) can, for a
given tenant:
- Look up an ingress event by `correlation_id` and retrieve the full ordered
  tree of derived events (parent → children via `causation_id`), with depth.
- Pivot from any event to its root cause and to its OTel `traceid`.
- Do this scoped strictly to one tenant (no cross-tenant leakage), reusing the
  existing per-tenant audit store.

## Current State (specific)

Ingress entry points (where work enters):
- `api-gateway` (`services/api-gateway/src/main.ts`) — HTTP webhooks, publishes
  stage-1 `WebhookIngressEnvelope` (`webhook.webhook_received.v1`).
- `channel-service` webhook ingress consumer
  (`src/modules/webhooks/webhook-ingress-consumer.service.ts`) — stage 2,
  publishes canonical envelopes; also the new first-class HTTP channel
  (recent commit 8d3014c).
- Internal producers: `agent-admin-service`, `ai-agent-gateway`,
  `registry-service`.

Messaging infra:
- NATS JetStream, per-tenant streams `INGRESS-<tenant>` capturing `evt.<tenant>.>`
  (`packages/shared/src/tenant-stream.constants.ts`, `channel.constants.ts`).
- CloudEvents-inspired `EventEnvelope` (`packages/shared/src/interfaces.ts`),
  full contract in `DOCS/messaging/envelope.md`.

Correlation/trace already in place:
- `correlation_id` (business flow), `causation_id` (immediate parent),
  `traceid` (OTel), `transport.depth` (anti-loop) — all propagated by
  `deriveEnvelope`. W3C `traceparent` injected into NATS headers.
- `activeOrRandomTraceId()` / `injectTraceContext()` in `@yoizen/observability`.

Observability/audit layer that exists:
- `audit-service` consumes `INGRESS-<tenant>` (durable pull, pattern
  `evt.*.*.platform.>` plus per-tenant streams; `audit.service.ts:43-48`)
  and writes to per-tenant Mongo/Postgres `events` collection.
- Sibling stores: `gateway_audit_events` (HTTP-level, indexed by `trace_id`)
  and `channel_events` (message audit). Note `gateway_audit` already indexes
  `trace_id` — a partial precedent for what we want on `events`.

## Options

### Option A — Extend audit-service persistence + query (recommended)
Persist `causation_id` (and lift `correlation_id`/`traceid`/`depth` to indexed
top-level fields) in the `events` collection, add Mongo indexes, and add query
endpoints (`?correlation_id=`, `?causation_id=`, plus a `/chain/:correlationId`
tree assembler). Reuse the per-tenant store already wired.
- Pros: smallest blast radius; no envelope change; tenant isolation already
  solved; builds on existing consumer. Fits the "data is on the wire, just land
  it" reality.
- Cons: chain-tree assembly is an app-level concern (recursive walk over
  `causation_id`); historical events already written won't have `causation_id`
  (backfill or accept a cutover date).

### Option B — Dedicated trace/lineage projection store
Introduce a purpose-built lineage projection (e.g. a `causal_edges` collection
or graph-shaped store: `{ tenant, correlation_id, parent_id, child_id, depth,
type, time }`) populated by the same consumer, optimized for tree traversal.
- Pros: clean read model; cheap tree queries; doesn't overload the audit
  `events` doc shape.
- Cons: more moving parts (a second projection, its own schema + tests);
  duplicate storage; more to keep consistent.

### Option C — Lean on OTel/`traceid` + external tracing backend
Treat causal chains as distributed traces; rely on `traceparent` propagation
already injected and export spans to a tracing backend (Tempo/Jaeger).
- Pros: minimal platform code; industry-standard tooling for span trees.
- Cons: `traceid` has a known fallback bug (D9 caveat: `buildEventEnvelope`
  emits a UUID, not a 32-hex OTel id, when not passed explicitly) — traces can
  break across hops; async NATS hops don't map cleanly to OTel parent/child;
  no per-tenant multi-tenant isolation story in a shared tracing backend;
  doesn't satisfy in-product "show me the chain" queries.

## Risks (top 3)

1. **Trace integrity (D9 caveat).** `traceid` is unreliable when callers don't
   pass the active span id (`envelope.md` §8). If the chain keys off `traceid`,
   it will fracture. Keying off `correlation_id` + `causation_id` (always set by
   `deriveEnvelope`) is safer — prefer those as the lineage backbone.
2. **Schema coupling / backward compat.** Changing the audit `events` doc shape
   or the envelope contract ripples across ~18 consumers of `@yoizen/shared`.
   Mitigation: additive only — index existing envelope fields, never require new
   mandatory envelope fields. Old events lack `causation_id` (cutover/backfill).
3. **Multi-tenant isolation of trace data.** Lineage queries must stay within
   one tenant's store; a `/chain` traversal must never cross the tenant
   boundary. The per-tenant connection pattern already enforces this — any new
   endpoint must reuse `TenantConnectionManager` + `@TenantId()`, not a shared
   query path.

## Recommended Direction

**Option A.** The causal model is already correct and on the wire; the only
real gap is that `causation_id` is discarded at persist time and nothing is
queryable by chain. Land `causation_id`/`correlation_id`/`depth` as indexed
fields in the existing per-tenant `events` store and add chain query endpoints
(filter + `/chain/:correlationId` tree assembly), keying lineage off
`correlation_id` + `causation_id` (not the unreliable `traceid`). This is
additive, respects the envelope contract, reuses tenant isolation, and avoids a
second store until query volume proves it necessary (then revisit Option B as a
projection).

## Open Questions

1. Read surface: API-only (admin-console/api-gateway proxied) or also a UI view?
2. Backfill old events without `causation_id`, or accept a cutover date?
3. Lineage backbone confirmed as `correlation_id`+`causation_id`? (recommended,
   given the `traceid` D9 caveat). Should we also fix D9 as part of this?
4. Should the gateway HTTP layer (`gateway_audit_events`, keyed by `trace_id`)
   be stitched into the same chain, or kept separate?
5. Postgres or Mongo per-tenant backend as the primary target (audit-service
   supports both repositories)?
