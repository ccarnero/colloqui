# Technical Design — traceability-audit-persist-ids

## Scope (locked: Option B, full end-to-end)

1. Persist `correlation_id`, `causation_id`, `depth` on `channel_events` (Mongo + Postgres).
2. Persist `correlation_id`, `causation_id`, `depth` (+ indexes) on `gateway_audit_events` (Mongo + Postgres).
3. Thread `correlation_id` from the webhook ingress publisher into the api-gateway audit interceptor so gateway HTTP rows are joinable.

**Out of scope**: synthetic correlation IDs (heartbeat, memory), historical backfill, query/filter endpoints and chain-tree builders for these two surfaces.

**Cutover model (same as prior `events` change)**: all new columns are NULLABLE (with `depth` defaulting to `0`). No backfill. Pre-cutover rows keep `NULL` correlation/causation and will not appear in correlation joins. Schema additions are additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, additive Mongo index descriptors).

## Source of truth for the IDs

Both surfaces' upstream data already carries the IDs:

- `ChannelEnvelope extends EventEnvelope` (`packages/shared/src/interfaces.ts:29-57`):
  - `correlation_id: string` (always present)
  - `causation_id: string | null`
  - depth lives at `transport.depth?: number` (NOT a top-level field) — read as `envelope.transport?.depth ?? 0`.
- Webhook ingress publisher (`webhook-ingress-publisher.service.ts:74-126`) mints `correlationId = id`, `causation_id: null`, `transport.depth: 0`, and already returns `id` to the controller.

The persistence pattern to MIRROR is the prior `events` change:
- Mongo indexes (`audit-mongo-schema.ts:30-39`): `idx_events_correlation` on `{ correlation_id: 1, depth: 1, created_at: 1 }`, `idx_events_causation` on `{ causation_id: 1 }`.
- Postgres: `idx_events_correlation` on `(correlation_id, depth, created_at)`, `idx_events_causation` on `(causation_id)`.

---

## Surface 1 — `channel_events` (pure persistence win, data already in hand)

### 1a. Shared interface
`packages/shared/src/audit.interfaces.ts` has no `IChannelEvent`/`ChannelAuditEvent` interface — the channel surface inserts directly from `ChannelEnvelope` and reads via `IStoredChannelEvent` in the projection. So the "shared interface" change here is on the **projection result type**, not a `@yoizen/shared` interface.

Add to `IStoredChannelEvent` (`services/audit-service/src/common/channel-audit-projection.ts:24-39`):
```ts
correlationId: string | null;
causationId: string | null;
depth: number | null;
```

### 1b. Mongo schema indexes
In `AUDIT_MONGO_SCHEMA[2]` (`channel_events`, `audit-mongo-schema.ts:66-90`) add two index descriptors mirroring the events shape:
```ts
{ keys: { correlation_id: 1, depth: 1, created_at: 1 }, options: { name: "idx_ch_evt_correlation" } },
{ keys: { causation_id: 1 }, options: { name: "idx_ch_evt_causation" } },
```
Index descriptors are additive; `applyMongoSchema` creates only missing indexes (idempotent).

### 1c. Mongo write path
In `channel-audit.mongo.repository.ts:66-81`, add three fields to the inserted `doc`:
```ts
correlation_id: envelope.correlation_id ?? null,
causation_id: envelope.causation_id ?? null,
depth: envelope.transport?.depth ?? 0,
```

### 1d. Mongo read mapping
In `mapChannelAuditDoc` (`channel-audit-projection.ts:54-76`) add:
```ts
correlationId: (doc.correlation_id as string | null | undefined) ?? null,
causationId: (doc.causation_id as string | null | undefined) ?? null,
depth: typeof doc.depth === "number" ? doc.depth : null,
```

### 1e. Postgres DDL
In `ensureChannelEventsTable` (`channel-audit.postgres.repository.ts:30-52`) — keep the base `CREATE TABLE IF NOT EXISTS` unchanged for fresh tenants but add idempotent column adds + indexes after it (a tenant whose table already exists will NOT pick up new columns from `CREATE TABLE IF NOT EXISTS`):
```sql
ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS causation_id   TEXT;
ALTER TABLE channel_events ADD COLUMN IF NOT EXISTS depth          INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ch_evt_correlation ON channel_events (correlation_id, depth, created_at);
CREATE INDEX IF NOT EXISTS idx_ch_evt_causation   ON channel_events (causation_id);
```
> NOTE: `ADD COLUMN IF NOT EXISTS depth ... NOT NULL DEFAULT 0` is safe — existing rows get `0`, future inserts get the envelope depth. This matches the prior `events` change (`depth INTEGER NOT NULL DEFAULT 0`).

### 1f. Postgres write path
In `insertChannelEvent` (`channel-audit.postgres.repository.ts:82-105`) add the three columns to the INSERT list and values:
```sql
... message_text, provider_message_id, correlation_id, causation_id, depth, data, ...
VALUES ( ..., ${envelope.correlation_id ?? null}, ${envelope.causation_id ?? null}, ${envelope.transport?.depth ?? 0}, ... )
```

### 1g. Postgres projection
In `CHANNEL_AUDIT_SELECT_PROJECTION` (`channel-audit-projection.ts:7-22`) add:
```sql
correlation_id AS "correlationId",
causation_id   AS "causationId",
depth,
```

---

## Surface 2 — `gateway_audit_events`

### 2a. Shared interface
`GatewayAuditEvent` (`packages/shared/src/audit.interfaces.ts:1-18`) is the canonical wire + insert type. Add three OPTIONAL fields (keep optional so the interceptor only sets them when it has them):
```ts
correlationId?: string | null;
causationId?: string | null;
depth?: number | null;
```

### 2b. Mongo schema indexes
In `AUDIT_MONGO_SCHEMA[1]` (`gateway_audit_events`, `audit-mongo-schema.ts:41-65`) add:
```ts
{ keys: { correlation_id: 1, depth: 1, created_at: 1 }, options: { name: "idx_gw_audit_correlation" } },
{ keys: { causation_id: 1 }, options: { name: "idx_gw_audit_causation" } },
```

### 2c. Mongo write path
In `insertGatewayEvent` (`gateway-audit.mongo.repository.ts:79-98`) add to `doc`:
```ts
correlation_id: event.correlationId ?? null,
causation_id: event.causationId ?? null,
depth: event.depth ?? null,
```

### 2d. Mongo read mapping
In `mapGatewayAuditDoc` (`gateway-audit-projection.ts:103-137`) add:
```ts
correlationId: (doc.correlation_id as string | null | undefined) ?? null,
causationId: (doc.causation_id as string | null | undefined) ?? null,
depth: typeof doc.depth === "number" ? doc.depth : null,
```

### 2e. Postgres DDL
In `ensureGatewayAuditTable` (`gateway-audit.postgres.repository.ts:53-87`) add after the `CREATE TABLE`:
```sql
ALTER TABLE gateway_audit_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE gateway_audit_events ADD COLUMN IF NOT EXISTS causation_id   TEXT;
ALTER TABLE gateway_audit_events ADD COLUMN IF NOT EXISTS depth          INTEGER;
CREATE INDEX IF NOT EXISTS idx_gw_audit_correlation ON gateway_audit_events (correlation_id, depth, created_at);
CREATE INDEX IF NOT EXISTS idx_gw_audit_causation   ON gateway_audit_events (causation_id);
```
> `depth` here is plain nullable `INTEGER` (no default): on the gateway surface depth is meaningful only for the webhook ingress root (`0`); non-webhook rows legitimately have no depth. Leaving it NULL avoids fabricating a `0` that implies "ingress root".

### 2f. Postgres write path
In `insertGatewayEvent` (`gateway-audit.postgres.repository.ts:96-123`) add `correlation_id, causation_id, depth` to the INSERT list and values:
```sql
${event.correlationId ?? null}, ${event.causationId ?? null}, ${event.depth ?? null}
```

### 2g. Postgres projection + SQL row mapper
- `GATEWAY_AUDIT_SELECT_PROJECTION` (`gateway-audit-projection.ts:8-27`) add:
  ```sql
  correlation_id AS "correlationId",
  causation_id   AS "causationId",
  depth,
  ```
- `IGatewayAuditSqlRow` (`gateway-audit-projection.ts:33-52`) add `correlationId: string | null; causationId: string | null; depth: number | null;`
- `mapGatewayAuditSqlRow` (`:55-88`) pass them through to the result.

---

## Surface 3 — Gateway interceptor propagation (closes the real gap)

### Current behavior
- The interceptor (`audit.interceptor.ts:31-101`) builds `GatewayAuditEvent` purely from the HTTP request/response. It has NO correlation in scope.
- `skipWebhookPaths` defaults to **`false`** (`gateway.config.ts:126-128`), so webhook paths (`/api/webhooks/`) ARE currently audited by default — the audit row for the very request that mints `correlation_id` exists but drops the ID.
- The webhook publisher (`webhook-ingress-publisher.service.ts:74,81,151`) mints `correlationId = id` and returns `id` to `webhooks.controller.ts:62`.

### Propagation mechanism: stamp on the request object
Use the existing request-augmentation pattern (`IYoizenRequest` already carries `__upstream`, `__rateLimitApplied`, etc. — see `types/yoizen-request.ts`). This is the lowest-blast-radius option: no new DI, no header round-trip, same request instance is visible to both the controller-invoked publisher and the response-phase interceptor `tap`.

Steps:
1. Add to `IYoizenRequest` (`types/yoizen-request.ts`):
   ```ts
   __correlationId?: string;
   __causationId?: string | null;
   __depth?: number;
   ```
2. In `WebhookIngressPublisherService.publishWebhook`, after minting `correlationId`, stamp it on the request. The publisher does not currently receive the request — add `request` to `IPublishWebhookParams` and pass it from `webhooks.controller.ts:62`. Stamp:
   ```ts
   request.__correlationId = correlationId; // = id
   request.__causationId = null;
   request.__depth = 0;
   ```
   (Webhook ingress is always a root: `causation_id = null`, `depth = 0`.)
3. In the interceptor `publishAudit` (`audit.interceptor.ts:61-89`), read them off the request and set on the event:
   ```ts
   correlationId: request.__correlationId ?? null,
   causationId: request.__causationId ?? null,
   depth: request.__depth ?? null,
   ```

### What is populated where (no fabrication)
| Path | correlationId | causationId | depth |
|------|---------------|-------------|-------|
| Webhook ingress (`POST /api/webhooks/:channel/:tenantId`) | minted UUID (= request id) | `null` | `0` |
| Platform routes, dynamic routes, every other HTTP path | `null` (not stamped) | `null` | `null` |

We DO NOT invent correlation IDs for non-webhook paths — there is no ingress correlation to join to, so NULL is the correct value. The `request.id` is already the gateway request id; reusing it as a fake correlation would create rows that join to nothing.

### Webhook-skip interaction (must verify, not assume)
If `GATEWAY_AUDIT_SKIP_WEBHOOKS=true` is set in an env, webhook paths are skipped entirely and no gateway audit row is written for them — so the correlation propagation has no row to populate. That is acceptable: the channel surface still carries the correlation chain. Default (`false`) gives a joinable gateway row. Document this in the service CLAUDE.md notes.

---

## Error scenarios & edge cases

1. **Pre-cutover rows (both surfaces, both backends)**: `correlation_id`/`causation_id` NULL, `depth` either `0` (channel Postgres default, channel Mongo absent→mapped 0/null) or NULL (gateway). Read mappers tolerate NULL → return `null`. No query path filters on these yet, so no breakage.
2. **Existing Postgres tables not picking up `CREATE TABLE IF NOT EXISTS` columns**: handled by explicit `ADD COLUMN IF NOT EXISTS` running every `ensure*Table` call (idempotent, cheap; `ensure*Once` guards re-run cost per pod lifetime).
3. **Mongo `depth` type drift**: envelope `transport.depth` is optional; `?? 0` for channel (ingress sets 0), `?? null` for gateway non-webhook. Mapper guards `typeof === "number"`.
4. **Interceptor without correlation context (non-webhook)**: `request.__correlationId` undefined → `?? null`. No throw.
5. **Channel envelope missing `transport`**: `envelope.transport?.depth ?? 0` — optional chaining guards a malformed envelope.
6. **Schema drift risk (the prior change's #1 risk)**: every column added is mirrored across shared interface / Mongo doc / Mongo schema index / Postgres DDL / Postgres INSERT / projection SELECT / row mapper. Task list enforces this per surface as a single atomic unit per backend.

## Files touched (summary)
- `packages/shared/src/audit.interfaces.ts` — `GatewayAuditEvent` optional fields.
- `packages/shared/src/audit-mongo-schema.ts` — 4 new index descriptors (2 channel, 2 gateway).
- `services/audit-service/src/common/channel-audit-projection.ts` — type, SELECT, mapper.
- `services/audit-service/src/common/gateway-audit-projection.ts` — type, SELECT, sql-row type, both mappers.
- `services/audit-service/src/modules/channel-audit/channel-audit.mongo.repository.ts` — doc.
- `services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts` — DDL + INSERT.
- `services/audit-service/src/modules/gateway-audit/gateway-audit.mongo.repository.ts` — doc.
- `services/audit-service/src/modules/gateway-audit/gateway-audit.postgres.repository.ts` — DDL + INSERT.
- `services/api-gateway/src/types/yoizen-request.ts` — request fields.
- `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts` — stamp request; `IPublishWebhookParams.request`.
- `services/api-gateway/src/modules/channels/webhooks.controller.ts` — pass request to publisher.
- `services/api-gateway/src/interceptors/audit.interceptor.ts` — read request fields into event.
