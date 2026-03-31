# AGENTS.md - Adapter Service

## Project Overview

The Adapter Service manages multi-tenant HTTP adapter configurations and their endpoints. An adapter encapsulates connection details for an external (or internal) HTTP service: base URL, authentication (none, API key, bearer, basic, OAuth2 client credentials), custom headers, timeout, retry policy, and health check path. Each adapter can have multiple endpoints (label + method + path). Other services consume adapter configs at runtime through the shared `AdapterClient` class, which fetches from this service's REST API and caches in Redis with stale-while-revalidate semantics.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | PostgreSQL 17 via `postgres` (postgres.js) |
| Validation | `class-validator` + `class-transformer` |
| Observability | `@yoizen/observability` (Pino, OpenTelemetry, HTTP metrics) |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── instrumentation.ts               # OpenTelemetry SDK initialization (must be first import)
├── main.ts                          # Bootstrap: Fastify adapter, ValidationPipe, Pino logger, metrics hooks
├── app.module.ts                    # Root module: ObservabilityModule, PostgresModule, AdaptersModule, HealthModule
├── providers/
│   └── postgres.provider.ts         # POSTGRES_SQL token, schema auto-migration, connection lifecycle
└── modules/
    ├── adapters/
    │   ├── adapters.module.ts       # Feature module importing PostgresModule
    │   ├── adapters.controller.ts   # REST endpoints: CRUD adapters + endpoint management
    │   ├── adapters.service.ts      # Business logic: queries, Map-based endpoint aggregation, UUID generation
    │   └── adapters.dto.ts          # CreateAdapterDto, UpdateAdapterDto, CreateEndpointDto
    └── health/
        ├── health.module.ts
        └── health.controller.ts     # GET /health (PostgreSQL connectivity check)

Dockerfile                           # oven/bun:1.3-alpine multi-stage
package.json
tsconfig.json
```

## Key Files

| File | Purpose |
|------|---------|
| `src/providers/postgres.provider.ts` | Creates `postgres.Sql` connection from env vars, runs DDL on init (`http_adapters` + `adapter_endpoints` tables), closes on destroy. Exported as global `POSTGRES_SQL` token |
| `src/modules/adapters/adapters.service.ts` | All adapter CRUD + endpoint management. Uses raw SQL via postgres.js. Aggregates endpoints per adapter with `Map<string, EndpointRow[]>` for O(n) grouping |
| `src/modules/adapters/adapters.controller.ts` | Thin controller delegating to `AdaptersService`. Reads `x-yoizen-tenant` header for tenant scoping |
| `src/modules/adapters/adapters.dto.ts` | `CreateAdapterDto` (context must be `internal` or `external`, `timeoutMs` >= 100), `UpdateAdapterDto` (all optional), `CreateEndpointDto` |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── ObservabilityModule
├── PostgresModule (@Global) ─── POSTGRES_SQL
├── AdaptersModule ─── AdaptersController, AdaptersService
└── HealthModule ─── HealthController
```

### Data Flow

```
Client (via API Gateway proxy)
  -> x-yoizen-tenant header
  -> AdaptersController: validate DTO, extract tenantId
  -> AdaptersService: raw SQL via postgres.Sql
  -> PostgreSQL: http_adapters + adapter_endpoints tables
  -> JSON response (adapter + nested endpoints array)
```

### HTTP Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/adapters` | `create` | Insert adapter (+ optional inline endpoints) |
| `GET` | `/adapters` | `list` | List adapters for tenant, optional `?context=` filter |
| `GET` | `/adapters/:id` | `get` | Fetch adapter with endpoints |
| `PATCH` | `/adapters/:id` | `update` | Dynamic partial update |
| `DELETE` | `/adapters/:id` | `remove` | Delete adapter (FK cascade deletes endpoints) |
| `POST` | `/adapters/:id/endpoints` | `addEndpoint` | Add endpoint to adapter |
| `DELETE` | `/adapters/:id/endpoints/:epId` | `removeEndpoint` | Remove endpoint |
| `GET` | `/health` | `check` | `{ status, postgres }` |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `POSTGRES_SQL` | `Sql` (postgres.js) | `postgres.provider.ts` |

### Database Schema

#### `http_adapters`

| Column | Type | Constraint |
|--------|------|------------|
| `id` | TEXT | PRIMARY KEY |
| `tenant_id` | TEXT | NOT NULL |
| `name` | TEXT | NOT NULL |
| `context` | TEXT | NOT NULL, CHECK IN ('internal', 'external') |
| `base_url` | TEXT | NOT NULL |
| `auth_type` | TEXT | NOT NULL, DEFAULT 'none' |
| `auth_config` | JSONB | NOT NULL, DEFAULT '{}' |
| `headers` | JSONB | NOT NULL, DEFAULT '[]' |
| `timeout_ms` | INTEGER | NOT NULL, DEFAULT 5000 |
| `max_retries` | INTEGER | NOT NULL, DEFAULT 3 |
| `retry_backoff_ms` | INTEGER | NOT NULL, DEFAULT 1000 |
| `health_check_path` | TEXT | NOT NULL, DEFAULT '/health' |
| `status` | TEXT | NOT NULL, DEFAULT 'enabled', CHECK IN ('enabled', 'disabled') |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Unique**: `(tenant_id, name)` -- prevents duplicate adapter names per tenant.
**Indexes**: `idx_http_adapters_tenant` on `tenant_id`, `idx_http_adapters_context` on `context`.

#### `adapter_endpoints`

| Column | Type | Constraint |
|--------|------|------------|
| `id` | TEXT | PRIMARY KEY |
| `adapter_id` | TEXT | NOT NULL, FK -> http_adapters(id) ON DELETE CASCADE |
| `label` | TEXT | NOT NULL |
| `method` | TEXT | NOT NULL |
| `path` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Unique**: `(adapter_id, method, path)` -- prevents duplicate endpoint definitions.
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
| PostgreSQL | TCP | Outbound | CRUD operations on `http_adapters` and `adapter_endpoints` |

No NATS or Redis dependencies. This is a stateless REST service backed by PostgreSQL.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `postgres.support-services-dev.svc.cluster.local` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | Database name |
| `POSTGRES_USER` | `yoizen` | Database user |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | Database password |

### Knative

- Image: `dev.local/adapter-service:local`
- Autoscaling: min 1, max 5
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires local PostgreSQL) |

E2E tests live in `tests/e2e/adapter.e2e.spec.ts` and cover adapter CRUD, custom headers, retries, timeouts, enrichment, forwarding, workflow endpointCall, and webhook delivery.

## Code Style and Conventions

- **Global providers**: `PostgresModule` is `@Global()`, exporting `POSTGRES_SQL`
- **Schema auto-migration**: DDL runs in `SchemaInitializer.onModuleInit()` using `IF NOT EXISTS`
- **Raw SQL**: no ORM; uses postgres.js tagged template literals
- **JSONB fields**: `auth_config` and `headers` stored as JSONB, parsed with `parseJsonb` helper
- **UUID generation**: `crypto.randomUUID()` for adapter and endpoint IDs
- **Map-based aggregation**: joins are grouped with `Map<string, EndpointRow[]>` for O(n) endpoint grouping
- **Unique violation handling**: catches PostgreSQL error code `23505` and throws `BadRequestException`
- **Multi-tenancy**: all queries filter by `tenant_id` extracted from `x-yoizen-tenant` header
- **Validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`
- **Context constraint**: `context` must be `internal` or `external` (enforced at both DTO and DB level)

## Common Tasks

### Add a new auth type

1. Add the new type to the `authConfig` documentation above
2. `AdapterClient` in `@yoizen/shared` handles auth resolution -- update `injectAuthHeaders()` in `adapter-client.ts`
3. No changes needed in this service (auth config is opaque JSONB)

### Add a field to adapters

1. Add column via migration SQL in `postgres.provider.ts` `SCHEMA_SQL`
2. Add field to `CreateAdapterDto` and/or `UpdateAdapterDto` in `adapters.dto.ts`
3. Add field to `AdapterRow` interface and `mapAdapter` function in `adapters.service.ts`
4. Update `AdapterConfig` in `@yoizen/shared` `adapter.interfaces.ts`

### Run locally

```bash
bun install
bun run start:dev
```

Requires local PostgreSQL (`localhost:5432`) with database `yoizen`. Tables are auto-created on startup.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **PostgreSQL** | Data store for adapter and endpoint configurations |
| **api-gateway** | Upstream proxy (adapter endpoints proxied through the gateway at `/adapters`) |
| **`@yoizen/shared`** | `TENANT_HEADER`, `AdapterConfig` interface |
| **`@yoizen/observability`** | Pino logger, OpenTelemetry tracing, HTTP metrics hooks |

### Consumed By (via `AdapterClient`)

| Service | Usage |
|---------|-------|
| **workflow-http-worker** | Resolves adapter config for `endpointCall` activities |
| **event-processor** | Resolves adapter config for enrichment and forward pipeline stages |
| **webhook-service** | Fetches adapter config for webhook delivery with custom auth/headers/retries |
