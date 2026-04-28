# AGENTS.md - Registry Service

## Project Overview

The Registry Service manages a Knative-based service registry where tenants can register, deploy, and manage their own services. It handles full lifecycle management including Knative service creation/updates via the Kubernetes CustomObjects API, route management for dynamic proxy routing, canary deployments with progressive traffic splitting, and revision listing. State is stored in a shared PostgreSQL database.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | PostgreSQL 17 via `postgres` (postgres.js) |
| K8s Client | `@kubernetes/client-node` (CoreV1Api, CustomObjectsApi) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                     # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                               # Root module imports
├── providers/
│   ├── kubernetes.provider.ts                  # @Global() K8S_CORE_API, K8S_CUSTOM_OBJECTS_API tokens
│   └── postgres.provider.ts                    # @Global() POSTGRES_SQL token, schema auto-migration
└── modules/
    ├── services/
    │   ├── services.module.ts
    │   ├── services.controller.ts              # POST/GET/PATCH/DELETE /services, GET /services/:id/revisions
    │   ├── services.service.ts                 # Register, deploy (Knative ksvc), update, remove, list revisions
    │   └── services.dto.ts                     # RegisterServiceDto, UpdateServiceDto
    ├── canary/
    │   ├── canary.module.ts
    │   ├── canary.controller.ts                # POST/PATCH/GET /services/:id/canary, POST promote/rollback
    │   ├── canary.service.ts                   # Start canary, update %, promote, rollback via traffic splitting
    │   └── canary.dto.ts                       # StartCanaryDto, UpdateCanaryDto
    ├── routes/
    │   ├── routes.module.ts
    │   ├── routes.controller.ts                # POST/GET/DELETE /services/:id/routes, GET /routes (discovery)
    │   ├── routes.service.ts                   # Route CRUD, discovery endpoint with 10s in-memory cache
    │   └── routes.dto.ts                       # CreateRouteDto
    └── health/
        ├── health.module.ts
        └── health.controller.ts                # GET /health (K8s API + Postgres)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/providers/postgres.provider.ts` | Creates tables (`registered_services`, `service_routes`, `canary_deployments`) on startup, `@Global()` |
| `src/providers/kubernetes.provider.ts` | Factory providers for `K8S_CORE_API` and `K8S_CUSTOM_OBJECTS_API` |
| `src/modules/services/services.service.ts` | Full Knative lifecycle: create ksvc, update image/scaling, delete, list revisions |
| `src/modules/canary/canary.service.ts` | Canary deployments: start (update image, wait for revision, split traffic), update %, promote, rollback |
| `src/modules/routes/routes.service.ts` | Route CRUD per service, discovery endpoint with `Map`-based cache (10s TTL) |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── KubernetesModule (@Global) ─── K8S_CORE_API, K8S_CUSTOM_OBJECTS_API
├── PostgresModule (@Global) ─── POSTGRES_SQL + SchemaInitializer
├── ServicesModule ─── ServicesController, ServicesService
├── CanaryModule ─── CanaryController, CanaryService
├── RoutesModule ─── RoutesController, RoutesService
└── HealthModule ─── HealthController
```

### Data Flow

1. **Register service**: tenant registers service metadata -> stored in `registered_services` -> Knative ksvc created in tenant namespace
2. **Deploy route**: create route prefix -> stored in `service_routes` -> API Gateway polls `GET /routes` for dynamic proxy routing
3. **Canary**: start canary with new image -> new revision created -> traffic split between stable/canary -> promote or rollback
4. **Discovery**: `GET /routes` joins `service_routes` + `registered_services` (active only) -> returns all routes with Knative endpoints

### Database Schema

```sql
registered_services (
    id, tenant_id, name, image, port, min_scale, max_scale,
    concurrency_target, env_vars JSONB, status, knative_name,
    namespace, created_at, updated_at
    UNIQUE(tenant_id, name)
)

service_routes (
    id, service_id FK, path_prefix, methods[], is_public,
    strip_prefix, created_at
    UNIQUE(service_id, path_prefix)
)

canary_deployments (
    id, service_id FK, stable_revision, canary_revision,
    canary_percent (0-100), status, created_at, updated_at
)
```

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| Kubernetes CustomObjects API | HTTPS | Create/update/delete Knative services, read revisions, apply traffic splits |
| Kubernetes Core API | HTTPS | List namespaces (health check) |
| PostgreSQL | TCP | Persist service registrations, routes, canary state |
| NATS JetStream | NATS | Outbound publish of `service.{upserted,deleted}.v1` envelopes consumed by `adapter-service` internal-sync (best-effort, post-commit) |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `K8S_CORE_API` | `CoreV1Api` | `kubernetes.provider.ts` |
| `K8S_CUSTOM_OBJECTS_API` | `CustomObjectsApi` | `kubernetes.provider.ts` |
| `POSTGRES_SQL` | `Sql` (postgres.js) | `postgres.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `postgres.support-services-dev.svc.cluster.local` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | PostgreSQL database |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | PostgreSQL password |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name for namespace resolution |

### Knative

- Image: `dev.local/registry-service:local`
- Autoscaling: min 1, max 5, target concurrency 50
- Readiness probe: `GET /health` on port 3000
- RBAC: `registry-service-manager` ClusterRole for Knative services/revisions and namespaces

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires K8s + PostgreSQL) |

## Code Style and Conventions

- **Schema auto-migration**: `SchemaInitializer` runs `CREATE TABLE IF NOT EXISTS` on startup
- **Map-based route cache**: `Map` with 10s TTL for discovery endpoint, cleared on route mutations
- **Canary polling**: `waitForNewRevision()` polls every 2s with 60s timeout for new Knative revision
- **Knative API constants**: `REGISTRY_KNATIVE_GROUP`, `REGISTRY_KNATIVE_VERSION`, `REGISTRY_KNATIVE_SERVICES_PLURAL` from `@yoizen/shared`
- **Tenant scoping**: all operations require `x-yoizen-tenant` header, queries filter by `tenant_id`
- **Idempotent deploys**: unique constraint `(tenant_id, name)` prevents duplicate service registrations

## Common Tasks

### Register a new tenant service

1. `POST /services` with `{ name, image, port?, minScale?, maxScale?, concurrencyTarget?, envVars? }`
2. Service is registered in DB and deployed as Knative service in tenant namespace
3. Create routes via `POST /services/:id/routes` for API Gateway dynamic routing

### Start a canary deployment

1. `POST /services/:id/canary` with `{ image, percent }`
2. New revision created, traffic split applied
3. Adjust with `PATCH /services/:id/canary` `{ percent }`
4. Finalize with `POST /services/:id/canary/promote` or `POST /services/:id/canary/rollback`

### Run locally

```bash
bun install
bun run start:dev
```

Requires local PostgreSQL and Kubernetes cluster access.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **Kubernetes API** | Creates/manages Knative services, reads revisions, applies traffic splits |
| **PostgreSQL** | Persists service registrations, routes, canary deployment state |
| **NATS JetStream** | Publish-only — emits `service.{upserted,deleted}.v1` envelopes after every register/update/remove on the per-tenant `INGRESS-<TENANT>` stream |
| **api-gateway** | Polls `GET /routes` every 15s for dynamic tenant routing |
| **tenant-service** | Provisions tenant namespaces where registered services are deployed |
| **adapter-service** (consumer) | Materializes `service.upserted.v1` / `service.deleted.v1` events into per-tenant `http_adapters` mirrors via its `adapter-internal-sync` JetStream durable |
| **`@yoizen/shared`** | Knative API constants, `TENANT_HEADER`, `SERVICE_UPSERTED_EVENT_TYPE`, `SERVICE_DELETED_EVENT_TYPE`, `buildRegistryPlatformSubject` |
| **`@yoizen/database`** | `JETSTREAM` / `JETSTREAM_MANAGER` providers, `ensureTenantIngressStream` helper |

## Service-events publisher (NATS JetStream)

Registry emits a CloudEvents envelope to the per-tenant ingress stream after every `register` / `update` / `remove` operation on `ServicesService`. The publish is best-effort and runs **post-commit** — the HTTP response is independent of broker availability.

### Subject and types

- Subject: `evt.<tenantId>.registry-service.platform.service.system.<upserted|deleted>.v1`, built via `buildRegistryPlatformSubject(tenantId, "service", "upserted" | "deleted")`.
- CloudEvents `type`: `SERVICE_UPSERTED_EVENT_TYPE` (`io.yoizen.registry.service.upserted.v1`) or `SERVICE_DELETED_EVENT_TYPE` (`io.yoizen.registry.service.deleted.v1`).
- CloudEvents `source`: `REGISTRY_EVENT_SOURCE` (`//registry-service/services`).

### Publish path

```
ServicesService.{register|update|remove}
  -> Postgres commit
  -> ServiceEventsPublisher.publishUpserted | publishDeleted
       -> short-circuit if REGISTRY_EMIT_ADAPTER_SYNC=false (no broker contact)
       -> short-circuit + missing_tenant metric if payload.tenantId is empty
       -> ensureTenantIngressStream(jsm, tenantId)        // @yoizen/database
       -> js.publish(subject, bytes, { headers, msgID })  // JetStream
       -> bounded retry (3 attempts, exp backoff capped 2s)
       -> classify failure: ack_timeout | broker_unavailable | ensure_stream_failed | unknown
  -> never throws to the caller
```

`msgID` is the deterministic CloudEvents `id` of the envelope, so JetStream deduplicates retries across publisher restarts.

### Feature flag

`REGISTRY_EMIT_ADAPTER_SYNC=true|false` (read by `services/registry-service/src/config.ts`):

- `false` (default): publisher short-circuits. No `streams.add`, no `js.publish`, no metric increment except an audit-friendly debug log. Use for safe rollout AND for emergency rollback without redeploying.
- `true`: publisher emits to JetStream after the DB commit.

Rollout order is interlocked: deploy `adapter-service-worker` → run `scripts/backfill-internal-mirrors.ts` once → flip flag to `true`.

### Metrics

| Metric | Labels | Notes |
|--------|--------|-------|
| `registry_publish_attempts_total` | `event_type` | Increments on every attempt (after flag short-circuit). |
| `registry_publish_successes_total` | `event_type` | One increment per successful PubAck. |
| `registry_publish_failures_total` | `event_type`, `reason` | `reason ∈ {ack_timeout, broker_unavailable, ensure_stream_failed, missing_tenant, unknown}`. |
| `registry_ensure_stream_calls_total` | `result` | `result ∈ {hit, miss}` — observability of the per-tenant `ensureTenantIngressStream` cache. |

> Cross-references: `REQ-RSE-001..005`, `NFR-RSE-001/002` in `.sdd/changes/adapter-internal-sync-durable/specs/registry-service-events.md`.
