# Design: backend-aggregate-endpoints

## 1. Overview

Three new read-only aggregate endpoints to support the admin-console dashboard:

| Endpoint | Service | Description |
|---|---|---|
| `GET /channels/usage/summary` | channel-service | 24 h totals and per-channel breakdown |
| `GET /workflows/summary` | workflow-service | Definitions, failing counts, execution stats, top runners |
| `GET /adapters/usage?window=7d` | connector-admin | Top adapters by call count from TimescaleDB |

The adapter endpoint requires a new event pipeline in `usage-aggregator-service` (NATS → TimescaleDB) before the query layer in connector-admin can exist.

---

## 2. Endpoint 1 — `GET /channels/usage/summary` (channel-service)

### 2.1 API Contract

```
GET /channels/usage/summary
Headers: x-yoizen-tenant: <tenantId>

200 OK
{
  "windowHours": 24,
  "total": { "ingress": 0, "egress": 0, "dlq": 0 },
  "byChannel": [
    { "channel": "whatsapp", "ingress": 0, "egress": 0, "dlq": 0 }
  ]
}
```

No query parameters. The window is always 24 h (fixed, non-configurable for this endpoint).
Returns empty arrays/zeros when there is no data — never 404.

Error codes:
- 400 if `x-yoizen-tenant` header is missing (handled by existing TenantGuard pattern)

### 2.2 Repository Method

New method `getSummary(tenantId: string): Promise<IUsageSummaryRow[]>` added to `IUsageRepository`.

The raw output type:
```typescript
interface IUsageSummaryRawRow {
  channel: string;
  direction: string;
  events: string | number;
}
```

SQL — shared mode (with `tenant_id` column):
```sql
WITH bounds AS (
  SELECT time_bucket('1 hour'::interval, NOW() - INTERVAL '10 minutes') AS tail_bucket,
         NOW() - INTERVAL '24 hours' AS from_ts
),
cagg AS (
  SELECT channel, direction, SUM(events)::BIGINT AS events
  FROM channel_events_hourly
  CROSS JOIN bounds
  WHERE tenant_id = $1
    AND bucket >= bounds.from_ts
    AND bucket < bounds.tail_bucket
  GROUP BY channel, direction
),
tail AS (
  SELECT channel, direction, COUNT(*)::BIGINT AS events
  FROM channel_events
  CROSS JOIN bounds
  WHERE tenant_id = $1
    AND ts >= GREATEST(bounds.from_ts, bounds.tail_bucket)
    AND ts < NOW()
  GROUP BY channel, direction
)
SELECT channel, direction, SUM(events)::BIGINT AS events
FROM (SELECT * FROM cagg UNION ALL SELECT * FROM tail) combined
GROUP BY channel, direction
```

Per-tenant mode: same query minus the `tenant_id = $1` predicates.

### 2.3 Service Layer

New method `getUsageSummary(tenantId: string)` in `UsageService`. Assembles the response DTO:
- Pivot raw rows into `total` (sum across all channels) and `byChannel` (per-channel object with three directions, defaulting to 0).
- Returns `{ windowHours: 24, total, byChannel }`.

### 2.4 Files Touched

| File | Change |
|---|---|
| `usage.repository.interface.ts` | Add `IUsageSummaryRow`, `getSummary()` to interface |
| `usage.postgres.repository.ts` | Implement `getSummary()` with CAGG+tail SQL (shared + per-tenant paths) |
| `usage.service.ts` | Add `getUsageSummary()` method |
| `usage.controller.ts` | Add `@Get('summary')` route |
| `usage.dto.ts` | Add response DTO types |

---

## 3. Endpoint 2 — `GET /workflows/summary` (workflow-service)

### 3.1 API Contract

```
GET /workflows/summary
Headers: x-yoizen-tenant: <tenantId>

200 OK
{
  "definitions": {
    "total": 0,
    "failingByLastRun": 0,
    "failingByWindow7d": 0
  },
  "executions": {
    "today": { "succeeded": 0, "failed": 0 },
    "window7d": { "succeeded": 0, "failed": 0 }
  },
  "topByRunCount": [
    { "definitionId": "x", "name": "Onboard", "application": "crm", "count": 42 }
  ]
}
```

`today` = calendar day in UTC (midnight to now). `window7d` = rolling 7-day window. Top list is capped at 10 entries.

### 3.2 Status Values

Temporal status values are stored as strings from `WorkflowExecutionStatus.name`. Terminal statuses: `COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCELLED`, `TERMINATED`, `CONTINUED_AS_NEW`. The "failing" set agreed upon: `FAILED` and `TIMED_OUT`.

### 3.3 New Repository Methods

All methods are added to `IExecutionsRepository` and implemented in `ExecutionsPostgresRepository`. They use tagged template literals, matching the existing code style.

**`countActiveDefinitions(tenantId: string): Promise<number>`**
```sql
SELECT COUNT(*)::int AS total
FROM workflow_definitions
WHERE deleted_at IS NULL
```

**`countFailingByLastRun(tenantId: string): Promise<number>`**

Finds, per definition, the most recent execution that has a terminal status; counts how many of those have a non-COMPLETED terminal status.

```sql
SELECT COUNT(*)::int AS count
FROM (
  SELECT DISTINCT ON (definition_id) status
  FROM workflow_executions
  WHERE status = ANY(ARRAY['COMPLETED','FAILED','TIMED_OUT','CANCELLED','TERMINATED'])
  ORDER BY definition_id, created_at DESC
) latest
WHERE status = ANY(ARRAY['FAILED','TIMED_OUT','CANCELLED','TERMINATED'])
```

Note: `CONTINUED_AS_NEW` is not terminal from the DB perspective — Temporal replaces the run, so status in DB will eventually resolve to one of the terminal values via `ExecutionProjectorService`.

**`countFailingByWindow7d(tenantId: string, since: Date): Promise<number>`**
```sql
SELECT COUNT(DISTINCT definition_id)::int AS count
FROM workflow_executions
WHERE status = ANY(ARRAY['FAILED','TIMED_OUT'])
  AND created_at >= ${since}
```

**`countExecutionsByStatusSince(tenantId: string, statuses: string[], since: Date): Promise<number>`**
```sql
SELECT COUNT(*)::int AS count
FROM workflow_executions
WHERE status = ANY(${sql.array(statuses)})
  AND created_at >= ${since}
```

**`topDefinitionsByExecutionCount(tenantId: string, since: Date, limit: number): Promise<ITopDefinitionRow[]>`**
```sql
SELECT
  e.definition_id,
  d.name,
  d.application,
  COUNT(*)::int AS count
FROM workflow_executions e
JOIN workflow_definitions d ON d.id = e.definition_id
WHERE e.created_at >= ${since}
  AND d.deleted_at IS NULL
GROUP BY e.definition_id, d.name, d.application
ORDER BY count DESC
LIMIT ${limit}
```

### 3.4 Service Layer

New method `getWorkflowsSummary(tenantId: string)` in `WorkflowsService`. Issues the five queries in parallel via `Promise.all`:

```typescript
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const window7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);

const [total, failingByLastRun, failingByWindow7d, succeededToday, failedToday,
       succeeded7d, failed7d, topByRunCount] = await Promise.all([
  this.definitions.countActiveDefinitions(tenantId),
  this.executions.countFailingByLastRun(tenantId),
  this.executions.countFailingByWindow7d(tenantId, window7d),
  this.executions.countExecutionsByStatusSince(tenantId, ['COMPLETED'], today),
  this.executions.countExecutionsByStatusSince(tenantId, ['FAILED','TIMED_OUT'], today),
  this.executions.countExecutionsByStatusSince(tenantId, ['COMPLETED'], window7d),
  this.executions.countExecutionsByStatusSince(tenantId, ['FAILED','TIMED_OUT'], window7d),
  this.executions.topDefinitionsByExecutionCount(tenantId, window7d, 10),
]);
```

### 3.5 Interface Changes

New interface in `executions.repository.interface.ts`:
```typescript
export interface ITopDefinitionRow {
  readonly definition_id: string;
  readonly name: string;
  readonly application: string;
  readonly count: number;
}
```

New methods added to `IExecutionsRepository`.

### 3.6 Definitions Repository Interface

`countActiveDefinitions` requires access to `workflow_definitions`. The method is added to `IWorkflowsRepository` / `WorkflowsPostgresRepository` (not executions — definitions are owned by the definitions repo). The service holds both `definitions` and `executions` repos and passes results to the assembler.

### 3.7 Files Touched

| File | Change |
|---|---|
| `executions.repository.interface.ts` | Add `ITopDefinitionRow` + 4 new methods |
| `executions.postgres.repository.ts` | Implement the 4 new methods |
| `workflows.repository.interface.ts` | Add `countActiveDefinitions()` |
| `workflows.postgres.repository.ts` | Implement `countActiveDefinitions()` |
| `workflows.service.ts` | Add `getWorkflowsSummary()` |
| `workflows.controller.ts` | Add `@Get('summary')` before existing `@Get(':id')` |

---

## 4. Endpoint 3 — `GET /adapters/usage` (connector-admin + usage-aggregator-service)

### 4.1 Architecture

Two-phase implementation:

**Phase A — Event ingestion** (`usage-aggregator-service`):
- Extend `envelope-parser.ts` with a new `parseConnectorCallEnvelope()` function that handles `connector-runtime.platform.endpoint` subjects.
- Extend `aggregator.engine.ts` to dispatch connector-runtime events to a separate insertion path.
- New hypertable `connector_call_events` in the shared usage TimescaleDB.
- New `batch-inserter.connector.ts` following the exact pattern of `batch-inserter.postgres.ts`.

**Phase B — Query layer** (`connector-admin`):
- New `UsageTenantConnectionManager` in connector-admin pointing to the shared usage TimescaleDB (`postgres-usage-shared`).
- New `AdapterUsagePostgresRepository` that queries `connector_call_events`.
- New `GET /connectors/usage` endpoint.

### 4.2 NATS Subject Filter

The connector-runtime event subject pattern:
```
evt.<tenant>.connector-runtime.platform.endpoint.system.endpoint_call_completed.v1
```

New marker constant (added alongside `CHANNEL_SUBJECT_MARKER` in the engine or a dedicated constant file):
```typescript
const CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint.";
```

In `envelope-parser.ts`, a new exported function `parseConnectorCallEnvelope()` is added rather than modifying the existing `parseEnvelope()`. The engine's `handleMessage()` is extended to check the subject and dispatch to the correct parser before reaching the existing channel-specific path.

### 4.3 New Hypertable: `connector_call_events`

Added as `CONNECTOR_CALL_USAGE_SCHEMA_SQL` in `packages/shared/src/connector-call-usage-schema.ts` and exported from `index.ts`.

Schema (shared/multi-tenant mode only — the usage DB is always single-database in current config):
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS connector_call_events (
  tenant_id       TEXT         NOT NULL,
  ts              TIMESTAMPTZ  NOT NULL,
  idempotency_key TEXT         NOT NULL,
  adapter_id      TEXT         NOT NULL,
  endpoint_id     TEXT,
  status          INTEGER      NOT NULL,
  duration_ms     INTEGER      NOT NULL,
  cache_result    TEXT,
  PRIMARY KEY (tenant_id, idempotency_key, ts)
);

SELECT create_hypertable(
  'connector_call_events',
  'ts',
  partitioning_column => 'tenant_id',
  number_partitions => 16,
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_connector_call_events_tenant_adapter_ts
  ON connector_call_events (tenant_id, adapter_id, ts DESC);

ALTER TABLE connector_call_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, adapter_id'
);

SELECT add_compression_policy(
  'connector_call_events',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'connector_call_events',
  INTERVAL '30 days',
  if_not_exists => TRUE
);
```

No continuous aggregate is needed — the query scans raw data for a rolling 7 d window which is always within the uncompressed chunk.

### 4.4 Schema Initialization

`UsageTenantConnectionManagerPostgres` in `usage-aggregator-service` currently calls `SHARED_CHANNEL_USAGE_SCHEMA_SQL`. It must also apply `CONNECTOR_CALL_USAGE_SCHEMA_SQL`:

```typescript
this.setSchemaInitializer(async (tenantId, sql) => {
  await sql.unsafe(SHARED_CHANNEL_USAGE_SCHEMA_SQL);
  await sql.unsafe(CONNECTOR_CALL_USAGE_SCHEMA_SQL);
});
```

Both scripts are idempotent (`IF NOT EXISTS`), so replaying on existing tenants is safe.

### 4.5 New Connector-Call Parser

```typescript
// envelope-parser.ts — new export
export interface IConnectorCallEventRow {
  readonly ts: Date;
  readonly idempotencyKey: string;
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: string | null;
}

const CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint.";

export function parseConnectorCallEnvelope(
  data: Uint8Array,
  subject: string,
): ParseOutcome<IConnectorCallEventRow> {
  if (!subject.includes(CONNECTOR_SUBJECT_MARKER)) {
    return { ok: false, reason: "non-connector-subject" };
  }
  // JSON.parse → extract adapterId, endpointId, status, durationMs, idempotencykey, time
  // Validate required fields → return ok/err
}
```

The `ParseOutcome` generic is expanded: `ParseOutcome<T>` where the existing `IChannelEventRow` path uses `ParseOutcome<IChannelEventRow>`.

### 4.6 Aggregator Engine Extension

`handleMessage()` inspects the subject BEFORE calling `parseEnvelope`:

```typescript
if (subject.includes(CONNECTOR_SUBJECT_MARKER)) {
  return this.handleConnectorMessage(msg, streamName);
}
// existing channel path
```

`handleConnectorMessage` follows the same pattern: parse → get/create buffer → enqueue. The connector buffer uses a separate `BatchBuffer<IConnectorCallEventRow>` keyed as `connector:${tenantId}`.

### 4.7 New Batch Inserter for Connector Events

`batch-inserter.connector.ts` — same UNNEST pattern as `batch-inserter.postgres.ts`:

```sql
INSERT INTO connector_call_events (
  tenant_id, ts, idempotency_key, adapter_id, endpoint_id, status, duration_ms, cache_result
)
SELECT * FROM UNNEST(
  $1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::text[]
)
ON CONFLICT (tenant_id, idempotency_key, ts) DO NOTHING
```

### 4.8 connector-admin: Usage DB Connection

New file `services/connector-admin/src/providers/tenant-connection-manager.usage.ts`:

```typescript
@Injectable()
export class UsageTenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";
    this.configure({
      serviceName: "postgres-usage",
      sharedHost: process.env.TENANT_POSTGRES_SHARED_USAGE_HOST
        ?? `postgres-usage-shared.support-services-${env}.svc.cluster.local`,
      sharedPort: Number(process.env.TENANT_POSTGRES_SHARED_USAGE_PORT) || undefined,
      sharedDatabaseMode: SharedTenantDatabaseMode.SingleDatabase,
      sharedDatabase: process.env.TENANT_POSTGRES_SHARED_USAGE_DB ?? "yoizen_usage",
      sharedUsername: process.env.TENANT_POSTGRES_SHARED_USAGE_USER
        ?? process.env.TENANT_POSTGRES_SHARED_USER,
      sharedPassword: process.env.TENANT_POSTGRES_SHARED_USAGE_PASSWORD
        ?? process.env.TENANT_POSTGRES_SHARED_PASSWORD,
    });
    // Schema init is read-only consumer — DDL applied by usage-aggregator-service
    this.setSchemaInitializer(async (_tenantId, _sql) => {});
  }
}
```

connector-admin is a **read-only consumer** of the usage DB. It does not apply DDL. The DDL is owned by `usage-aggregator-service`.

### 4.9 API Contract

```
GET /connectors/usage?window=7d
Headers: x-yoizen-tenant: <tenantId>

Query params:
  window  "1d" | "7d" | "30d"  (default: "7d")

200 OK
{
  "windowDays": 7,
  "topByCallCount": [
    {
      "adapterId": "abc",
      "name": "Stripe API",
      "callCount": 1500,
      "errorCount": 12,
      "errorRate": 0.008
    }
  ]
}
```

Error codes:
- 400 if `window` is not one of the accepted values.

### 4.10 Adapter Usage Repository

`adapter-usage.postgres.repository.ts` in connector-admin:

```sql
SELECT
  adapter_id,
  COUNT(*)::BIGINT AS call_count,
  COUNT(*) FILTER (WHERE status >= 400)::BIGINT AS error_count
FROM connector_call_events
WHERE tenant_id = $1
  AND ts >= NOW() - ($2 || ' days')::interval
GROUP BY adapter_id
ORDER BY call_count DESC
LIMIT 20
```

The `$2` window integer (1, 7, or 30) is interpolated safely as a SQL integer, not string concatenation: `sql.unsafe('...', [tenantId, windowDays])`.

After the query, the service loads adapter names via the existing `IAdaptersRepository.findByIds(tenantId, adapterIds)` method (or a new bulk lookup method if it doesn't exist), then merges names into the response. Adapters with no match in the registry (deleted adapters) are included with `name: null`.

### 4.11 Files Touched

| Service | File | Change |
|---|---|---|
| `@yoizen/shared` | `connector-call-usage-schema.ts` (new) | Schema DDL constant |
| `@yoizen/shared` | `index.ts` | Export new constant |
| `usage-aggregator-service` | `envelope-parser.ts` | Add `IConnectorCallEventRow`, `parseConnectorCallEnvelope()` |
| `usage-aggregator-service` | `batch-inserter.connector.ts` (new) | UNNEST insert for `connector_call_events` |
| `usage-aggregator-service` | `aggregator.engine.ts` | Subject dispatch + connector buffer handling |
| `usage-aggregator-service` | `tenant-connection-manager.postgres.ts` | Apply `CONNECTOR_CALL_USAGE_SCHEMA_SQL` |
| `connector-admin` | `tenant-connection-manager.usage.ts` (new) | Usage DB connection manager |
| `connector-admin` | `adapter-usage.postgres.repository.ts` (new) | Usage query |
| `connector-admin` | `adapters.service.ts` | Add `getUsage()` method |
| `connector-admin` | `adapters.controller.ts` | Add `@Get('usage')` route (before `@Get(':id')`) |
| `connector-admin` | `adapters.dto.ts` | Add `AdapterUsageQueryDto`, response types |
| `connector-admin` | `providers.module.ts` | Register `UsageTenantConnectionManager` |
| `connector-admin` | `adapters.module.ts` | Register usage repository |

---

## 5. Tenant Isolation Summary

| Service | Mechanism |
|---|---|
| channel-service | `tenant_id` column in shared DB; `x-yoizen-tenant` header → `TenantGuard` |
| workflow-service | Per-tenant DB (no `tenant_id` column); `@TenantId()` decorator → `TenantGuard` |
| connector-admin (usage) | `tenant_id` column in shared usage DB; same `TenantGuard` as existing endpoints |

---

## 6. ADR-001: Two separate "failing" counts for workflow definitions

**Context**: A workflow definition can be considered "failing" in two different ways: its most recent completed run failed, OR it had failures recently even if the latest run succeeded. Collapsing these into one number loses information useful to operators.

**Decision**: Expose both as separate fields — `failingByLastRun` (point-in-time health) and `failingByWindow7d` (trend-based alerting). Two repository queries, not one combined query.

**Consequences**: Two SQL round trips instead of one. At the expected scale (hundreds of definitions per tenant), both are index-range scans on `(definition_id, created_at)` and `(status, created_at)` respectively — sub-millisecond each. The service issues them in parallel.

**Alternatives rejected**:
- Single combined query with two CTEs: complicates the SQL and couples two semantically different concepts. Harder to test independently and harder to evolve.
- Single `failingCount` field: would require the UI to pick a definition and the product team has already agreed both dimensions are needed.

---

## 7. ADR-002: Option B — extend usage-aggregator-service rather than a new sidecar

**Context**: connector-runtime already publishes `connector.endpoint_call.completed.v1` events to JetStream. We need to aggregate them into TimescaleDB. Three options were considered: (A) connector-admin consumes NATS directly, (B) usage-aggregator-service is extended, (C) a new dedicated aggregator microservice.

**Decision**: Option B — extend `usage-aggregator-service`. It already manages the full lifecycle: stream discovery, per-tenant consumer management, batch buffering, and TimescaleDB insertion. The existing `MultiTenantConsumerManager` handles tenant stream reconciliation automatically, so connector-runtime events from new tenants are picked up without any provisioning changes.

**Consequences**: `usage-aggregator-service` now owns two event domains (channel + connector). The aggregator engine becomes slightly more complex (subject-based dispatch). The `BatchBuffer` and `BatchInserter` types need to be generalized or duplicated for the new row type.

**Alternatives rejected**:
- Option A (connector-admin consumes NATS directly): turns a CRUD service into a stateful consumer. connector-admin has no batch buffer, no consumer manager, no retry logic. It would need all of that added.
- Option C (new microservice): unnecessary operational overhead for what is a subject-filter + table extension. The existing aggregator infrastructure handles 100% of the required primitives.

---

## 8. ADR-003: connector-admin as read-only consumer of usage DB

**Context**: `GET /adapters/usage` lives in connector-admin. The raw usage data lives in the usage TimescaleDB owned by `usage-aggregator-service`. Two access patterns were available: (a) connector-admin queries the usage DB directly, (b) connector-admin calls an internal HTTP endpoint on usage-aggregator-service.

**Decision**: connector-admin connects directly to the shared usage TimescaleDB as a read-only consumer. DDL ownership remains with `usage-aggregator-service`.

**Consequences**: connector-admin gains a second DB dependency (usage TimescaleDB in addition to its existing per-tenant adapter DB). Environment variables for the usage DB must be propagated to the connector-admin Knative service. The `UsageTenantConnectionManager` in connector-admin skips DDL (empty schema initializer) — it never writes.

**Alternatives rejected**:
- Internal HTTP call from connector-admin to usage-aggregator-service: introduces a service-to-service dependency, requires auth headers, and would need a new query endpoint in the aggregator (which has no HTTP controller today). Two more files to add for the same result.

---

## 9. Cross-cutting Concerns

### 9.1 Backward Compatibility
All three endpoints are brand-new routes. No existing routes are modified. No breaking changes.

### 9.2 Migration / Schema Changes
- `connector_call_events` hypertable: created via the idempotent `CONNECTOR_CALL_USAGE_SCHEMA_SQL` script applied by `usage-aggregator-service` on startup. No manual migration step.
- No changes to existing `channel_events` or any workflow tables.

### 9.3 Historical Data
`connector_call_events` starts empty. The 7 d window will return sparse data until a week of events has accumulated. This is expected and acceptable — no backfill is required.

### 9.4 Performance
- channel-service summary: CAGG+tail pattern, O(chunks) scan. At 24 h window with 1 h chunks: 24 chunk reads max.
- workflow-service summary: 8 parallel queries, all on indexed columns. Each is O(log n) on the `created_at` B-tree index.
- adapter usage: raw hypertable scan on `(tenant_id, adapter_id, ts DESC)` index over 7 days of uncompressed chunks.

### 9.5 Verbose Logging
All new service methods log entry/exit with tenant id and result shape, following the `PinoLoggerService` pattern used throughout the codebase.
