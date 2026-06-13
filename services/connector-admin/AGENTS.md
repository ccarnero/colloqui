# AGENTS.md - Adapter Service

## Project Overview

The Adapter Service manages multi-tenant HTTP adapter configurations and their endpoints. An adapter encapsulates connection details for an external (or internal) HTTP service: base URL, authentication (none, API key, bearer, basic, OAuth2 client credentials), custom headers, timeout, retry policy, and health check path. Each adapter can have multiple endpoints (label + method + path). Other services consume adapter configs at runtime through the shared `AdapterClient` class, which fetches from this service's REST API and caches in Redis with stale-while-revalidate semantics.

Adapter state lives **inside each tenant's own MongoDB instance** (provisioned by `tenant-service`), so the database itself is the tenant boundary — there is no `tenant_id` column, no cross-tenant fan-in, and no shared platform MongoDB. An internal-sync consumer ingests registry-service NATS events and materializes internal-adapter mirrors in the target tenant's DB.

## Storage engines

Supports **Postgres** (default) and **Mongo** per-tenant via `IAdaptersRepository` + engine-specific tenant connection managers. See [DOCS/runbooks/storage-engines.md](../../DOCS/runbooks/storage-engines.md).

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | MongoDB 7 via official `mongodb` driver — one instance per tenant |
| Messaging | NATS (`nats` package, used by internal-sync consumer) |
| Validation | `class-validator` + `class-transformer` |
| Observability | `@yoizen/observability` (Pino, OpenTelemetry, HTTP metrics) |
| Shared | `@yoizen/shared` (`ADAPTER_SCHEMA_SQL`, `AdapterConfig`, `TENANT_HEADER`), `@yoizen/database` (`TenantConnectionManager`, `NATS_CONNECTION`, health helpers) |

## Repository Structure

```
src/
├── instrumentation.ts               # OpenTelemetry SDK initialization (must be first import)
├── main.ts                          # Bootstrap: Fastify adapter, ValidationPipe, Pino logger, metrics hooks
├── app.module.ts                    # Root module: ObservabilityModule, ProvidersModule, AdaptersModule, InternalSyncModule, HealthModule
├── providers/
│   ├── providers.module.ts          # @Global() exporting AdapterTenantConnectionManager + NATS providers
│   ├── tenant-connection-manager.ts # Per-tenant MongoDB pool manager (subclass of @yoizen/database TenantConnectionManager)
│   └── nats.provider.ts             # NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM factories
├── modules/
│   ├── adapters/
│   │   ├── adapters.module.ts       # Feature module
│   │   ├── adapters.controller.ts   # REST endpoints: CRUD adapters + endpoint management
│   │   ├── adapters.repository.ts   # Per-tenant Sql resolution via AdapterTenantConnectionManager.ensureSchema()
│   │   ├── adapters.service.ts      # Business logic: Map-based endpoint aggregation, managed-by guard
│   │   └── adapters.dto.ts          # CreateAdapterDto, UpdateAdapterDto, CreateEndpointDto
│   ├── internal-sync/
│   │   ├── internal-sync.module.ts
│   │   └── internal-sync.service.ts # Consumes registry-service service.{upserted,deleted}.v1 events
│   └── health/
│       ├── health.module.ts
│       └── health.controller.ts     # GET /health (NATS + per-tenant Postgres aggregate)
└── scripts/
    └── backfill-internal-mirrors.ts # One-shot per-tenant mirror backfill from registry-service

Dockerfile                           # oven/bun:1.3-alpine multi-stage
package.json
tsconfig.json
```

## Key Files

| File | Purpose |
|------|---------|
| `src/providers/tenant-connection-manager.ts` | `AdapterTenantConnectionManager` subclass of `@yoizen/database` `TenantConnectionManager`. Registers `ADAPTER_SCHEMA_SQL` via `setSchema()` so `ensureSchema(tenantId)` runs DDL once per tenant (O(1) amortised). |
| `src/providers/providers.module.ts` | Global module exporting the tenant connection manager and NATS providers so every feature module (adapters, internal-sync, health) resolves them without duplication. |
| `src/modules/adapters/adapters.repository.ts` | Per-method `sqlFor(tenantId)` resolution; every query runs against the caller's tenant DB. No `tenant_id` column in queries or row types. `mapAdapter(row, tenantId)` populates the HTTP response's `tenantId` from the request context, not a DB column. |
| `src/modules/adapters/adapters.service.ts` | CRUD + field-level managed-by guard. On managed adapters (`managed_by != null`) it rejects edits to **registry-owned fields only** (`name`, `baseUrl`, `healthCheckPath`, `status`) with a structured 409 (`reason: "MANAGED_ADAPTER"`, `lockedFields`, `editableFields`); auth/headers/timeouts/retries/tags/cache and all endpoint mutations are allowed (sync never touches them). Deleting a managed adapter is still blocked (the sync would recreate it). |
| `src/modules/adapters/adapters.controller.ts` | Thin controller delegating to `AdaptersService`. Reads `x-yoizen-tenant` header via `@TenantId()` for tenant scoping. |
| `src/modules/internal-sync/internal-sync.service.ts` | Durable JetStream consumer that materializes `service.upserted/service.deleted` events into `context=internal` adapters in the tenant's own DB. Short-circuits envelopes missing `payload.tenantId`. |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── ObservabilityModule
├── ProvidersModule (@Global) ─── AdapterTenantConnectionManager, NATS_CONNECTION, JETSTREAM
├── AdaptersModule ─── AdaptersController, AdaptersService, AdaptersRepository
├── InternalSyncModule ─── InternalSyncService (+ AdaptersRepository instance)
└── HealthModule ─── HealthController
```

### Data Flow (HTTP)

```
Client (via API Gateway proxy)
  -> x-yoizen-tenant header
  -> AdaptersController: validate DTO, extract tenantId
  -> AdaptersService: managed-by guard, endpoint aggregation
  -> AdaptersRepository.sqlFor(tenantId) -> AdapterTenantConnectionManager.ensureSchema(tenantId)
  -> MongoDB (per-tenant pool at mongo.<tenantId>-<env>-ns.svc.cluster.local)
  -> JSON response (AdapterConfig + nested endpoints; tenantId populated from the request)
```

### Data Flow (Internal Sync)

```
registry-service.service.upserted.v1 / service.deleted.v1 (cross-tenant stream)
  -> JetStream durable consumer (queue: adapter-service)
  -> InternalSyncService: extract envelope.data.tenantId
  -> AdaptersRepository.upsertMirror / deleteMirrorByServiceName
  -> per-tenant MongoDB (context=internal, managed_by=registry-service)
```

### HTTP Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/adapters` | `create` | Insert adapter (+ optional inline endpoints) |
| `GET` | `/adapters` | `list` | List adapters for tenant, optional `?context=`, `?tag=`, `?name=` filters |
| `GET` | `/adapters/:id` | `get` | Fetch adapter with endpoints |
| `PATCH` | `/adapters/:id` | `update` | Dynamic partial update (managed adapters: rejects registry-owned fields only) |
| `DELETE` | `/adapters/:id` | `remove` | Delete adapter (FK cascade deletes endpoints) |
| `POST` | `/adapters/:id/endpoints` | `addEndpoint` | Add endpoint to adapter |
| `PATCH` | `/adapters/:id/endpoints/:epId` | `updateEndpoint` | Partial endpoint update |
| `DELETE` | `/adapters/:id/endpoints/:epId` | `removeEndpoint` | Remove endpoint |
| `GET` | `/health` | `check` | `{ status, nats, mongo }` |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `AdapterTenantConnectionManager` | class (subclass of `@yoizen/database` `TenantConnectionManager`) | `providers/tenant-connection-manager.ts` |
| `NATS_CONNECTION` | `NatsConnection` | `providers/nats.provider.ts` (re-exported from `@yoizen/database`) |
| `JETSTREAM_MANAGER` / `JETSTREAM` | JetStream helpers | `providers/nats.provider.ts` |

### Database Schema (Per-Tenant)

The schema lives in `@yoizen/shared/ADAPTER_SCHEMA_SQL` and is baked into every tenant's `init.sql` ConfigMap by `tenant-service` plus re-run lazily by `ensureSchema(tenantId)` via `IF NOT EXISTS`.

#### `http_adapters`

| Column | Type | Constraint |
|--------|------|------------|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `context` | TEXT | NOT NULL, CHECK IN ('internal', 'external') |
| `base_url` | TEXT | NOT NULL |
| `auth_type` | TEXT | NOT NULL, DEFAULT 'none' |
| `auth_config` | JSONB | NOT NULL, DEFAULT '{}' |
| `headers` | JSONB | NOT NULL, DEFAULT '[]' |
| `default_cache_strategy` | JSONB | NULL |
| `timeout_ms` | INTEGER | NOT NULL, DEFAULT 5000 |
| `max_retries` | INTEGER | NOT NULL, DEFAULT 3 |
| `retry_backoff_ms` | INTEGER | NOT NULL, DEFAULT 1000 |
| `health_check_path` | TEXT | NOT NULL, DEFAULT '/health' |
| `status` | TEXT | NOT NULL, DEFAULT 'enabled', CHECK IN ('enabled', 'disabled') |
| `is_encrypted` | BOOLEAN | NOT NULL, DEFAULT false |
| `tags` | TEXT[] | NOT NULL, DEFAULT '{}' |
| `managed_by` | TEXT | NULL (e.g. 'registry-service' for auto-mirrored internal adapters) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Unique**: `(name)` — uniqueness is implicitly tenant-scoped because the DB itself is the tenant boundary.
**Indexes**: `idx_http_adapters_context` on `context`, GIN on `tags`, partial index on `managed_by` where not null.

#### `adapter_endpoints`

| Column | Type | Constraint |
|--------|------|------------|
| `id` | TEXT | PRIMARY KEY |
| `adapter_id` | TEXT | NOT NULL, FK -> http_adapters(id) ON DELETE CASCADE |
| `label` | TEXT | NOT NULL |
| `method` | TEXT | NOT NULL |
| `path` | TEXT | NOT NULL |
| `cache_strategy` | JSONB | NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Unique**: `(adapter_id, method, path)` — prevents duplicate endpoint definitions.
**Index**: `idx_adapter_endpoints_adapter` on `adapter_id`.

### Supported Auth Types

| Auth Type | `authConfig` Fields | Used For |
|-----------|---------------------|----------|
| `none` | (empty) | Public endpoints |
| `api-key` | `apiKey`, `apiKeyHeader?` (default `X-API-Key`) | API key auth |
| `bearer` | `bearerToken` | Static bearer token |
| `basic` | `basicUsername`, `basicPassword` | HTTP Basic auth |
| `oauth2-client` | `tokenUrl`, `clientId`, `clientSecret`, `scope?` | OAuth2 client credentials grant |

Auth resolution is performed by `AdapterClient` in consuming services, not by this service.

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| MongoDB (per-tenant) | TCP | Outbound | CRUD operations on `http_adapters` and `adapter_endpoints` in each tenant's DB |
| NATS JetStream | NATS | Inbound (consumer) | `service.upserted.v1` / `service.deleted.v1` from registry-service |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `PLATFORM_ENVIRONMENT` | *(required)* | Environment suffix used by `TenantConnectionManager` to build the per-tenant host `mongo.<tenantId>-<env>-ns.svc.cluster.local` |
| `MONGO_PORT` | `27017` | MongoDB port (all tenant instances share this port) |
| `MONGO_DB` | `yoizen` | Database name inside each tenant's instance |
| `MONGO_USER` | `yoizen` | Database user |
| `MONGO_PASSWORD` | *(required)* | Database password (same for every tenant instance in dev; per-tenant secrets in prod) |
| `NATS_URL` | `nats://nats.messaging-dev.svc.cluster.local:4222` | NATS server for internal-sync |

### Knative

- Image: `dev.local/adapter-service:local`
- Autoscaling: min 1, max 5
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |

Unit tests use `makeFakeTenantConnections(sql)` from `test/make-sql-mock.ts` to stub `AdapterTenantConnectionManager`; it keeps a `Map<string, MongoClient>` of per-tenant handles and tracks `ensureSchema` call counts. E2E coverage for the adapter HTTP surface lives in `tests/e2e/adapter.e2e.spec.ts`.

## Code Style and Conventions

- **Global providers**: `ProvidersModule` is `@Global()`, exporting `AdapterTenantConnectionManager` + NATS tokens
- **Per-tenant pools**: `AdaptersRepository.sqlFor(tenantId)` awaits `ensureSchema(tenantId)` on every method; no raw `MongoClient` is cached at the repository level
- **Schema auto-migration**: baked into `tenant-service` `init.sql`; lazily re-run via `ensureSchema` (`IF NOT EXISTS`, idempotent)
- **MongoDB queries**: no ORM; uses mongodb driver tagged template literals with composable `sql` fragments for filters
- **JSONB fields**: `auth_config`, `headers`, `default_cache_strategy`, and endpoint `cache_strategy` are stored as JSONB, parsed with `parseJsonb` helper
- **UUID generation**: `@yoizen/shared` `generateId()` for adapter and endpoint IDs
- **Map-based aggregation**: list endpoint joins are grouped with `Map<string, IEndpointRow[]>` for O(n) endpoint grouping
- **Unique violation handling**: catches MongoDB error code `23505` and throws `ConflictException`
- **Tenant boundary**: the DB instance is the tenant boundary — no `tenant_id` column, no `WHERE tenant_id = ...` filter. `tenantId` is used only to resolve the pool and to populate the HTTP response
- **Validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`
- **Context constraint**: `context` must be `internal` or `external` (enforced at both DTO and DB level)

## Common Tasks

### Add a new auth type

1. Add the new type to the `authConfig` documentation above
2. `AdapterClient` in `@yoizen/shared` handles auth resolution — update `injectAuthHeaders()` in `adapter-client.ts`
3. No changes needed in this service (auth config is opaque JSONB)

### Add a field to adapters

1. Add column to `ADAPTER_SCHEMA_SQL` in `@yoizen/shared` (`packages/shared/src/adapter-schema.ts`) — this propagates to both new-tenant provisioning (via `tenant-service` `init.sql`) and existing tenants (via `ensureSchema`)
2. Add field to `CreateAdapterDto` and/or `UpdateAdapterDto` in `adapters.dto.ts`
3. Add field to `IAdapterRow` interface and `mapAdapter` function in `adapters.repository.ts`
4. Update `AdapterConfig` in `@yoizen/shared` `adapter.interfaces.ts`

### Run locally

```bash
pnpm install
bun run start:dev
```

Requires at least one per-tenant Postgres instance reachable at `mongo.<tenantId>-<PLATFORM_ENVIRONMENT>-ns.svc.cluster.local:27017` (use `kubectl port-forward` or override `PLATFORM_ENVIRONMENT` for local dev clusters). Tables are auto-created via `ensureSchema` on the first request per tenant.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **MongoDB (per-tenant)** | Data store for adapter and endpoint configurations; one instance per tenant provisioned by `tenant-service` |
| **tenant-service** | Provisions per-tenant Postgres and bakes `ADAPTER_SCHEMA_SQL` into each tenant's `init.sql` |
| **registry-service** | Publishes `service.upserted.v1` / `service.deleted.v1` NATS events consumed by internal-sync |
| **NATS JetStream** | Event bus for internal-sync (per-tenant `INGRESS-<TENANT>` streams) |
| **api-gateway** | Upstream proxy (adapter endpoints proxied through the gateway at `/adapters`) |
| **`@yoizen/shared`** | `TENANT_HEADER`, `AdapterConfig` interface, `ADAPTER_SCHEMA_SQL`, `ADAPTER_MANAGED_BY_REGISTRY` |
| **`@yoizen/database`** | `TenantConnectionManager`, `NATS_CONNECTION`, `JETSTREAM` / `JETSTREAM_MANAGER`, `MultiTenantConsumerManager`, `ensureTenantIngressStream`, `getNatsTenantPostgresHealthStatus` |
| **`@yoizen/observability`** | Pino logger, OpenTelemetry tracing, HTTP metrics hooks, `bootstrapSplitService`, `isWorkerMode` |

### Consumed By (via `AdapterClient`)

| Service | Usage |
|---------|-------|
| **connector-runtime** | Resolves adapter config for `endpointCall` and `serviceCall` activities |
| **api-gateway** | Proxies adapter management endpoints |
| **agent-admin-service** | Admin console adapter management |

## Migration Notes

- Prior to this migration, `http_adapters` and `adapter_endpoints` lived in the platform-shared Postgres with a `tenant_id` column and a `(tenant_id, name)` unique constraint. Those tables are dropped from the platform DB via `infrastructure/base/postgres/configmap.yaml` on fresh bootstraps.
- Rollback would require re-introducing the `tenant_id` column and backfilling rows from each tenant's DB — keep the `ADAPTER_SCHEMA_SQL` export generic enough to make that trivial if ever needed.
- Operator-owned (external) adapters need to be re-created after cut-over; internal-adapter mirrors repopulate automatically from registry-service `service.upserted.v1` events, or can be bulk-seeded via `scripts/backfill-internal-mirrors.ts`.

## Topology (api / worker split)

`adapter-service` ships as **two workloads** with the same image, selected at runtime via `SERVICE_MODE`:

| Workload | Kind | `SERVICE_MODE` | Purpose | Scaling |
|----------|------|-----------------|---------|---------|
| `adapter-service-api` | `serving.knative.dev/v1.Service` | `api` | HTTP CRUD endpoints (`/adapters`, `/health`, `/healthz`, `/readyz`) | KPA. `min-scale: "1"` in prod, `"0"` in non-prod overlays. |
| `adapter-service-worker` | `apps/v1.Deployment` | `worker` | Pull-based JetStream consumer (`adapter-internal-sync`). No HTTP CRUD. | Fixed 1 replica in developer mode (no autoscaling). |

Bootstrap is unified through `bootstrapSplitService({ baseServiceName: "adapter-service", module: AppModule, … })` from `@yoizen/observability`. Missing or unknown `SERVICE_MODE` (anything outside `["api", "worker"]`) is a fatal startup error.

### Internal sync durable contract

| Field | Value |
|-------|-------|
| Durable name | `adapter-internal-sync` (constant across all tenants) |
| Bound stream | `INGRESS-<TENANT>` (one per tenant), reactively attached at runtime via `MultiTenantConsumerManager` |
| Filter subject | `evt.<tenant>.registry-service.platform.service.system.*.v1` |
| CloudEvents types accepted | `io.yoizen.registry.service.upserted.v1`, `io.yoizen.registry.service.deleted.v1` |
| Ack policy | `Explicit` |
| `max_deliver` | 5 |
| `ack_wait` | 60s |
| `backoff` | `[60s, 120s, 300s, 600s]` |
| Concurrency | 4 (per-runner) |
| Idempotency | `AdaptersRepository.upsertMirror` / `deleteMirrorByServiceName` are upserts — at-least-once redelivery is safe by design |
| Tenant routing | the **subject** is the source of truth for the tenant. Payload `tenantId ≠ subject tenant` → `PermanentError("cross_tenant_attempt")` + `cross_tenant_attempt_total` metric, message is `term`'d (poison) |
| Poison classes (`term`'d) | `parse_error`, `unknown_type`, `invalid_payload`, `cross_tenant_attempt`, `invalid_subject` |
| Transient errors (`nak`'d) | DB unavailable, broker disconnect, anything that throws a plain `Error` (NOT `PermanentError`) |

### `ensureOnly` mode

The `MultiTenantConsumerManager` is constructed with `ensureOnly: !isWorkerMode()`:

- **api pods** (`ensureOnly: true`): create the durable on every reachable `INGRESS-<TENANT>` stream but do NOT pull messages. This guarantees the durable exists for the worker to bind on and that the JetStream `num_pending` metric stays observable to Prometheus regardless of whether the worker is running.
- **worker pods** (`ensureOnly: false`): drive the runner with concurrency 4 and actually consume.

### Health gates

| Endpoint | api mode | worker mode |
|----------|----------|-------------|
| `/healthz` | 200 while process is up. No dependency probe. | Same — 200 while up. |
| `/readyz` | 200 when the per-tenant DB connection manager is healthy. **Independent of NATS** — a dead broker does NOT block HTTP CRUD. | 200 only when **all three gates** are green: `JetStreamManager` connected, ≥1 active tenant pool reports DB green, ≥1 `MultiTenantConsumerManager` runner reports `isHealthy()`. Otherwise 503 with `{ status, mode, failed: ["nats" \| "db" \| "durables"] }`. |
| Both modes on SIGTERM | `/readyz` flips to 503 with `failed: ["shutting_down"]` so kube stops sending traffic; in-flight messages drain through the runner before exit. |
| Legacy `/health` | Aggregated `{ status, nats, mongo }` kept for backwards-compat with manifests that still probe the old path. Will be retired once all probes are migrated. |

### Rollback

The migration is reversible without redeploying source code:

1. Set `REGISTRY_EMIT_ADAPTER_SYNC=false` on `registry-service` env. Publisher short-circuits; no broker contact.
2. Scale `adapter-service-worker` Deployment to `replicas: 0`.
3. `adapter-service-api` keeps serving HTTP CRUD throughout — its `/readyz` does not depend on NATS.

To re-enable: deploy registry first, run `scripts/backfill-internal-mirrors.ts` once to catch drift, then flip `REGISTRY_EMIT_ADAPTER_SYNC=true` and scale the worker Deployment back up.

> Cross-references: `REQ-AST-001..007`, `REQ-ASIS-001/003`, `REQ-ASA-001..006` in `.sdd/changes/adapter-internal-sync-durable/specs/`.
