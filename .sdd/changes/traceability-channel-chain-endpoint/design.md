# Design — `traceability-channel-chain-endpoint`

## Problem Statement

`channel_events` already stores `correlation_id`, `causation_id`, and `depth` (persisted since
`traceability-audit-persist-ids`), but there is no read endpoint to assemble those rows into a
causal-chain tree. The shared `buildChainTree` assembler is currently locked to `IAuditEvent`,
preventing reuse against channel rows. This change adds the missing read path: one interface
narrowing + one repo method + one service method + one controller route.

## Solution Overview (5 sub-changes)

### Sub-change 1 — Narrow `buildChainTree` input type

**File:** `services/audit-service/src/modules/audit/build-chain-tree.ts`

Current signatures (confirmed from file):
```ts
// line 27 — toNode (private)
function toNode(event: IAuditEvent): ChainNode

// line 48 — buildChainTree (exported)
export function buildChainTree(
  events: IAuditEvent[],
  correlationId: string,
): ChainTreeResult | null
```

New signatures after this sub-change:
```ts
export interface ChainInputEvent {
  id: string;
  type: string;
  subject: string;
  causation_id: string | null | undefined;
  depth?: number;
  created_at: string;
}

function toNode(event: ChainInputEvent): ChainNode

export function buildChainTree(
  events: ChainInputEvent[],
  correlationId: string,
): ChainTreeResult | null
```

**Structural compatibility check — does `IAuditEvent` satisfy `ChainInputEvent`?**

`IAuditEvent` (from `audit.repository.interface.ts`):
```ts
interface IAuditEvent {
  id: string;                         // ✅ matches ChainInputEvent.id
  type: string;                       // ✅ matches ChainInputEvent.type
  payload: Record<string, unknown>;   // extra field — OK (structural typing)
  metadata: Record<string, unknown>;  // extra field — OK
  subject: string;                    // ✅ matches ChainInputEvent.subject
  created_at: string;                 // ✅ matches ChainInputEvent.created_at
  correlation_id?: string | null;     // extra field — OK
  causation_id?: string | null;       // ✅ matches ChainInputEvent.causation_id
  depth?: number;                     // ✅ matches ChainInputEvent.depth
}
```

**Result: `IAuditEvent` fully satisfies `ChainInputEvent`.** No adjustment needed. Existing
callers in `AuditService.getChain` (`audit.service.ts:186`) will compile unchanged.

### Sub-change 2 — `findByCorrelationId` + mapper

**Interface** (`channel-audit.repository.interface.ts`):
```ts
findByCorrelationId(correlationId: string, tenantId: string): Promise<IStoredChannelEvent[]>;
```

**Postgres** (`channel-audit.postgres.repository.ts`):
```ts
async findByCorrelationId(correlationId: string, tenantId: string): Promise<IStoredChannelEvent[]> {
  await this.ensureChannelEventsTable(tenantId);
  const sql = this.tenantConnections.getConnection(tenantId);
  return sql<IStoredChannelEvent[]>`
    SELECT ${sql.unsafe(CHANNEL_AUDIT_SELECT_PROJECTION)}
    FROM channel_events
    WHERE correlation_id = ${correlationId}
    ORDER BY created_at ASC
  `;
}
```
Uses the composite index `idx_ch_evt_correlation ON channel_events (correlation_id, depth, created_at)` — already present.

**Mongo** (`channel-audit.mongo.repository.ts`):
```ts
async findByCorrelationId(correlationId: string, tenantId: string): Promise<IStoredChannelEvent[]> {
  const collection = await this.channelEventsCollection(tenantId);
  const docs = await collection
    .find({ correlation_id: correlationId })
    .sort({ created_at: 1 })
    .toArray();
  return docs.map((doc) => mapChannelAuditDoc(doc));
}
```
Uses `idx_ch_evt_correlation` Mongo index — already present.

**Mapper** (pure function in `channel-audit-projection.ts` or colocated in the service file):
```ts
export function toChainInput(row: IStoredChannelEvent): ChainInputEvent {
  return {
    id: row.id,
    type: row.kind,
    subject: row.natsSubject,
    causation_id: row.causationId,
    depth: row.depth ?? 0,
    created_at: row.createdAt,
  };
}
```

Field mapping rationale:
| `ChainInputEvent` field | `IStoredChannelEvent` field | Notes |
|---|---|---|
| `id` | `row.id` | Direct |
| `type` | `row.kind` | Channel events use `kind` (received/sent); maps to the tree node's `type` |
| `subject` | `row.natsSubject` | NATS routing subject (e.g. `INGRESS-tenant1.channel.telegram.received`) |
| `causation_id` | `row.causationId` | camelCase alias from `CHANNEL_AUDIT_SELECT_PROJECTION` |
| `depth` | `row.depth ?? 0` | Nullable in `IStoredChannelEvent` (pre-cutover rows); default 0 |
| `created_at` | `row.createdAt` | camelCase alias |

### Sub-change 3 — `getChannelChain` service method + controller route

**Service** (`channel-audit.service.ts`) — mirror of `AuditService.getChain` (line 178):
```ts
async getChannelChain(
  correlationId: string,
  tenantId: string,
): Promise<ChainTreeResult | null> {
  const rows = await this.channelAuditRepository.findByCorrelationId(correlationId, tenantId);
  return buildChainTree(rows.map(toChainInput), correlationId);
}
```

**Controller** (`channel-audit.controller.ts`) — mirror of `AuditController.getChain` (lines 34-41).

CRITICAL: current controller has `@Get(":id")` at line 33. The new `chain/:correlationId` route
MUST be declared ABOVE it to prevent NestJS route shadowing (the string `"chain"` would otherwise
match the `":id"` param):

```ts
// ABOVE @Get(":id")
@Get("chain/:correlationId")
async getChannelChain(
  @TenantId() tenantId: string,
  @Param("correlationId") correlationId: string,
) {
  const chain = await this.channelAuditService.getChannelChain(correlationId, tenantId);
  return assertFoundOrThrow(chain, `Channel chain ${correlationId} not found`);
}
```

Final route: `GET /audit/channel-events/chain/:correlationId`
(controller prefix is `audit/channel-events` — confirmed from `@Controller("audit/channel-events")` at line 8).

### Sub-change 4 — Tests (Vitest)

- Unit: 3 channel events with same `correlation_id`, causal chain `received → intermediate → sent` → `getChannelChain` returns `ChainTreeResult` with `root.type === "received"`, `node_count === 3`.
- Unit: empty repo result → `getChannelChain` returns `null` → controller returns 404.
- Repo unit: `findByCorrelationId` calls correct query with `correlation_id` filter, `ORDER BY created_at ASC` (Postgres), `.sort({ created_at: 1 })` (Mongo).
- Regression: run existing `build-chain-tree` specs to confirm `IAuditEvent` path still passes.

### Sub-change 5 — Docs

- `DOCS/messaging/envelope.md` §8: add new endpoint entry.
- `services/audit-service/CLAUDE.md` API Endpoints table: add the `GET /audit/channel-events/chain/:correlationId` row.

## Data Flow

```
Client
  │
  │  GET /audit/channel-events/chain/:correlationId
  │  Header: X-Tenant-Id: {tenantId}
  ▼
ChannelAuditController
  │  @Get("chain/:correlationId")  [declared above @Get(":id")]
  │  @UseGuards(TenantGuard)       [class-level — inherited]
  │  @TenantId() tenantId
  ▼
ChannelAuditService.getChannelChain(correlationId, tenantId)
  │
  ├─► IChannelAuditRepository.findByCorrelationId(correlationId, tenantId)
  │     │
  │     ├─ [Postgres] SELECT ... FROM channel_events
  │     │             WHERE correlation_id = $1 ORDER BY created_at ASC
  │     │             → IStoredChannelEvent[]
  │     │
  │     └─ [Mongo]   collection.find({ correlation_id }).sort({ created_at: 1 })
  │                  → mapChannelAuditDoc → IStoredChannelEvent[]
  │
  ├─► rows.map(toChainInput)   → ChainInputEvent[]
  │
  └─► buildChainTree(events: ChainInputEvent[], correlationId)
        │
        ├─ empty → null → controller → assertFoundOrThrow → 404
        │
        └─ non-empty → ChainTreeResult
              {
                correlation_id, root, node_count,
                max_depth, truncated, synthetic_root,
                orphans, extra_roots
              }
              → 200 JSON response
```

## Non-Goals (Scope Fence)

- NO changes to NATS consumers, durables, or stream configuration.
- NO changes to any write-path (insert methods).
- NO database migration — `correlation_id`, `causation_id`, `depth` columns and indexes exist.
- NO new NestJS module or controller file.
- NO changes to `audit-service/src/modules/audit/*` beyond the `buildChainTree` type narrowing.
- NO changes to `gateway-audit` module.
- NO changes to `api-gateway` service.
