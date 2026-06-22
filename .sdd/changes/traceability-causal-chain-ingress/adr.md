# ADR — Persist and query the causal chain in audit-service

- **Status:** Accepted
- **Date:** 2026-06-20
- **Change:** traceability-causal-chain-ingress

## Context

The platform already propagates a causal chain on every envelope
(`correlation_id`, `causation_id`, `transport.depth`) via `deriveEnvelope` /
`buildEventEnvelope`. The data is on the wire and the propagation contract is
sound. The gap is purely persistence + query:

- `audit-service` drops `causation_id` at write time
  (`audit.mongo.repository.ts:72-86` / `audit.postgres.repository.ts:49-54`).
- The `events` store indexes only `type` and `created_at` — nothing keyed by
  correlation/causation.
- The query API filters only `type`/`from`/`to`. There is no way to ask "show
  the full tree of side effects of this ingress event".

`traceid` exists but is unreliable (D9: `buildEventEnvelope` can emit a UUID
instead of a 32-hex OTel id). Fixing D9 is explicitly **out of scope** for this
change.

Multi-tenant isolation is already solved by the per-tenant connection pattern
(`TenantConnectionManager` + `@TenantId()`); any new path must reuse it.

## Decision

**Option A — Extend audit-service persistence + query.**

1. Land `correlation_id`, `causation_id`, and `depth` as indexed, top-level
   fields in the existing per-tenant `events` store (additive; `metadata` blob
   kept intact for backward compat).
2. Add two additive indexes (`idx_events_correlation`, `idx_events_causation`)
   in both Mongo (`@yoizen/shared/audit-mongo-schema.ts`) and Postgres (inline
   idempotent DDL).
3. Add a `?correlation_id=` filter to `GET /audit/events`.
4. Add `GET /audit/events/chain/:correlationId` that fetches all events for the
   correlation in one indexed query and assembles the parent→child tree
   in-memory via a pure `buildChainTree` function.

**Lineage backbone is `correlation_id` + `causation_id` + `depth`. `traceid` is
NOT used for lineage.**

## Consequences

### Positive
- Smallest blast radius: `audit-service` + an additive `@yoizen/shared` index
  list. No envelope change, no impact on ~18 envelope consumers.
- Tenant isolation reused for free; no shared query path.
- Tree assembly is a single indexed query + O(n) in-memory build — no N+1, no
  recursive DB traversal. Bounded by `transport.depth` (≤5) and a hard node cap.
- Pure assembler function → backend-agnostic and trivially unit-tested.

### Negative / trade-offs
- Chain assembly is an app-level concern living in audit-service rather than a
  purpose-built graph store.
- Historical events lack `causation_id`/top-level `correlation_id` → either a
  cutover date or a backfill is required (decision deferred to tasks `T0`).
- Two backends (Mongo + Postgres) must be kept in parity for write, filter, and
  the new repo method.

### Neutral
- `metadata.correlation_id`/`metadata.traceid` remain; top-level
  `correlation_id` is a deliberate duplicate for a flat index.

## Alternatives rejected

- **Option B — dedicated lineage/projection store (`causal_edges`).** Cleaner
  read model and cheaper tree queries, but adds a second projection, its own
  schema + tests + consistency story, and duplicate storage. Premature until
  query volume proves it. Revisit as a follow-up if `/chain` traffic grows.
- **Option C — lean on OTel `traceid` + external tracing backend
  (Tempo/Jaeger).** Rejected: depends on the unreliable `traceid` (D9, out of
  scope to fix); async NATS hops don't map cleanly to OTel parent/child; no
  per-tenant isolation in a shared tracing backend; doesn't satisfy in-product
  "show me the chain" queries.
