# Task List — traceability-causal-chain-ingress

Effort scale (fibonacci): 1 / 2 / 3 / 5 / 8.
Backend parity is mandatory: every write/query change applies to BOTH
`audit.mongo.repository.ts` and `audit.postgres.repository.ts`.

Strict TDD: write/extend the spec first where a task has tests, then implement.

---

## T0 — RESOLVED: cutover (no backfill)

- **id:** T0
- **effort:** 1
- **depends_on:** []
- **type:** decision
- **status:** DONE
- **decision:** Cutover. New schema columns are nullable. `correlation_id`,
  `causation_id`, and `depth` are populated from deploy day onward. Historical
  events keep `null` in these columns and will not appear in chain queries.
  `causation_id` edges in historical events are unrecoverable, so a backfill
  would yield indexed root events without tree structure — not worth the cost.
- **acceptance_criteria:** ✅ Columns declared `nullable`. Cutover date noted
  in `T7` docs task. `T8` is shelved (see below).

---

## T1 — Additive Mongo indexes in @yoizen/shared

- **id:** T1
- **effort:** 2
- **depends_on:** []
- **type:** schema
- **files:** `packages/shared/src/audit-mongo-schema.ts`
- **description:** Add `idx_events_correlation`
  (`{ correlation_id: 1, depth: 1, created_at: 1 }`) and `idx_events_causation`
  (`{ causation_id: 1 }`) to the `events` collection in `AUDIT_MONGO_SCHEMA[0]`.
  Additive only — remove nothing, change no existing index options.
- **acceptance_criteria:**
  - Both new indexes present in `EVENTS_AUDIT_MONGO_SCHEMA`.
  - `bun test` in `packages/shared` (if schema test exists) passes; `tsc`
    typecheck clean. No envelope/interface file touched.

---

## T2 — Postgres idempotent DDL for lineage columns + indexes

- **id:** T2
- **effort:** 2
- **depends_on:** []
- **type:** schema
- **files:** `services/audit-service/src/modules/audit/audit.postgres.repository.ts`
  (inside `ensureEventsTable`)
- **description:** Add idempotent DDL:
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS correlation_id TEXT`,
  `... causation_id TEXT`, `... depth INTEGER NOT NULL DEFAULT 0`, plus
  `CREATE INDEX IF NOT EXISTS idx_events_correlation ON events (correlation_id, depth, created_at)`
  and `idx_events_causation ON events (causation_id)`.
- **acceptance_criteria:**
  - DDL is idempotent (safe on re-run and on tables that already have columns).
  - Existing audit-service unit tests still pass.

---

## T3 — Write path: persist correlation_id / causation_id / depth (both repos)

- **id:** T3
- **effort:** 3
- **depends_on:** [T1, T2]
- **type:** write-path
- **files:**
  - `services/audit-service/src/modules/audit/audit.mongo.repository.ts`
    (`insertAuditEvent` doc build)
  - `services/audit-service/src/modules/audit/audit.postgres.repository.ts`
    (`insertAuditEvent` INSERT)
  - `services/audit-service/src/modules/audit/audit.repository.interface.ts`
    (`IAuditEvent` additive fields)
  - `services/audit-service/test/unit/audit.repository.spec.ts` (extend)
- **description:** Persist top-level `correlation_id = envelope.correlation_id`,
  `causation_id = envelope.causation_id ?? null`, `depth =
  envelope.transport?.depth ?? 0`. Keep the `metadata` blob unchanged. Surface
  the three fields in `mapEventDoc` (Mongo) and the Postgres SELECT lists.
  Idempotency behavior unchanged.
- **acceptance_criteria:**
  - Inserting an envelope with `causation_id` + `depth` persists all three
    fields top-level (asserted in spec for the Mongo mock).
  - Root envelope (`causation_id: null`) persists `causation_id: null`,
    `depth: 0`.
  - Duplicate `_id` still no-ops.
  - `bun test test/unit` green.

---

## T4 — `?correlation_id=` filter on GET /audit/events

- **id:** T4
- **effort:** 3
- **depends_on:** [T3]
- **type:** query-path
- **files:**
  - `services/audit-service/src/modules/audit/audit.dto.ts`
    (`correlation_id?` on `QueryEventsDto`)
  - `services/audit-service/src/common/audit-query-params.ts`
    (`correlation_id?` on `IAuditQueryParams`)
  - `services/audit-service/src/modules/audit/audit.controller.ts` (forward it)
  - both repositories (`queryEvents` filter)
  - `services/audit-service/test/unit/audit.controller.spec.ts` and
    `audit.repository.spec.ts` (extend)
- **description:** Add optional `correlation_id` filter, validated
  (`@IsOptional() @IsString()`), forwarded through service → repos. Mongo:
  `filter.correlation_id`. Postgres: `AND correlation_id = ${...}`. Uses
  `idx_events_correlation`.
- **acceptance_criteria:**
  - `GET /audit/events?correlation_id=X` returns only events with that
    correlation_id, paginated, ordered `created_at desc`.
  - Omitting the param preserves current behavior.
  - Tenant scoping unchanged (`@TenantId()`).
  - `bun test test/unit` green.

---

## T5 — Pure chain-tree assembler

- **id:** T5
- **effort:** 5
- **depends_on:** [T3]
- **type:** core-logic
- **files:**
  - `services/audit-service/src/modules/audit/build-chain-tree.ts` (NEW, one
    function, ≤200 lines)
  - `services/audit-service/test/unit/build-chain-tree.spec.ts` (NEW)
- **description:** Pure function
  `buildChainTree(events: IAuditEvent[], correlationId): ChainTreeResult`.
  Builds `id -> node` map, finds root (`causation_id == null`; fallback to
  lowest-depth → `synthetic_root`), attaches children by `causation_id`,
  collects `orphans[]` (parent absent) and `extra_roots[]`, enforces
  `MAX_CHAIN_NODES` cap (`truncated`). Iterative, O(n), no recursion on input
  size beyond the bounded depth. Backend-agnostic (operates on `IAuditEvent`).
- **acceptance_criteria (spec cases):**
  - Linear chain A→B→C builds correct nested tree, `max_depth` correct.
  - Branching (one parent, two children) nests both children.
  - Missing root → `synthetic_root: true`, tree still returned.
  - Orphan node (parent id absent) lands in `orphans[]`, not dropped.
  - Over-cap input → `truncated: true`, node_count == cap.
  - Empty input → caller-detectable empty/`null` result (404 handled in T6).
  - Cyclic input does not infinite-loop.
  - `bun test test/unit` green.

---

## T6 — `GET /audit/events/chain/:correlationId` endpoint + repo fetch

- **id:** T6
- **effort:** 3
- **depends_on:** [T4, T5]
- **type:** query-path
- **files:**
  - `services/audit-service/src/modules/audit/audit.repository.interface.ts`
    (`findByCorrelationId` method)
  - both repositories (`findByCorrelationId` impl — Mongo sort
    `{ depth: 1, created_at: 1 }`; Postgres `ORDER BY depth, created_at`)
  - `services/audit-service/src/modules/audit/audit.service.ts`
    (`getChain(correlationId, tenantId)` → fetch + `buildChainTree`)
  - `services/audit-service/src/modules/audit/audit.controller.ts` (route
    declared ABOVE `@Get(":id")` to avoid shadowing)
  - `services/audit-service/test/unit/audit.controller.spec.ts` and
    `audit.service.spec.ts` (extend)
- **description:** New `findByCorrelationId` returns ordered rows for one tenant
  (per-tenant connection only). Service composes fetch + `buildChainTree`.
  Controller exposes `GET /audit/events/chain/:correlationId` under
  `TenantGuard` + `@TenantId()`. Empty result → 404 via `assertFoundOrThrow`.
- **acceptance_criteria:**
  - `GET /audit/events/chain/:id` returns the assembled tree for the tenant.
  - Unknown correlation → 404.
  - Route does NOT collide with `GET /audit/events/:id` (verified by a test
    hitting both).
  - Query stays tenant-scoped.
  - `bun test test/unit` green.

---

## T7 — Docs update

- **id:** T7
- **effort:** 2
- **depends_on:** [T3, T4, T6]
- **type:** docs
- **files:**
  - `services/audit-service/CLAUDE.md` (events schema + new endpoint)
  - `DOCS/messaging/envelope.md` §8 (note: causal chain now queryable via
    audit-service `/chain`; traceid still NOT the lineage backbone — D9 unchanged)
- **description:** Document the new fields, indexes, `?correlation_id=` filter,
  and the `/chain/:correlationId` endpoint + response shape. State explicitly
  that lineage keys off `correlation_id`+`causation_id`+`depth`, not `traceid`,
  and record the cutover date (or backfill note) from `T0`.
- **acceptance_criteria:**
  - Schema, endpoint, response shape, and lineage-backbone note documented.
  - `T0` decision (cutover date or backfill) reflected.

---

## T8 — SHELVED: Idempotent backfill script (optional future change)

- **id:** T8
- **status:** SHELVED — skipped per T0 cutover decision
- **effort:** 5
- **type:** migration
- **rationale:** Historical `causation_id` edges are unrecoverable, so a
  backfill would only index root `correlation_id` values without the tree
  structure. Not worth the migration cost. If compliance ever requires it,
  activate as a standalone change: copy `metadata.correlation_id` to the
  top-level column per-tenant, leave `causation_id` and `depth` as null.
- **files (if activated):** `services/audit-service/scripts/backfill-chain-fields.ts`

---

## Archive status

**ARCHIVED 2026-06-20** — all tasks verified green (56 tests in audit-service, 116 in packages/shared). See `archive.md` for full close-out summary.

---

## Suggested execution order

`T1` + `T2` (schema, parallel) → `T3` (write) →
`T4` (filter) + `T5` (assembler, parallel) → `T6` (endpoint) →
`T7` (docs). T8 is shelved.

## Review workload forecast

Estimated changed lines: ~250–350 across audit-service + 1 shared index file.
Mostly additive, single service. Chained PRs not required; fits one PR unless
`T8` backfill is included (then split `T8` into its own PR).
