# Tasks — `traceability-channel-chain-endpoint`

Ordered dependency chain: Task 1 → Task 2 → Task 3 → Task 4 → Task 5.
Each task is independently verifiable before the next starts.

---

## Task 1 — Narrow `buildChainTree` input type

**Description:**
Define and export `ChainInputEvent` in `build-chain-tree.ts`. Change the `toNode` helper and
`buildChainTree` to accept it. Verify that `IAuditEvent` structurally satisfies the new interface
(it does — confirmed by reading both files). Run existing specs.

**Files affected:**
- `services/audit-service/src/modules/audit/build-chain-tree.ts` (edit — lines 1 and 27 and 48)

**Exact changes:**
1. Remove `import type { IAuditEvent } from "./audit.repository.interface"` (line 1) — no longer
   needed in this file.
2. Add after the existing imports (before `MAX_CHAIN_NODES`):
   ```ts
   export interface ChainInputEvent {
     id: string;
     type: string;
     subject: string;
     causation_id: string | null | undefined;
     depth?: number;
     created_at: string;
   }
   ```
3. Change `function toNode(event: IAuditEvent): ChainNode` → `function toNode(event: ChainInputEvent): ChainNode`
4. Change `buildChainTree(events: IAuditEvent[], ...)` → `buildChainTree(events: ChainInputEvent[], ...)`

**No other files change** — `IAuditEvent` satisfies `ChainInputEvent` structurally, so
`audit.service.ts` line 186 (`buildChainTree(events, correlationId)`) compiles unchanged.

**Acceptance criteria:**
- [x] `ChainInputEvent` is exported from `build-chain-tree.ts`
- [x] `tsc --noEmit` passes for `audit-service` (no type errors)
- [x] Existing `build-chain-tree` Vitest specs pass: `bun test services/audit-service`
      (these exercise the `IAuditEvent` path and must remain green)
- [x] `AuditService.getChain` compiles unchanged (verified by `tsc`)

---

## Task 2 — `findByCorrelationId` repo method + `toChainInput` mapper

**Description:**
Add the read method to the interface and both repository implementations. Add the pure mapper
function. No write-path changes.

**Files affected:**
- `services/audit-service/src/modules/channel-audit/channel-audit.repository.interface.ts` (edit)
- `services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts` (edit)
- `services/audit-service/src/modules/channel-audit/channel-audit.mongo.repository.ts` (edit)
- `services/audit-service/src/common/channel-audit-projection.ts` (edit — add `toChainInput`)

**Exact changes:**

`channel-audit.repository.interface.ts` — add to `IChannelAuditRepository`:
```ts
findByCorrelationId(correlationId: string, tenantId: string): Promise<IStoredChannelEvent[]>;
```

`channel-audit.postgres.repository.ts` — implement method:
```ts
async findByCorrelationId(
  correlationId: string,
  tenantId: string,
): Promise<IStoredChannelEvent[]> {
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
Note: tenant scope is implicit — `tenantConnections.getConnection(tenantId)` returns the
per-tenant pool. No `AND tenant_id =` clause needed (same pattern as `getEventById`).

`channel-audit.mongo.repository.ts` — implement method:
```ts
async findByCorrelationId(
  correlationId: string,
  tenantId: string,
): Promise<IStoredChannelEvent[]> {
  const collection = await this.channelEventsCollection(tenantId);
  const docs = await collection
    .find({ correlation_id: correlationId })
    .sort({ created_at: 1 })
    .toArray();
  return docs.map((doc) => mapChannelAuditDoc(doc));
}
```

`channel-audit-projection.ts` — add mapper (after `mapChannelAuditDoc`):
```ts
import type { ChainInputEvent } from "../modules/audit/build-chain-tree";

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
Field mapping confirmed:
- `row.kind` → `type` (channel event type: `received` / `sent`)
- `row.natsSubject` → `subject` (NATS routing subject from `CHANNEL_AUDIT_SELECT_PROJECTION`
  alias `nats_subject AS "natsSubject"`)
- `row.causationId` → `causation_id` (camelCase alias; `null` for root events)
- `row.depth ?? 0` → `depth` (nullable in `IStoredChannelEvent` due to pre-cutover rows)
- `row.createdAt` → `created_at` (camelCase alias)

**Acceptance criteria:**
- [x] `IChannelAuditRepository` has `findByCorrelationId` method signature
- [x] Both Postgres and Mongo repos implement it (TypeScript will enforce via the interface)
- [x] `toChainInput` is exported from `channel-audit-projection.ts`
- [x] `tsc --noEmit` passes for `audit-service`
- [x] Both repo classes satisfy `IChannelAuditRepository` at compile time (tsc)

---

## Task 3 — `getChannelChain` service method + `GET chain/:correlationId` controller route

**Description:**
Add the service method that wires repo + mapper + tree assembler. Add the controller route,
strictly ABOVE the existing `@Get(":id")` route to prevent NestJS route shadowing.

**Files affected:**
- `services/audit-service/src/modules/channel-audit/channel-audit.service.ts` (edit)
- `services/audit-service/src/modules/channel-audit/channel-audit.controller.ts` (edit)

**Exact changes:**

`channel-audit.service.ts` — add imports and method:

Imports to add:
```ts
import { buildChainTree, type ChainTreeResult } from "../audit/build-chain-tree";
import { toChainInput } from "../../common/channel-audit-projection";
```

Method to add (after `getEventById`):
```ts
async getChannelChain(
  correlationId: string,
  tenantId: string,
): Promise<ChainTreeResult | null> {
  const rows = await this.channelAuditRepository.findByCorrelationId(correlationId, tenantId);
  return buildChainTree(rows.map(toChainInput), correlationId);
}
```

`channel-audit.controller.ts` — add route BEFORE the existing `@Get(":id")` at line 33.
Current file structure (lines 30-41):
```ts
  // line 33: @Get(":id")
  async getEvent(...)
```

Insert the new route ABOVE `@Get(":id")`:
```ts
  /**
   * Returns the causal-chain tree for a correlation_id.
   * Declared ABOVE @Get(":id") to prevent NestJS route shadowing.
   */
  @Get("chain/:correlationId")
  async getChannelChain(
    @TenantId() tenantId: string,
    @Param("correlationId") correlationId: string,
  ) {
    const chain = await this.channelAuditService.getChannelChain(correlationId, tenantId);
    return assertFoundOrThrow(chain, `Channel chain ${correlationId} not found`);
  }
```

The `@UseGuards(TenantGuard)` and `@TenantId()` are inherited at class level (line 9) — no
per-method guard needed, consistent with `AuditController.getChain`.

**Acceptance criteria:**
- [x] `GET /audit/channel-events/chain/:correlationId` returns `ChainTreeResult` for known correlation_id
- [x] `GET /audit/channel-events/chain/:correlationId` returns 404 when no rows found
- [x] `@Get("chain/:correlationId")` appears in the controller file BEFORE `@Get(":id")`
- [x] `tsc --noEmit` passes for `audit-service`

---

## Task 4 — Tests (Vitest)

**Description:**
Write unit tests for the service chain method, the 404 empty case, and both repo implementations.
Confirm existing `build-chain-tree` specs still pass.

**Files affected:**
- `services/audit-service/test/unit/channel-audit-chain.spec.ts` (new)
- `services/audit-service/test/unit/channel-audit-repo-correlation.spec.ts` (new)

**Test: `channel-audit-chain.spec.ts`**

```
describe("ChannelAuditService.getChannelChain")
  it("returns ChainTreeResult with root=received and node_count=3 for a 3-event chain")
    - 3 IStoredChannelEvent stubs: root (kind="received", causation_id=null, depth=0),
      mid (kind="processing", causation_id=root.id, depth=1),
      leaf (kind="sent", causation_id=mid.id, depth=2),
      all sharing the same correlation_id
    - Mock IChannelAuditRepository.findByCorrelationId to return these 3 rows
    - Call getChannelChain(correlationId, tenantId)
    - Assert result !== null
    - Assert result.node_count === 3
    - Assert result.root.type === "received"
    - Assert result.root.children[0].children[0].type === "sent"

  it("returns null when no rows found (→ 404 in controller)")
    - Mock repo to return []
    - Assert getChannelChain returns null
```

**Test: `channel-audit-repo-correlation.spec.ts`**

```
describe("ChannelAuditPostgresRepository.findByCorrelationId")
  it("calls sql with correlation_id filter and ORDER BY created_at ASC")
    - Mock sql template literal; capture the generated query text
    - Assert query includes correlation_id param
    - Assert query includes "ORDER BY created_at ASC"

describe("ChannelAuditMongoRepository.findByCorrelationId")
  it("calls collection.find with { correlation_id } and sort { created_at: 1 }")
    - Mock collection.find().sort().toArray()
    - Assert find was called with { correlation_id: "test-id" }
    - Assert sort was called with { created_at: 1 }
```

**Regression:**
```
bun test services/audit-service
```
Confirms both the new tests and the existing `build-chain-tree` specs (which exercise `IAuditEvent`
path through `buildChainTree`) are green.

**Acceptance criteria:**
- [x] New chain service test passes (3-node chain + empty/null case)
- [x] New repo tests pass (Postgres + Mongo filter + sort assertions)
- [x] All existing `audit-service` unit tests remain green
- [x] `build-chain-tree` specs specifically pass (regression on `IAuditEvent` path)

---

## Task 5 — Documentation

**Description:**
Update two documentation files to record the new endpoint.

**Files affected:**
- `DOCS/messaging/envelope.md` (edit — §8 queryable chain section)
- `services/audit-service/CLAUDE.md` (edit — API Endpoints table)

**`DOCS/messaging/envelope.md` §8:**
Add a row or subsection for the channel chain endpoint:
```
GET /audit/channel-events/chain/:correlationId

Returns the causal-chain tree (ChainTreeResult) for all channel_events sharing
the given correlation_id. Tenant-scoped (X-Tenant-Id header required).

Response shape: same as GET /audit/events/chain/:correlationId.

- 200: ChainTreeResult JSON
- 404: no channel events found for this correlation_id
```

**`services/audit-service/CLAUDE.md` API Endpoints table:**
Add row to the existing table (currently has 3 rows under `### API Endpoints`):
```markdown
| `GET` | `/audit/channel-events/chain/:correlationId` | Causal-chain tree for channel events by correlation_id. Returns `ChainTreeResult` or 404. |
```

**Acceptance criteria:**
- [x] `DOCS/messaging/envelope.md` §8 includes the new channel chain endpoint
- [x] `services/audit-service/CLAUDE.md` API Endpoints table includes the new row
- [x] No other documentation files modified

---

## Dependency Order

```
Task 1 (type narrowing)
  └─► Task 2 (repo method + mapper — imports ChainInputEvent from Task 1)
        └─► Task 3 (service + controller — imports toChainInput from Task 2, buildChainTree from Task 1)
              └─► Task 4 (tests — tests Task 3 behavior)
                    └─► Task 5 (docs — documents the endpoint added in Task 3)
```

## Review Workload Forecast

- Estimated changed lines: ~120 lines (excluding tests and docs)
- New files: 2 test files
- Modified files: 6 source files
- Chained PRs recommended: No (well under 400-line budget)
- Decision needed before apply: No
