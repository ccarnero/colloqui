# Technical Design — traceability-causal-chain-ingress

## Scope (hard boundaries)

- **In:** persist `causation_id` + `transport.depth` (and lift `correlation_id`)
  to indexed, queryable shape in the per-tenant `events` store; add
  `?correlation_id=` filter; add `GET /audit/events/chain/:correlationId` tree
  assembler.
- **Out (MANDATORY):** the `traceid` / D9 OTel bug. No traceid normalization,
  no OTel fix. `traceid` continues to be persisted as-is inside `metadata`, but
  it is **not** part of the causal-chain backbone.
- **Touched services:** `audit-service` only, plus an **additive** index change
  in `@yoizen/shared` (`audit-mongo-schema.ts`). No envelope contract change, no
  `EventEnvelope` change, no other service.

## Lineage backbone (decision)

The causal chain is keyed exclusively off:

- `correlation_id` — groups the whole flow (chain root key).
- `causation_id` — immediate parent edge (`null` for the root).
- `transport.depth` — ordering / sanity bound for traversal.

`traceid` is explicitly NOT used for lineage (it is unreliable per D9). It is
left untouched in `metadata.traceid` for forward reference only.

These three fields are always set by `deriveEnvelope` / `buildEventEnvelope`
(`packages/shared/src/envelope.utils.ts`), so the data is already on the wire.
The only gap is the persist + query path.

---

## 1. Data model / schema changes

### 1.1 Document shape (Mongo `events` collection)

Today (`audit.mongo.repository.ts:72-86`):

```
{ _id, type, payload, metadata: { tenant, source, correlation_id, traceid }, subject, created_at }
```

New (additive — no field removed, `metadata` kept intact for backward compat):

```
{
  _id, type, payload, subject, created_at,
  metadata: { tenant, source, correlation_id, traceid },  // UNCHANGED
  correlation_id,   // NEW — lifted top-level, indexed
  causation_id,     // NEW — null for root, indexed
  depth             // NEW — number, from transport.depth ?? 0
}
```

Rationale for duplicating `correlation_id` at top level instead of querying
`metadata.correlation_id`: a top-level indexed field keeps the index definition
flat and matches the existing `gateway_audit_events.trace_id` precedent
(`audit-mongo-schema.ts:52-55`). `metadata.correlation_id` stays for
backward-compat with any existing reader.

### 1.2 Mongo indexes (`packages/shared/src/audit-mongo-schema.ts`, `events` collection)

Add to `AUDIT_MONGO_SCHEMA[0].indexes` (idempotent, additive only):

| Index name | Keys | Purpose |
|---|---|---|
| `idx_events_correlation` | `{ correlation_id: 1, depth: 1, created_at: 1 }` | Chain assembly + `?correlation_id=` filter, pre-ordered for tree walk |
| `idx_events_causation` | `{ causation_id: 1 }` | Parent→child edge lookups; orphan detection |

No index removed. No options change on existing indexes.

### 1.3 Postgres parity (`audit.postgres.repository.ts` inline DDL)

The Postgres repo creates the table inline via `CREATE TABLE IF NOT EXISTS` +
`CREATE INDEX IF NOT EXISTS` (`audit.postgres.repository.ts:23-36`). Add,
idempotently, inside `ensureEventsTable`:

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS causation_id   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS depth          INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events (correlation_id, depth, created_at);
CREATE INDEX IF NOT EXISTS idx_events_causation   ON events (causation_id);
```

`ADD COLUMN IF NOT EXISTS` is non-locking-safe for empty/dev tables and
idempotent — consistent with the service's "no migration files, idempotent DDL
on first message per tenant" pattern.

### 1.4 Backward compatibility

- Existing docs/rows keep working: new fields are nullable (`causation_id` null,
  `correlation_id` may be null for pre-cutover rows, `depth` defaults 0).
- `mapEventDoc` / row projection stays backward-compatible; new fields are
  surfaced additively (see §3).
- `@yoizen/shared` change is index metadata only — zero impact on the ~18
  envelope consumers.

---

## 2. Write path

`AuditMongoRepository.insertAuditEvent` and
`AuditPostgresRepository.insertAuditEvent` both build the same `metadata` blob
today. Change both to also persist the lineage fields top-level.

Mongo (`audit.mongo.repository.ts`), the `doc` built at lines 79-86 gains:

```ts
const doc = {
  _id: envelope.id,
  type: envelope.type,
  payload,
  metadata,                                   // unchanged
  correlation_id: envelope.correlation_id,    // NEW
  causation_id: envelope.causation_id ?? null,// NEW (null = root)
  depth: envelope.transport?.depth ?? 0,      // NEW
  subject,
  created_at: new Date(),
};
```

Postgres (`audit.postgres.repository.ts:56-66`) INSERT gains the three columns
with the same values.

Idempotency unchanged: duplicate `_id` still no-ops
(`isMongoDuplicateKeyError` / `ON CONFLICT DO NOTHING`).

No write-path behavior change beyond additive fields. No consumer/stream change.

---

## 3. Read path

### 3.1 `IAuditEvent` shape (additive)

Add three optional fields to `IAuditEvent`
(`audit.repository.interface.ts:6-13`) so they surface in API responses without
breaking existing consumers:

```ts
export interface IAuditEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  subject: string;
  created_at: string;
  correlation_id?: string | null;  // NEW
  causation_id?: string | null;    // NEW
  depth?: number;                  // NEW
}
```

`mapEventDoc` (Mongo) and the Postgres SELECT list gain these fields. Postgres
SELECT must add `correlation_id, causation_id, depth` to lines 78 / 95.

### 3.2 `?correlation_id=` filter on `GET /audit/events`

- `QueryEventsDto` (`audit.dto.ts`) gains an optional `correlation_id?: string`
  (`@IsOptional() @IsString()`).
- `IAuditQueryParams` (`audit-query-params.ts`) gains `correlation_id?: string`.
- Controller (`audit.controller.ts:21-27`) forwards it.
- Both repos add the filter:
  - Mongo: `if (correlationId) filter.correlation_id = correlationId;`
  - Postgres: `${correlationId ? sql\`AND correlation_id = ${correlationId}\` : sql\`\`}`

This is a flat filtered list (paginated, ordered by `created_at desc`), reusing
the new `idx_events_correlation` index.

### 3.3 Chain tree assembler — `GET /audit/events/chain/:correlationId`

New endpoint on `AuditController` (`@Controller("audit/events")`, so route is
`GET /audit/events/chain/:correlationId`). Guarded by `TenantGuard`, tenant from
`@TenantId()`.

**Route ordering caveat:** the existing `@Get(":id")` would shadow
`chain/:correlationId`. Declare the `chain/:correlationId` route **before**
`@Get(":id")` in the controller, OR use the explicit literal path segment
`@Get("chain/:correlationId")` — Nest matches static segments first, but to be
safe the chain route is declared above `:id`.

**Algorithm (single-query fetch + in-memory tree build — bounded, iterative):**

1. One indexed query: fetch all events where `correlation_id = :correlationId`,
   sorted by `depth asc, created_at asc` (served by `idx_events_correlation`).
   Apply a hard cap `MAX_CHAIN_NODES` (e.g. 5000) to bound memory; if hit, mark
   `truncated: true` in the response.
2. Build an index map `id -> node`. Each node:
   `{ id, type, subject, causation_id, depth, created_at, children: [] }`.
3. Find the root: the node whose `causation_id` is `null` (or whose
   `causation_id` is not present in the map → see orphan handling). Prefer the
   `null`-causation node; if multiple, pick the lowest `depth` / earliest
   `created_at` and record the rest under `extra_roots`.
4. Attach each non-root node to its parent via `parentMap[node.causation_id]`.
   Nodes whose parent id is absent from the set are collected as
   `orphans: []` and attached under a synthetic `orphaned` bucket (not silently
   dropped) so partial chains remain visible.
5. Return `{ correlation_id, root, node_count, max_depth, truncated, orphans }`.

This is **iterative**, not recursive on the DB — exactly one query, the tree is
assembled in memory in O(n). No N+1 traversal. `transport.depth` (MAX_DEPTH ≤ 5
for internal services) keeps real chains tiny; the cap protects against
pathological/abusive correlation_ids.

The assembler lives in its own file (one function per file, ≤200 lines):
`audit-service/src/modules/audit/build-chain-tree.ts` exporting
`buildChainTree(events: IAuditEvent[], correlationId): ChainTreeResult`. Pure
function over the fetched rows → trivially unit-testable, backend-agnostic.

A new repo method `findByCorrelationId(correlationId, tenantId)` returns the raw
ordered rows; the service calls it then `buildChainTree`.

---

## 4. Tenant isolation

No new isolation logic. Every new path reuses the existing per-tenant pattern:

- `@TenantId()` resolves the tenant from `TENANT_HEADER` via `TenantGuard`.
- Repos resolve the per-tenant DB via `AuditTenantConnectionManager` /
  `ensureTenantSchemaOnce` — the same connection used by the existing query
  path. The chain query runs against one tenant's `events` collection/table
  only; there is no shared/global query path. A traversal cannot cross tenants
  because the connection itself is the tenant boundary.

---

## 5. Error scenarios

| Scenario | Handling |
|---|---|
| No events for `correlationId` | `findByCorrelationId` returns `[]` → 404 via `assertFoundOrThrow` (message `Chain {correlationId} not found`). Consistent with `getEvent`. |
| Missing root (no `null`-causation node, e.g. pre-cutover root not persisted with new fields) | Synthesize a root from the lowest-`depth` node; flag `synthetic_root: true`. Tree still returned. |
| Orphaned nodes (parent id not in set) | Collected under `orphans[]`, not dropped. Response stays truthful about gaps. |
| Multiple `null`-causation roots | First by `depth`/`created_at` is `root`; rest under `extra_roots[]`. |
| Very deep / very wide chain | Hard cap `MAX_CHAIN_NODES`; over-cap → `truncated: true`, return what fit. Depth bound naturally ≤ MAX_DEPTH (5) for real chains. |
| Cycle (should be impossible — depth strictly increments) | Tree build attaches by id once; a node already attached is not re-attached, breaking any accidental cycle. |

---

## 6. Non-goals confirmed

- No change to `EventEnvelope` / `@yoizen/shared/interfaces.ts`.
- No new mandatory envelope field.
- No `traceid` / OTel work (D9 stays as-is).
- No second projection store (Option B deferred until query volume proves need).
- No cross-service edits.

---

## 7. Open decision flagged to tasks

**Cutover vs backfill** (Open Question #2): events written before this change
have no top-level `correlation_id`/`causation_id`/`depth`. Two options:

- **Cutover (recommended default):** chains only assemble for events written
  after deploy. Zero migration cost. `metadata.correlation_id` still lets old
  rows be found by the flat filter if we read from `metadata` as a fallback.
- **Backfill:** idempotent one-shot script copies
  `metadata.correlation_id` → top-level and derives `causation_id`/`depth` where
  present (most old rows lack `causation_id` entirely → cannot reconstruct
  edges, only correlation grouping).

User has **not** decided. Embedded as decision task `T0` in `tasks.md`.
