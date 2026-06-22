# Tasks: backend-aggregate-endpoints

Dependencies: Phase A (aggregator pipeline) must be complete before Phase B (connector-admin query). Endpoints 1 and 2 are independent of each other and of Phase A/B.

---

## Group 1: Shared Schema (no dependencies)

### T1 — Add `CONNECTOR_CALL_USAGE_SCHEMA_SQL` to `@yoizen/shared`

**File**: `packages/shared/src/connector-call-usage-schema.ts` (new)
**File**: `packages/shared/src/index.ts` (add export)

Add constant `CONNECTOR_CALL_USAGE_SCHEMA_SQL` with idempotent DDL:
- `connector_call_events` hypertable with columns: `tenant_id`, `ts`, `idempotency_key`, `adapter_id`, `endpoint_id` (nullable), `status` (int), `duration_ms` (int), `cache_result` (nullable text)
- Primary key: `(tenant_id, idempotency_key, ts)`
- `create_hypertable` with `partitioning_column => 'tenant_id'`, `number_partitions => 16`, `chunk_time_interval => INTERVAL '1 day'`
- Index: `idx_connector_call_events_tenant_adapter_ts ON (tenant_id, adapter_id, ts DESC)`
- Compression segmentby `tenant_id, adapter_id`, policy after 7 days
- Retention policy: 30 days
- All DDL uses `IF NOT EXISTS` / `if_not_exists => TRUE`

Export `CONNECTOR_CALL_USAGE_SCHEMA_SQL` from `index.ts`.

**Acceptance**: `bun run build` in `packages/shared` passes. Import resolves in a type-check-only file.

---

## Group 2: Endpoint 1 — channel-service summary (no external dependencies)

### T2 — Add `getSummary` to usage repository interface

**File**: `services/channel-service/src/modules/usage/usage.repository.interface.ts`

Add:
```typescript
export interface IUsageSummaryChannelRow {
  readonly channel: string;
  readonly direction: "ingress" | "egress" | "dlq";
  readonly events: number;
}

// Add to IUsageRepository:
getSummary(tenantId: string): Promise<readonly IUsageSummaryChannelRow[]>;
```

**Acceptance**: TypeScript compilation of the file succeeds.

### T3 — Implement `getSummary` in `UsagePostgresRepository`

**File**: `services/channel-service/src/modules/usage/usage.postgres.repository.ts`

Implement `getSummary` with two paths:
1. **Shared mode**: CAGG+tail query with `tenant_id = $1` predicate (see design §2.2).
2. **Per-tenant mode**: Same query without `tenant_id` predicate.

Pattern: same `sql.unsafe(query, params)` style as `getTotals`. Map raw rows to `IUsageSummaryChannelRow[]`.

**Acceptance**: Method compiles. The CAGG query uses `channel_events_hourly` for completed hours and `channel_events` raw table for the tail window.

### T4 — Add `getUsageSummary` to `UsageService` and `@Get('summary')` to controller

**Files**:
- `services/channel-service/src/modules/usage/usage.service.ts`
- `services/channel-service/src/modules/usage/usage.controller.ts`
- `services/channel-service/src/modules/usage/usage.dto.ts`

In `usage.dto.ts`, add:
```typescript
export interface IUsageSummaryResponse {
  windowHours: 24;
  total: { ingress: number; egress: number; dlq: number };
  byChannel: Array<{ channel: string; ingress: number; egress: number; dlq: number }>;
}
```

In `UsageService.getUsageSummary(tenantId)`:
- Call `this.repository.getSummary(tenantId)`
- Pivot rows: accumulate totals; build per-channel map initializing `{ ingress: 0, egress: 0, dlq: 0 }` per channel; merge direction counts
- Return `{ windowHours: 24, total, byChannel: [...map.values()] }`

In `UsageController`, add before existing `@Get('totals')`:
```typescript
@Get('summary')
async summary(@Headers(TENANT_HEADER) tenantId: string) {
  return this.usage.getUsageSummary(tenantId);
}
```

**Acceptance**: `GET /channels/usage/summary` returns `{ windowHours: 24, total: {...}, byChannel: [...] }`. Empty DB returns zeros and empty array (no 500).

---

## Group 3: Endpoint 2 — workflow-service summary (no external dependencies)

### T5 — Add new methods to `IWorkflowsRepository`

**File**: `services/workflow-service/src/modules/workflows/workflows.repository.interface.ts`

Add:
```typescript
countActiveDefinitions(tenantId: string): Promise<number>;
```

**Acceptance**: Interface file compiles.

### T6 — Implement `countActiveDefinitions` in `WorkflowsPostgresRepository`

**File**: Locate the postgres implementation of `IWorkflowsRepository` (likely `workflows.postgres.repository.ts`).

Implement using tagged template literal:
```typescript
async countActiveDefinitions(tenantId: string): Promise<number> {
  const sql = await this.sqlFor(tenantId);
  const [row] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM workflow_definitions
    WHERE deleted_at IS NULL
  `;
  return row?.total ?? 0;
}
```

**Acceptance**: Compiles. Returns 0 on empty tenant.

### T7 — Add new methods to `IExecutionsRepository` and implement them

**Files**:
- `services/workflow-service/src/modules/workflows/executions.repository.interface.ts`
- `services/workflow-service/src/modules/workflows/executions.postgres.repository.ts`

Add to interface:
```typescript
export interface ITopDefinitionRow {
  readonly definition_id: string;
  readonly name: string;
  readonly application: string;
  readonly count: number;
}

// Add to IExecutionsRepository:
countFailingByLastRun(tenantId: string): Promise<number>;
countFailingByWindow7d(tenantId: string, since: Date): Promise<number>;
countExecutionsByStatusSince(tenantId: string, statuses: string[], since: Date): Promise<number>;
topDefinitionsByExecutionCount(tenantId: string, since: Date, limit: number): Promise<ITopDefinitionRow[]>;
```

Implement each using tagged template literals. Refer to design §3.3 for exact SQL. Terminal status set for `countFailingByLastRun`: `['COMPLETED','FAILED','TIMED_OUT','CANCELLED','TERMINATED']`. Failing set: `['FAILED','TIMED_OUT','CANCELLED','TERMINATED']`.

**Acceptance**: All four methods compile. `countExecutionsByStatusSince` returns 0 on empty table. `topDefinitionsByExecutionCount` returns empty array when no executions exist.

### T8 — Add `getWorkflowsSummary` to `WorkflowsService` and controller route

**Files**:
- `services/workflow-service/src/modules/workflows/workflows.service.ts`
- `services/workflow-service/src/modules/workflows/workflows.controller.ts`

In `WorkflowsService`:
```typescript
async getWorkflowsSummary(tenantId: string): Promise<IWorkflowsSummaryResponse> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const window7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);

  const [total, failingByLastRun, failingByWindow7d,
         succeededToday, failedToday, succeeded7d, failed7d,
         topByRunCount] = await Promise.all([
    this.definitions.countActiveDefinitions(tenantId),
    this.executions.countFailingByLastRun(tenantId),
    this.executions.countFailingByWindow7d(tenantId, window7d),
    this.executions.countExecutionsByStatusSince(tenantId, ['COMPLETED'], today),
    this.executions.countExecutionsByStatusSince(tenantId, ['FAILED','TIMED_OUT'], today),
    this.executions.countExecutionsByStatusSince(tenantId, ['COMPLETED'], window7d),
    this.executions.countExecutionsByStatusSince(tenantId, ['FAILED','TIMED_OUT'], window7d),
    this.executions.topDefinitionsByExecutionCount(tenantId, window7d, 10),
  ]);

  return {
    definitions: { total, failingByLastRun, failingByWindow7d },
    executions: {
      today: { succeeded: succeededToday, failed: failedToday },
      window7d: { succeeded: succeeded7d, failed: failed7d },
    },
    topByRunCount: topByRunCount.map(r => ({
      definitionId: r.definition_id,
      name: r.name,
      application: r.application,
      count: r.count,
    })),
  };
}
```

In `WorkflowsController`, add `@Get('summary')` BEFORE `@Get('executions/counts')` (Nest route order matters):
```typescript
@Get('summary')
async getSummary(@TenantId() tenantId: string) {
  return this.workflowsService.getWorkflowsSummary(tenantId);
}
```

**Acceptance**: `GET /workflows/summary` returns the full shape with all fields. Empty tenant returns all zeros and empty `topByRunCount`.

---

## Group 4: Phase A — connector-runtime event ingestion (depends on T1)

### T9 — Extend `envelope-parser.ts` with connector-call parser

**File**: `services/usage-aggregator-service/src/modules/aggregator/envelope-parser.ts`

Add new exported types and function:
```typescript
export interface IConnectorCallEventRow {
  readonly ts: Date;
  readonly idempotencyKey: string;
  readonly adapterId: string;
  readonly endpointId: string | null;
  readonly status: number;
  readonly durationMs: number;
  readonly cacheResult: string | null;
}

export const CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint.";

export type ConnectorParseOutcome =
  | { readonly ok: true; readonly row: IConnectorCallEventRow }
  | { readonly ok: false; readonly reason: string };

export function parseConnectorCallEnvelope(
  data: Uint8Array,
  subject: string,
): ConnectorParseOutcome
```

Implementation:
1. Check `subject.includes(CONNECTOR_SUBJECT_MARKER)` → if not, return `{ ok: false, reason: 'non-connector-subject' }`.
2. JSON.parse the `Uint8Array` (same `TextDecoder` pattern as `parseEnvelope`).
3. Extract: `idempotencykey` (required string), `time` → `ts` (required, validate `!isNaN`), and from `data.payload` or top-level: `adapterId`, `endpointId` (nullable), `status` (required integer), `durationMs` (required integer), `cacheResult` (nullable string).
4. Return structured `IConnectorCallEventRow` or `{ ok: false, reason }`.

Looking at the event publisher, the payload fields are at the envelope's `data.payload` level. The envelope `type` is `"connector.endpoint_call.completed.v1"` and `accountid` is set to `tenantId`. Use `accountid` for early rejection if missing (optional — the tenant is recovered from the stream name).

**Acceptance**: New function is exported. Existing `parseEnvelope` function is NOT modified. File length stays under 300 lines.

### T10 — Add `batch-inserter.connector.ts`

**File**: `services/usage-aggregator-service/src/modules/aggregator/batch-inserter.connector.ts` (new)

```typescript
export async function insertConnectorCallBatch(
  sql: Sql,
  rows: readonly IConnectorCallEventRow[],
  tenantId: string,
): Promise<number>
```

Uses UNNEST insert pattern (identical structure to `batch-inserter.postgres.ts`):
- Arrays: `tenantIds`, `ts`, `idem`, `adapterId`, `endpointId`, `status`, `durationMs`, `cacheResult`
- `ON CONFLICT (tenant_id, idempotency_key, ts) DO NOTHING`

No per-tenant DB mode needed (usage DB is always shared single-database).

**Acceptance**: File compiles. Function returns 0 on empty rows array.

### T11 — Register `CONNECTOR_CALL_USAGE_SCHEMA_SQL` in usage-aggregator schema initializer

**File**: `services/usage-aggregator-service/src/providers/tenant-connection-manager.postgres.ts`

Import `CONNECTOR_CALL_USAGE_SCHEMA_SQL` from `@yoizen/shared`.

In `setSchemaInitializer`, apply it after the channel schema:
```typescript
this.setSchemaInitializer(async (tenantId, sql) => {
  const target = await this.resolveDatabaseTarget(tenantId);
  const channelSchema = target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase
    ? SHARED_CHANNEL_USAGE_SCHEMA_SQL
    : CHANNEL_USAGE_SCHEMA_SQL;
  await sql.unsafe(channelSchema);
  await sql.unsafe(CONNECTOR_CALL_USAGE_SCHEMA_SQL);
});
```

**Acceptance**: On service startup the `connector_call_events` table is created (or already exists). No error thrown on re-apply.

### T12 — Extend `AggregatorEngine` to handle connector-runtime events

**File**: `services/usage-aggregator-service/src/modules/aggregator/aggregator.engine.ts`

Changes:
1. Add `connectorBuffers = new Map<string, BatchBuffer<IConnectorCallEventRow>>()` (or unify via a discriminated buffer type — prefer a separate map for clarity).
2. At the start of `handleMessage()`, check `subject.includes(CONNECTOR_SUBJECT_MARKER)`:
   - If true: call `parseConnectorCallEnvelope(msg.data, msg.subject)`, extract `tenantId` from stream name, get/create connector buffer, enqueue row.
   - If false: existing channel path unchanged.
3. Add `getConnectorBufferFor(tenantId)` following the same lazy-init pattern as `getBufferFor`.
4. `onModuleDestroy`: drain connector buffers alongside channel buffers.
5. Metrics: add `aggregatorMetrics.recordPersisted` calls for connector events (use a new `direction` label like `"connector-call"` to avoid collision).

**Acceptance**: Engine handles both event types. Channel events still route to `channel_events`. Connector events route to `connector_call_events`. Skip reasons from `parseConnectorCallEnvelope` are acked silently (extend `SKIP_REASONS` set to include `"non-connector-subject"`).

---

## Group 5: Phase B — connector-admin usage query (depends on T1, T9, T10, T11, T12)

### T13 — Add `UsageTenantConnectionManager` to connector-admin

**File**: `services/connector-admin/src/providers/tenant-connection-manager.usage.ts` (new)

Implement as described in design §4.8. Read-only consumer: empty `setSchemaInitializer`. Same env var names as channel-service: `TENANT_POSTGRES_SHARED_USAGE_HOST`, `TENANT_POSTGRES_SHARED_USAGE_PORT`, `TENANT_POSTGRES_SHARED_USAGE_DB`, `TENANT_POSTGRES_SHARED_USAGE_USER`, `TENANT_POSTGRES_SHARED_USAGE_PASSWORD`.

Register in `services/connector-admin/src/providers/providers.module.ts` as a provider.

**Acceptance**: `UsageTenantConnectionManager` is injectable. Service starts without error when env vars are absent (default hostname used).

### T14 — Add `AdapterUsagePostgresRepository`

**File**: `services/connector-admin/src/modules/adapters/adapter-usage.postgres.repository.ts` (new)

Interface:
```typescript
export interface IAdapterUsageRow {
  readonly adapterId: string;
  readonly callCount: number;
  readonly errorCount: number;
}

export interface IAdapterUsageRepository {
  getTopByCallCount(tenantId: string, windowDays: number): Promise<readonly IAdapterUsageRow[]>;
}
```

Implementation queries `connector_call_events` via `sql.unsafe`:
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

Register repository token `ADAPTER_USAGE_REPOSITORY = Symbol('ADAPTER_USAGE_REPOSITORY')` and provide in `adapters.module.ts`.

**Acceptance**: Repository compiles. Query uses positional parameters (no string concatenation of tenant id). Returns empty array when table is empty or no data for window.

### T15 — Add `getUsage` to `AdaptersService` and `@Get('usage')` to controller

**Files**:
- `services/connector-admin/src/modules/adapters/adapters.service.ts`
- `services/connector-admin/src/modules/adapters/adapters.controller.ts`
- `services/connector-admin/src/modules/adapters/adapters.dto.ts`

In `adapters.dto.ts`, add:
```typescript
export class AdapterUsageQueryDto {
  @IsIn(['1d', '7d', '30d'])
  @IsOptional()
  window?: '1d' | '7d' | '30d';
}
```

In `AdaptersService.getUsage(tenantId, windowStr)`:
1. Parse window to days: `{ '1d': 1, '7d': 7, '30d': 30 }[windowStr ?? '7d']`.
2. Call `this.usageRepository.getTopByCallCount(tenantId, windowDays)`.
3. Collect `adapterIds` from result.
4. Load adapter names: call existing adapter repository `findByIds` or equivalent bulk method.
5. Merge names into response — adapters not found in registry get `name: null`.
6. Compute `errorRate = errorCount / callCount` (or `0` when `callCount === 0`).
7. Return `{ windowDays, topByCallCount: [...] }`.

In `AdaptersController`, add BEFORE `@Get(':id')`:
```typescript
@Get('usage')
async getUsage(
  @TenantId() tenantId: string,
  @Query() query: AdapterUsageQueryDto,
) {
  return this.adaptersService.getUsage(tenantId, query.window);
}
```

**Acceptance**: `GET /connectors/usage?window=7d` returns `{ windowDays: 7, topByCallCount: [...] }`. With no data returns empty array. With invalid `window` returns 400.

---

## Order of Execution

```
T1 (shared schema)
├── T2 → T3 → T4   [channel-service, independent]
├── T5 → T6        [workflow definitions, independent]
├── T7 → T8        [workflow executions, independent]
└── T9 → T10 → T11 → T12   [aggregator pipeline, sequential]
                   └── T13 → T14 → T15   [connector-admin query, sequential after T12]
```

T2–T4 and T5–T8 can run in parallel with T9–T12. T13–T15 must follow T12.
