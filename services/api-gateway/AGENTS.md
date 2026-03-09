# AGENTS.md - API Gateway

## Project Overview

The API Gateway is the HTTP entry point for the event-driven platform. It validates incoming event payloads, publishes them to NATS JetStream (`EVENTS` stream), tracks pending state in Redis, and returns results. It also exposes real-time SSE streaming of events via core NATS subscriptions, proxies audit queries to the audit-service and tenant requests to the tenant-service over HTTP, and performs health checks against all downstream services. Each environment (dev, qa, staging, production) runs its own API Gateway instance wired to that environment's infrastructure.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Cache | Redis via `ioredis` |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                         # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                   # Root module imports
├── providers/
│   ├── providers.module.ts         # @Global() module exporting NATS + Redis
│   ├── nats.provider.ts            # NATS_CONNECTION, JETSTREAM, JETSTREAM_MANAGER tokens
│   └── redis.provider.ts           # REDIS_CLIENT token
└── modules/
    ├── events/
    │   ├── events.module.ts
    │   ├── events.controller.ts    # POST /events, GET /results/:id, SSE /events/stream
    │   ├── events.service.ts       # Publish, result lookup (L1 Map + Redis), SSE observable
    │   └── event.dto.ts            # EventDto with class-validator decorators
    ├── audit/
    │   ├── audit.module.ts
    │   ├── audit.controller.ts     # GET /audit/events, GET /audit/events/:id
    │   └── audit.service.ts        # AuditProxyService (HTTP fetch to audit-service)
    ├── tenants/
    │   ├── tenants.module.ts
    │   ├── tenants.controller.ts   # POST /tenants, GET /tenants, GET /tenants/:name, DELETE /tenants/:name
    │   └── tenant-proxy.service.ts # TenantProxyService (HTTP fetch to tenant-service)
    └── health/
        ├── health.module.ts
        └── health.controller.ts    # GET /health (NATS, Redis, downstream services)

test/
├── unit/
│   ├── health.controller.spec.ts
│   ├── events.controller.spec.ts
│   └── events.service.spec.ts
└── integration/
    └── events.integration.spec.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | App bootstrap with Fastify adapter and global `ValidationPipe` |
| `src/app.module.ts` | Imports ProvidersModule, EventsModule, AuditModule, TenantsModule, HealthModule |
| `src/providers/nats.provider.ts` | Factory providers for `NATS_CONNECTION`, `JETSTREAM`, `JETSTREAM_MANAGER` |
| `src/providers/redis.provider.ts` | Factory provider for `REDIS_CLIENT` (ioredis, lazy connect) |
| `src/providers/providers.module.ts` | `@Global()` module so NATS/Redis are injectable everywhere |
| `src/modules/events/event.dto.ts` | `EventDto` -- `type` (alphanumeric, max 128), `payload` (object), optional `callbackUrl` |
| `src/modules/events/events.service.ts` | Publish to JetStream + Redis pipeline; result cache with `Map` (max 1024) + Redis; SSE via NATS subscriptions |
| `src/modules/events/events.controller.ts` | HTTP endpoints: `POST /events` (202), `GET /results/:id`, `SSE /events/stream` |
| `src/modules/audit/audit.service.ts` | `AuditProxyService` -- forwards queries to audit-service over HTTP |
| `src/modules/audit/audit.controller.ts` | `GET /audit/events` (filtered, paginated), `GET /audit/events/:id` |
| `src/modules/tenants/tenant-proxy.service.ts` | `TenantProxyService` -- forwards tenant CRUD to tenant-service over HTTP |
| `src/modules/tenants/tenants.controller.ts` | `POST /tenants`, `GET /tenants`, `GET /tenants/:name`, `DELETE /tenants/:name` |
| `src/modules/health/health.controller.ts` | Aggregated health: NATS, Redis, and downstream services via `Promise.all` |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── ProvidersModule (@Global) ─── NATS_CONNECTION, JETSTREAM, JETSTREAM_MANAGER, REDIS_CLIENT
├── EventsModule ─── EventsController, EventsService
├── AuditModule ─── AuditController, AuditProxyService
├── TenantsModule ─── TenantsController, TenantProxyService
└── HealthModule ─── HealthController
```

### Data Flow

1. **Publish**: `POST /events` -> validate DTO -> UUID -> JetStream publish (`events.<type>`) + Redis pipeline (`pending:<id>`, `callback:<id>`) -> 202 Accepted
2. **Results**: `GET /results/:id` -> L1 `Map` lookup -> Redis `result:<id>` fallback -> FIFO eviction when Map exceeds 1024
3. **SSE**: `GET /events/stream?types=...` -> core NATS subscriptions (`events.>` or `events.<type>`) -> RxJS Observable -> `MessageEvent` via `@Sse()`
4. **Audit proxy**: `GET /audit/events` -> HTTP fetch to audit-service -> forward response
5. **Tenant proxy**: `POST/GET/DELETE /tenants` -> HTTP fetch to tenant-service -> forward response
6. **Health**: parallel checks on NATS connection, Redis ping, and downstream `/health` endpoints (3s timeout via `AbortSignal.timeout`)

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| NATS JetStream | NATS | Publish to `events.<type>` on EVENTS stream |
| Core NATS | NATS | Subscribe to `events.>` for SSE streaming |
| Redis | TCP | `pending:<id>`, `callback:<id>`, `result:<id>` keys (TTL 3600s) |
| audit-service | HTTP | Proxy audit queries (`/audit/events`) |
| tenant-service | HTTP | Proxy tenant CRUD (`/tenants`) |
| cache-service, webhook-service, event-processor, audit-service, metrics-service, tenant-service | HTTP | Health checks with 3s timeout |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM` | `JetStreamClient` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `REDIS_CLIENT` | `Redis` (ioredis) | `redis.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `CACHE_SERVICE_URL` | `http://cache-service.platform-services-dev.svc.cluster.local` | Health check target |
| `WEBHOOK_SERVICE_URL` | `http://webhook-service.platform-services-dev.svc.cluster.local` | Health check target |
| `AUDIT_SERVICE_URL` | `http://audit-service.platform-services-dev.svc.cluster.local` | Audit proxy + health |
| `EVENT_PROCESSOR_URL` | `http://event-processor.platform-services-dev.svc.cluster.local` | Health check target |
| `METRICS_SERVICE_URL` | `http://metrics-service.platform-services-dev.svc.cluster.local` | Health check target |
| `TENANT_SERVICE_URL` | `http://tenant-service.platform-services-dev.svc.cluster.local` | Tenant proxy + health |

### Knative

- Image: `dev.local/api-gateway:local`
- Autoscaling: min 1, max 10, target concurrency 100
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests (mocked NATS, Redis, services) |
| `bun test test/integration` | Integration tests (requires local NATS on :4222 and Redis on :6379) |

Unit tests mock DI tokens. Integration tests bootstrap the full NestJS app against real infrastructure.

## Code Style and Conventions

- **Module layout**: feature modules under `src/modules/`, shared providers under `src/providers/`
- **DI tokens**: string-based constants (e.g., `NATS_CONNECTION`, `REDIS_CLIENT`) exported alongside factory providers
- **Global providers**: `ProvidersModule` is `@Global()` so all modules can inject NATS/Redis without importing
- **In-memory cache**: `Map<string, object>` with FIFO eviction (max `RESULT_CACHE_MAX = 1024`)
- **Batched writes**: Redis `pipeline()` for atomic multi-key writes on publish
- **Parallel I/O**: `Promise.all` for concurrent JetStream publish + Redis pipeline, and for health checks
- **Timeouts**: `AbortSignal.timeout(3000)` on downstream health fetches
- **Validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`
- **DTOs**: `class-validator` decorators in `event.dto.ts` enforce shape at the HTTP boundary
- **Fire-and-forget**: `POST /events` returns 202 immediately after publishing

## Common Tasks

### Add a new HTTP endpoint

1. Create or update a controller in the appropriate `src/modules/<feature>/` directory
2. Add a service if business logic is needed
3. Register the module in `src/app.module.ts` if new

### Add a new proxy route (e.g., to another downstream service)

1. Create a new module under `src/modules/` with a service that uses `fetch()` against the target URL
2. Add the target URL as an env var (read in the service constructor)
3. Add a controller that delegates to the proxy service
4. Add the service URL to the health controller's `SERVICE_URLS` map

### Run locally

```bash
bun install
bun run start:dev   # watch mode on src/main.ts
```

Requires local NATS (`nats://localhost:4222`) and Redis (`localhost:6379`).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Publishes events to EVENTS stream; subscribes for SSE |
| **Redis** | Stores pending status, callback URLs, and reads results |
| **audit-service** | HTTP proxy target for `/audit/events` queries |
| **tenant-service** | HTTP proxy target for `/tenants` CRUD |
| **event-processor** | Downstream consumer (no direct calls; health check only) |
| **cache-service** | No data dependency (health check only) |
| **webhook-service** | No data dependency (health check only) |
| **metrics-service** | No data dependency (health check only) |
| **`@yoizen/shared`** | Stream names, subject prefixes, key prefixes, TTLs, cache limits |
