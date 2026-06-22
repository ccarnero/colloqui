# Archive — traceability-causal-chain-ingress

**Status:** ARCHIVED
**Archived:** 2026-06-20
**Verification:** PASS — 56 tests green in `services/audit-service`, 116 tests green in `packages/shared`, 0 failures.

---

## What shipped

Causal chain traceability for the audit service. The platform already propagated `correlation_id`, `causation_id`, and `transport.depth` in every event envelope via `deriveEnvelope`, but the audit write path discarded `causation_id` and nothing was queryable by chain. This change lands those fields in a queryable shape and adds a tree-assembly endpoint.

**Scope:** `audit-service` + one additive schema file in `@yoizen/shared`. No other service touched, no envelope contract changed.

---

## Acceptance criteria

| Task | Criteria | Result |
|------|----------|--------|
| T0 | Cutover strategy decided; columns nullable | DONE — cutover from 2026-06-20, no backfill |
| T1 | `idx_events_correlation` + `idx_events_causation` added to Mongo schema | PASS |
| T2 | Idempotent DDL for `correlation_id`, `causation_id`, `depth` in Postgres | PASS |
| T3 | Both repos write lineage fields; `IAuditEvent` extended; `mapEventDoc` updated | PASS |
| T4 | `?correlation_id=` filter on `GET /audit/events` (both repos, DTO, controller) | PASS |
| T5 | `buildChainTree` pure function, 8-case unit spec | PASS |
| T6 | `GET /audit/events/chain/:correlationId` endpoint, both repos, service, controller | PASS |
| T7 | `DOCS/messaging/envelope.md` and `services/audit-service/CLAUDE.md` updated | PASS |
| T8 | Backfill script | SHELVED |

---

## Key decisions

**Lineage backbone — `correlation_id` + `causation_id` + `depth` only.**
`traceid` is NOT used for lineage. The D9 OTel caveat (`buildEventEnvelope` emits a UUID when no active span is passed) makes `traceid` unreliable across async NATS hops. `traceid` continues to be persisted inside `metadata` for forward reference; it is not indexed or queried by the chain path.

**Option A — extend audit-service, no dedicated projection store.**
A second lineage projection (Option B) was deferred. If query volume proves the in-place approach insufficient, revisit Option B as a standalone change.

**Cutover, not backfill (T0 resolution).**
Historical `causation_id` edges are unrecoverable — a backfill would only copy `metadata.correlation_id` to the top-level column without any tree structure. Not worth the migration cost. Chain queries return events written from 2026-06-20 onward; pre-cutover rows have `null` in the three new columns and are excluded from chain traversal.

**T8 shelved.**
Confirmed permanently shelved unless a compliance requirement arises. If activated, it should be its own change — `scripts/backfill-chain-fields.ts` per tenant, copying `metadata.correlation_id` only.

---

## Files touched

| Path | Change |
|------|--------|
| `packages/shared/src/audit-mongo-schema.ts` | Two new indexes on `events` collection (`idx_events_correlation`, `idx_events_causation`) |
| `services/audit-service/src/modules/audit/audit.postgres.repository.ts` | Idempotent DDL for three new columns + two indexes inside `ensureEventsTable` |
| `services/audit-service/src/modules/audit/audit.mongo.repository.ts` | Write path persists `correlation_id`, `causation_id`, `depth`; `mapEventDoc` updated |
| `services/audit-service/src/modules/audit/audit.repository.interface.ts` | `IAuditEvent` gains three optional fields; `findByCorrelationId` method added |
| `services/audit-service/src/modules/audit/audit.dto.ts` | `QueryEventsDto` gains optional `correlation_id` |
| `services/audit-service/src/common/audit-query-params.ts` | `IAuditQueryParams` gains `correlation_id?` |
| `services/audit-service/src/modules/audit/audit.controller.ts` | `?correlation_id=` forwarded; `GET /audit/events/chain/:correlationId` added above `:id` route |
| `services/audit-service/src/modules/audit/audit.service.ts` | `getChain(correlationId, tenantId)` added |
| `services/audit-service/src/modules/audit/build-chain-tree.ts` | NEW — pure `buildChainTree` function, `ChainTreeResult` type |
| `services/audit-service/test/unit/build-chain-tree.spec.ts` | NEW — 8 unit cases |
| `services/audit-service/test/unit/audit.repository.spec.ts` | Extended for write-path and filter assertions |
| `services/audit-service/test/unit/audit.controller.spec.ts` | Extended for chain endpoint and filter |
| `services/audit-service/test/unit/audit.service.spec.ts` | Extended for `getChain` |
| `DOCS/messaging/envelope.md` | §8 updated: causal chain queryable via `/chain`; `traceid` explicitly NOT the lineage backbone |
| `services/audit-service/CLAUDE.md` | Events schema, new endpoint, and lineage note added |

---

## Changelog

### [2026-06-20] feat(audit-service): causal chain traceability

**Added**
- Two new Mongo indexes on `events` collection: `idx_events_correlation` (`correlation_id, depth, created_at`) and `idx_events_causation` (`causation_id`).
- Idempotent Postgres DDL: `correlation_id TEXT`, `causation_id TEXT`, `depth INTEGER DEFAULT 0` columns plus matching indexes.
- Both repositories now persist `correlation_id`, `causation_id`, and `depth` as top-level fields on every audit event written from 2026-06-20 onward.
- `IAuditEvent` interface extended with three optional lineage fields (`correlation_id`, `causation_id`, `depth`).
- `GET /audit/events?correlation_id=<id>` — filter events by correlation group (tenant-scoped).
- `GET /audit/events/chain/:correlationId` — returns the full assembled causal tree for a correlation group (single query, in-memory O(n) assembly, `MAX_CHAIN_NODES` cap, orphan and synthetic-root handling).
- `build-chain-tree.ts` — pure, backend-agnostic chain assembler function, independently unit-tested (8 cases).

**Decided**
- Lineage backbone: `correlation_id` + `causation_id` + `depth`. `traceid` / D9 OTel issue is explicitly out of scope and unchanged.
- Cutover strategy: columns nullable, populated from deploy date onward. Historical rows are excluded from chain traversal.
- Option A (extend audit-service) chosen over Option B (dedicated projection) and Option C (OTel backend).

**Shelved**
- T8 backfill script: deferred indefinitely. Historical `causation_id` edges are unrecoverable; a backfill would yield root events only, without tree structure.

---

## Follow-ups

1. **D9 OTel fix** — `traceid` remains unreliable when callers do not pass an active span to `buildEventEnvelope`. This is a separate, deliberate out-of-scope item. If it is fixed, `traceid` can be stitched into the chain response as a supplementary field without changing the lineage backbone.
2. **Option B projection** — if `GET /audit/events/chain/:correlationId` becomes hot (high-cardinality chains, high query frequency), revisit a dedicated `causal_edges` read model as a standalone SDD change.
3. **T8 backfill** — activate only if a compliance or audit requirement surfaces that demands historical correlation grouping (without tree structure).
4. **UI surface** — the `/chain` endpoint is API-only. An admin-console view was noted in exploration open questions; not in scope here.
