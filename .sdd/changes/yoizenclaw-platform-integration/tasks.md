# Tasks: Integración de YoizenClaw con la Plataforma Yoizen

**Total Effort**: 62 puntos | **Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 4
**TDD**: enabled | **wdocs compliance**: evt.{tenant}.yoizenclaw.{action}.v1

## Phase 1: Foundation - Schema, Constants & Envelope

### 1.1 Database Migration

- [x] 1.1.1 [RED] Write failing test: Alembic migration creates tenant_id columns with NOT NULL + index `[S]`
- [x] 1.1.2 [GREEN] Create `alembic/versions/001_add_tenant_id.py` con columnas e índices compuestos `[M]`
- [x] 1.1.3 [REFACTOR] Verify composite indexes optimize tenant-scoped queries `[S]`

### 1.2 Shared Constants (wdocs/01 subjects)

- [x] 1.2.1 [RED] Write failing test: `buildYoizenClawSubject()` produces `evt.{tenant}.yoizenclaw.{action}.v1` `[XS]`
- [x] 1.2.2 [GREEN] Add `YOIZENCLAW_*` constants to `packages/shared/src/constants.ts` with wdocs subjects `[S]`
- [x] 1.2.3 [GREEN] Export constants from `packages/shared/src/index.ts` `[XS]`
- [x] 1.2.4 [RED] Write failing test: `extractTenantId()` extracts from x-yoizen-tenant header `[XS]`
- [x] 1.2.5 [GREEN] Create `shared/types/python/tenant.py` with extraction + validation `[S]`

### 1.3 CloudEvents Envelope Builder (wdocs/02)

- [x] 1.3.1 [RED] Write failing test: `build_internal_agent_envelope()` produces valid CloudEvents structure `[S]`
- [x] 1.3.2 [GREEN] Create `shared/types/python/envelope.py` with CloudEventEnvelope dataclass `[M]`
- [x] 1.3.3 [RED] Write failing test: Envelope includes transport.protocol="internal", depth, agent_id `[S]`
- [x] 1.3.4 [GREEN] Implement transport metadata population in envelope builder `[S]`
- [x] 1.3.5 [RED] Write failing test: `validate_envelope()` rejects missing required fields `[S]`
- [x] 1.3.6 [GREEN] Implement envelope validation function `[S]`

### 1.4 Subject Helper (wdocs/01)

- [x] 1.4.1 [RED] Write failing test: `build_subject("acme", "config_sync")` → `evt.acme.yoizenclaw.config_sync.v1` `[XS]`
- [x] 1.4.2 [GREEN] Create `shared/types/python/subjects.py` with YOIZENCLAW_ACTIONS map + helpers `[S]`
- [x] 1.4.3 [RED] Write failing test: `extract_tenant_from_subject("evt.acme.yoizenclaw.online.v1")` → "acme" `[XS]`
- [x] 1.4.4 [GREEN] Implement `extract_tenant_from_subject()` parsing `[S]`

## Phase 2: Core Runtime - Multi-tenant Python

### 2.1 Database Layer (tenant_id)

- [x] 2.1.1 [RED] Write failing test: `save_job()` includes tenant_id in INSERT `[S]`
- [x] 2.1.2 [GREEN] Modify `memory_postgres.py` - add tenant_id to `save_job()` `[S]`
- [x] 2.1.3 [RED] Write failing test: `get_job()` filters by tenant_id + job_id `[S]`
- [x] 2.1.4 [GREEN] Modify `memory_postgres.py` - add WHERE tenant_id to `get_job()` `[S]`
- [x] 2.1.5 [RED] Write failing test: `get_all_jobs()` only returns jobs for tenant `[S]`
- [x] 2.1.6 [GREEN] Modify `memory_postgres.py` - add WHERE tenant_id to `get_all_jobs()` `[S]`
- [x] 2.1.7 [RED] Write failing test: `delete_job()` only deletes jobs for tenant `[S]`
- [x] 2.1.8 [GREEN] Modify `memory_postgres.py` - add tenant_id filter to `delete_job()` `[S]`
- [x] 2.1.9 [RED] Write failing test: Job executions filter by tenant_id `[S]`
- [x] 2.1.10 [GREEN] Modify job_executions methods with tenant_id `[M]`

### 2.2 Depth Tracker (wdocs/03 anti-loop)

- [x] 2.2.1 [RED] Write failing test: `enforce_depth_limit()` raises DepthExceededError at depth=5 `[S]`
- [x] 2.2.2 [GREEN] Create `src/shared/depth/tracker.py` with `enforce_depth_limit()` + `increment_depth()` `[S]`
- [x] 2.2.3 [RED] Write failing test: `increment_depth()` sets causation_id from parent envelope id `[S]`
- [x] 2.2.4 [GREEN] Implement depth increment with causation chain `[S]`

### 2.3 Claim Check Resolver (wdocs/04)

- [x] 2.3.1 [RED] Write failing test: `check_payload_size()` returns inline=true for 100KB, inline=false for 300KB `[S]`
- [x] 2.3.2 [GREEN] Create `src/shared/claim_check/resolver.py` with threshold 256KB `[S]`
- [x] 2.3.3 [RED] Write failing test: `store_payload()` stores to Object Store and returns nats:// ref `[S]`
- [x] 2.3.4 [GREEN] Implement `store_payload()` with NATS Object Store put `[S]`
- [x] 2.3.5 [RED] Write failing test: `resolve_payload()` retrieves from Object Store + validates checksum `[S]`
- [x] 2.3.6 [GREEN] Implement `resolve_payload()` with sha256 checksum verification `[M]`

### 2.4 NATS Bridge Rewrite (wdocs/01,02,03)

- [x] 2.4.1 [RED] Write failing test: `RuntimeNatsBridge` extracts tenant from subject via `extract_tenant_from_subject()` `[S]`
- [x] 2.4.2 [GREEN] Modify `nats_bridge.py` - replace flat subjects with `evt.{tenant}.yoizenclaw.>` wildcard `[M]`
- [x] 2.4.3 [RED] Write failing test: Bridge validates CloudEvents envelope on inbound messages `[S]`
- [x] 2.4.4 [GREEN] Add envelope validation to all inbound handlers `[S]`
- [x] 2.4.5 [RED] Write failing test: Bridge enforces depth limit before processing `[S]`
- [x] 2.4.6 [GREEN] Integrate `enforce_depth_limit()` in message handler pipeline `[S]`
- [x] 2.4.7 [RED] Write failing test: Outbound messages use envelope with incremented depth `[S]`
- [x] 2.4.8 [GREEN] Integrate `increment_depth()` + `build_internal_agent_envelope()` for outbound `[M]`
- [x] 2.4.9 [RED] Write failing test: Large outbound payloads go to Claim Check `[S]`
- [x] 2.4.10 [GREEN] Integrate `check_payload_size()` + `store_payload()` in outbound path `[M]`
- [x] 2.4.11 [RED] Write failing test: Bridge subscribes to `evt.{tenant}.yoizenclaw.>` using TENANT_ID env var `[S]`
- [x] 2.4.12 [GREEN] Modify `start()` to use dynamic subject with tenant from env `[M]`

### 2.5 Agent Manager

- [x] 2.5.1 [RED] Write failing test: Agent cache keyed by (tenant_id, agent_id) `[S]`
- [x] 2.5.2 [GREEN] Modify `agent_manager.py` - cache key includes tenant `[M]`
- [x] 2.5.3 [RED] Write failing test: Cache invalidation only affects specific tenant `[S]`
- [x] 2.5.4 [GREEN] Implement per-tenant invalidation in `reload()` `[S]`

### 2.6 Settings

- [x] 2.6.1 [GREEN] Add `TENANT_ID: str` to `shared/config/settings.py` from env var `[XS]`

## Phase 3: Metrics & Observability (wdocs/06)

### 3.1 YoizenClaw Metrics

- [x] 3.1.1 [RED] Write failing test: `yoizenclaw.ingress.published` counter increments on publish `[S]`
- [x] 3.1.2 [GREEN] Create `src/shared/metrics/yoizenclaw_metrics.py` with OTEL counters + histograms `[M]`
- [x] 3.1.3 [RED] Write failing test: `yoizenclaw.agent.depth_exceeded` counter increments on rejection `[S]`
- [x] 3.1.4 [GREEN] Integrate depth_exceeded metric in depth tracker `[S]`
- [x] 3.1.5 [GREEN] Add `yoizenclaw.claimcheck.stored` and `yoizenclaw.claimcheck.inline` metrics `[S]`

### 3.2 Structured Logging (wdocs/06 PII policy)

- [x] 3.2.1 [RED] Write failing test: Log entries include tenant, traceid, causation_id fields `[S]`
- [x] 3.2.2 [GREEN] Configure structured logging with tenant tags in bridge startup `[S]`
- [x] 3.2.3 [RED] Write failing test: data.payload is NEVER logged (PII policy) `[S]`
- [x] 3.2.4 [GREEN] Add log sanitizer that strips data.payload before logging `[S]`

## Phase 4: Admin Service (NestJS)

### 4.1 Tenant-aware Repositories

- [x] 4.1.1 [RED] Write failing test: `GET /admin/agents` filters by tenant header `[S]`
- [x] 4.1.2 [GREEN] Modify `AgentsController` - extract tenant from x-yoizen-tenant header `[S]`
- [x] 4.1.3 [GREEN] Modify `AgentsRepository` - add tenant_id to all queries `[M]`

### 4.2 Runtime Provisioning

- [x] 4.2.1 [RED] Write failing test: Check runtime returns correct status `[S]`
- [x] 4.2.2 [GREEN] Implement `RuntimeService.checkRuntimeStatus()` `[M]`
- [x] 4.2.3 [RED] Write failing test: First agent triggers provisioning via Tenant Service `[S]`
- [x] 4.2.4 [GREEN] Modify `AgentsService.create()` - call Tenant Service if no runtime `[M]`

### 4.3 Envelope Publishing (wdocs/02,03)

- [x] 4.3.1 [RED] Write failing test: Agent publish sends CloudEvents envelope to `evt.{tenant}.yoizenclaw.config_sync.v1` `[S]`
- [x] 4.3.2 [GREEN] Implement `publishAgentConfig(tenantId, agentId)` with envelope builder `[M]`

### 4.4 Admin Logging (wdocs/06)

- [x] 4.4.1 [GREEN] Add structured logging with tenant/traceid to Admin Service methods `[S]`
- [x] 4.4.2 [RED] Write failing test: data.payload never appears in Admin Service logs `[S]`

## Phase 5: Tenant Service - NATS Provisioning (wdocs/01,04,05)

### 5.1 NATS Account Provider

- [x] 5.1.1 [RED] Write failing test: `createAccount("acme")` creates NATS Account with restrictive ACLs `[S]`
- [x] 5.1.2 [GREEN] Create `services/tenant-service/src/providers/nats.provider.ts` with Account CRUD `[M]`
- [x] 5.1.3 [RED] Write failing test: ACLs block cross-tenant publish `[S]`
- [x] 5.1.4 [GREEN] Implement ACL rules per wdocs/05 (publish from services, subscribe from runtime) `[M]`

### 5.2 Stream & Object Store Provisioning

- [x] 5.2.1 [RED] Write failing test: `createStream("acme", "pro")` creates INGRESS-acme with 5GB limit `[S]`
- [x] 5.2.2 [GREEN] Implement stream creation with tier-based limits `[M]`
- [x] 5.2.3 [RED] Write failing test: `createObjectStore("acme")` creates PAYLOAD-acme with TTL `[S]`
- [x] 5.2.4 [GREEN] Implement Object Store bucket creation with stream-aligned TTL `[M]`

### 5.3 Knative Service Provisioning

- [x] 5.3.1 [RED] Write failing test: `POST /tenants/:name/provision-yoizenclaw` creates Knative Service `[S]`
- [x] 5.3.2 [GREEN] Add endpoint to `TenantsController` `[S]`
- [x] 5.3.3 [GREEN] Implement `TenantsService.provisionYoizenClaw()` orchestrating NATS + K8s `[M]`
- [x] 5.3.4 [RED] Write failing test: Knative Service has TENANT_ID + NATS credentials in env vars `[S]`
- [ ] 5.3.5 [GREEN] Create Knative Service YAML generation with tenant env vars `[M]`

## Phase 6: Deployment - Helm Charts

- [ ] 6.1 [RED] Write test: Helm template generates Knative Service correctly `[S]`
- [ ] 6.2 [GREEN] Create `infrastructure/base/yoizenclaw-runtime/Chart.yaml` `[XS]`
- [ ] 6.3 [GREEN] Create `values.yaml` with resource limits, env vars, NATS config `[S]`
- [ ] 6.4 [GREEN] Create `templates/knative-service.yaml` with tenant variables `[M]`
- [ ] 6.5 [GREEN] Create `templates/configmap.yaml` `[S]`
- [ ] 6.6 [GREEN] Create `templates/secret.yaml` for NATS credentials `[S]`

## Phase 7: UI - Admin Console

- [ ] 7.1 [RED] Write test: AgentsList component renders table correctly `[S]`
- [ ] 7.2 [GREEN] Create `services/admin-console/src/app/agents/agents-list/` component `[M]`
- [ ] 7.3 [GREEN] Create `AgentService` with HTTP methods `[S]`
- [ ] 7.4 [RED] Write test: AgentEditor form validates required fields `[S]`
- [ ] 7.5 [GREEN] Create `services/admin-console/src/app/agents/agent-editor/` component `[M]`
- [ ] 7.6 [GREEN] Add "Agents" to navigation menu `[XS]`
- [ ] 7.7 [GREEN] Create routes for /agents in Angular router `[XS]`

## Phase 8: Integration & E2E Testing

### Integration Tests

- [ ] 8.1 Integration test: Multi-tenant data isolation (tenant A cannot see tenant B data) `[M]`
- [ ] 8.2 Integration test: NATS subject routing by tenant with envelope `[M]`
- [ ] 8.3 Integration test: CloudEvents envelope round-trip (publish → receive → reply) `[M]`
- [ ] 8.4 Integration test: Claim Check end-to-end (store >256KB + resolve + checksum) `[M]`
- [ ] 8.5 Integration test: Depth enforcement sends to DLQ at depth=5 `[M]`
- [ ] 8.6 Integration test: NATS Account ACLs block cross-tenant publish `[M]`
- [ ] 8.7 Integration test: Structured logging includes tenant/traceid, never data.payload `[S]`

### E2E Tests

- [ ] 8.8 E2E test: Create agent from Admin Console → runtime receives config via envelope `[M]`
- [ ] 8.9 E2E test: Verify data isolation between tenants `[M]`
- [ ] 8.10 E2E test: Claim Check for agent response > 256KB `[M]`

## Phase 9: Documentation & Cleanup

- [ ] 9.1 Update `applications/yoizenclaw-application/README.md` with multi-tenancy + wdocs `[S]`
- [ ] 9.2 Update `services/yoizenclaw-admin-service/AGENTS.md` `[S]`
- [ ] 9.3 Document Helm chart in `infrastructure/base/yoizenclaw-runtime/README.md` `[S]`
- [ ] 9.4 Add JSDoc to new public methods `[XS]`
- [ ] 9.5 Verify all tests pass `[S]`
- [ ] 9.6 Verify linting without errors `[XS]`

## Task Details by File

| File | Tasks | Phase |
|------|-------|-------|
| `alembic/versions/001_add_tenant_id.py` | 1.1.2 | 1 |
| `packages/shared/src/constants.ts` | 1.2.2, 1.2.3 | 1 |
| `packages/shared/src/index.ts` | 1.2.3 | 1 |
| `shared/types/python/tenant.py` | 1.2.5 | 1 |
| `shared/types/python/envelope.py` | 1.3.2, 1.3.4, 1.3.6 | 1 |
| `shared/types/python/subjects.py` | 1.4.2, 1.4.4 | 1 |
| `memory_postgres.py` | 2.1.2-2.1.10 | 2 |
| `src/shared/depth/tracker.py` | 2.2.2, 2.2.4 | 2 |
| `src/shared/claim_check/resolver.py` | 2.3.2, 2.3.4, 2.3.6 | 2 |
| `nats_bridge.py` | 2.4.2-2.4.12 | 2 |
| `agent_manager.py` | 2.5.2, 2.5.4 | 2 |
| `shared/config/settings.py` | 2.6.1 | 2 |
| `src/shared/metrics/yoizenclaw_metrics.py` | 3.1.2, 3.1.4, 3.1.5 | 3 |
| `src/shared/depth/tracker.py` (metrics) | 3.1.4 | 3 |
| `agents.controller.ts` | 4.1.2 | 4 |
| `agents.repository.ts` | 4.1.3 | 4 |
| `runtime.service.ts` | 4.2.2 | 4 |
| `agents.service.ts` | 4.2.4, 4.3.2, 4.3.4 | 4 |
| `services/tenant-service/src/providers/nats.provider.ts` | 5.1.2, 5.1.4, 5.2.2, 5.2.4 | 5 |
| `tenants.controller.ts` | 5.3.2 | 5 |
| `tenants.service.ts` | 5.3.3, 5.3.5 | 5 |
| `infrastructure/base/yoizenclaw-runtime/*` | 6.1-6.6 | 6 |
| `services/admin-console/src/app/agents/*` | 7.1-7.7 | 7 |

## Critical Path

```
1.1.1→1.1.2 → 1.2.1→1.2.2 → 1.3.1→1.3.2 → 1.4.1→1.4.2 →
2.1.1→2.1.2 → 2.4.1→2.4.2 → 2.4.11→2.4.12 →
4.1.1→4.1.2 → 4.3.1→4.3.2 → 5.1.1→5.1.2 → 5.3.1→5.3.3 →
6.1→6.4 → 7.1→7.2 → 8.8
```

## Implementation Order

### Batch 1 (Phase 1) - Foundation
**Parallelizable**: 1.1 (DB) || 1.2 (constants) || 1.3 (envelope) || 1.4 (subjects)

### Batch 2 (Phase 2) - Core Runtime
**Dependencies**: Phase 1
**Parallelizable**: 2.1 (DB) || 2.2 (depth) || 2.3 (claim check) → then 2.4 (bridge) → 2.5 (agent mgr)

### Batch 3 (Phase 3) - Observability
**Dependencies**: Phase 2
**Parallelizable**: 3.1 (metrics) || 3.2 (logging)

### Batch 4 (Phase 4 & 5) - Admin + Tenant Service
**Dependencies**: Phase 1, 2
**Parallelizable**: Phase 4 (Admin) || Phase 5 (Tenant/NATS)

### Batch 5 (Phase 6 & 7) - Deployment + UI
**Dependencies**: Phase 4, 5
**Parallelizable**: Phase 6 (Helm) || Phase 7 (Angular)

### Batch 6 (Phase 8 & 9) - Testing + Docs
**Dependencies**: All previous phases
