# AGENTS.md - API Gateway

## Project Overview

The API Gateway is the HTTP entry point for the event-driven platform. It validates incoming event payloads, publishes them to NATS JetStream (`EVENTS` stream), tracks pending state in Redis, and returns results. It also exposes real-time SSE streaming, proxies requests to auth-service, audit-service, tenant-service, scheduler-service, registry-service, and workflow-service over HTTP, and performs health checks against all downstream services. A Fastify `onRequest` hook intercepts non-platform paths and proxies them to tenant-registered Knative services via a dynamic route cache that polls the registry-service every 15s. Global guards enforce JWT authentication (`AuthGuard`) and tenant resolution (`TenantGuard`) on every request.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Cache | Redis via `ioredis` |
| Auth | JWT verification via `jose` (HS256) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts
├── app.module.ts                    # APP_GUARD, APP_FILTER, APP_INTERCEPTOR
├── config.ts / config/gateway.config.ts
├── guards/                          # auth.guard, tenant.guard
├── decorators/                     # public, scopes, skip-tenant
├── filters/                        # service-exception.filter
├── interceptors/                   # audit.interceptor
├── hooks/                          # Fastify proxy / dynamic route hooks
├── providers/
│   ├── providers.module.ts         # @Global() NATS + Redis
│   ├── nats.provider.ts
│   └── redis.provider.ts
└── modules/
    ├── events/                     # publish, results, SSE
    ├── auth/                       # auth-facade, jwt, public-routes-cache, auth-proxy
    ├── audit/                      # audit + channel-audit proxy controllers
    ├── tenants/
    ├── schedulers/
    ├── registry/
    ├── workflows/
    ├── adapters/
    ├── channels/                   # channel + stream proxies
    ├── proxy/                      # generic proxy passthrough
    ├── admin/                      # yoizenclaw-admin proxy (agents, jobs, credentials, config)
    ├── dashboard/                  # dashboard stats aggregation
    ├── rate-limit/                 # tenant rate limits
    ├── dynamic-routes/             # @Global() DynamicRouteCacheService
    └── health/                     # GatewayHealthService + downstream checks

test/
├── unit/                           # many *.spec.ts (controllers, guards, proxies, utils)
└── integration/
    └── events.integration.spec.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Bootstrap with dynamic route Fastify hook — intercepts non-platform paths, resolves tenant, matches route from cache, proxies to upstream Knative service |
| `src/app.module.ts` | Registers `TenantGuard` and `AuthGuard` as global `APP_GUARD` providers |
| `src/guards/auth.guard.ts` | JWT verification, static `@Public()` bypass, dynamic public routes from Redis, scope enforcement via `@Scopes()` |
| `src/guards/tenant.guard.ts` | Resolves tenant from `<env>.<tenant>.yplatform.com` hostname or `x-yoizen-tenant` header |
| `src/modules/auth/jwt.service.ts` | HS256 JWT verification via `jose` library |
| `src/modules/auth/public-routes-cache.service.ts` | Fetches public routes from Redis, caches in-memory with 30s TTL |
| `src/modules/dynamic-routes/dynamic-route-cache.service.ts` | Polls `GET /routes` from registry-service every 15s, stores in `Map<string, RouteEntry[]>` sorted by longest prefix |
| `src/modules/events/events.service.ts` | Publish to JetStream + Redis pipeline; result cache with `Map` (max 1024) + Redis; SSE via NATS |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── APP_FILTER: ServiceExceptionFilter
├── APP_GUARD: TenantGuard, AuthGuard
├── APP_INTERCEPTOR: AuditInterceptor
├── ProvidersModule (@Global) ─── NATS, Redis
├── ObservabilityModule
├── AuthModule
├── EventsModule
├── AuditModule                    # audit + channel-audit HTTP proxies
├── TenantsModule
├── SchedulersModule
├── RegistryModule
├── AdaptersModule
├── ChannelsModule
├── WorkflowsModule
├── ProxyModule                    # pass-through to proxy-service
├── AdminModule                    # yoizenclaw-admin-service JSON proxy
├── DynamicRoutesModule (@Global)
├── RateLimitModule
├── DashboardModule
└── HealthModule                   # GatewayHealthService (NATS, Redis, all downstream /health)
```

### Authentication Flow

1. `TenantGuard` runs first: resolves tenant from hostname (`<env>.<tenant>.yplatform.com`) or `x-yoizen-tenant` header, attaches to request
2. `AuthGuard` runs second:
   - Skip if `@Public()` decorator present
   - Skip if method+path matches dynamic public routes from Redis
   - Verify JWT Bearer token via `jose`
   - Validate tenant scope: `platform` tokens pass; `tenant:<name>` tokens must match request tenant
   - Enforce `@Scopes('platform')` if present on handler

### Dynamic Routing

The Fastify `onRequest` hook in `main.ts` intercepts all requests not matching platform prefixes (`/events`, `/audit`, `/tenants`, `/schedulers`, `/registry`, `/workflows`, `/health`, `/auth`):

1. Resolve tenant from request
2. Match path against `DynamicRouteCacheService` (longest prefix first)
3. If route is not public, verify JWT and tenant scope
4. Proxy to `http://{knativeName}.{namespace}.svc.cluster.local{upstreamPath}`
5. 30s proxy timeout via `AbortSignal.timeout`

### Data Flow

1. **Publish**: `POST /events` -> validate DTO -> UUID -> JetStream publish + Redis pipeline -> 202 Accepted
2. **Results**: `GET /results/:id` -> L1 `Map` lookup -> Redis fallback -> FIFO eviction at 1024
3. **SSE**: `GET /events/stream?types=...` -> core NATS subscriptions -> RxJS Observable
4. **Proxies**: auth, audit, tenant, scheduler, registry, workflow -> HTTP `fetch` to downstream service
5. **Dynamic routes**: non-platform paths -> `DynamicRouteCacheService.match()` -> HTTP proxy to tenant Knative service
6. **Health**: parallel checks on NATS, Redis, and all downstream `/health` endpoints (3s timeout)

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| NATS JetStream | NATS | Publish to `events.<type>` on EVENTS stream |
| Core NATS | NATS | Subscribe to `events.>` for SSE streaming |
| Redis | TCP | `pending:<id>`, `callback:<id>`, `result:<id>` keys; public routes cache |
| auth-service | HTTP | Proxy auth endpoints |
| audit-service | HTTP | Proxy audit queries |
| tenant-service | HTTP | Proxy tenant CRUD |
| scheduler-service | HTTP | Proxy scheduler operations |
| registry-service | HTTP | Proxy registry operations; poll `GET /routes` for dynamic routing |
| workflow-api | HTTP | Proxy workflow operations |
| adapter-service | HTTP | Proxy `/adapters` CRUD and endpoint management |
| Tenant Knative services | HTTP | Dynamic route proxy to registered services |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM` | `JetStreamClient` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `REDIS_CLIENT` | `Redis` (ioredis) | `redis.provider.ts` |

### Custom Decorators

| Decorator | Metadata Key | Purpose |
|-----------|-------------|---------|
| `@Public()` | `isPublic` | Skip JWT authentication |
| `@Scopes(...scopes)` | `requiredScopes` | Require specific token scope (e.g., `platform`) |
| `@SkipTenant()` | `skipTenant` | Skip tenant resolution (for public auth endpoints) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | *(required)* | HS256 signing key for JWT verification |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name |
| `AUTH_SERVICE_URL` | `http://auth-service.platform-services.svc.cluster.local` | Auth service URL |
| `AUDIT_SERVICE_URL` | `http://audit-service.platform-services-dev.svc.cluster.local` | Audit proxy + health |
| `TENANT_SERVICE_URL` | `http://tenant-service.platform-services-dev.svc.cluster.local` | Tenant proxy + health |
| `SCHEDULER_SERVICE_URL` | `http://scheduler-service.platform-services.svc.cluster.local` | Scheduler proxy |
| `REGISTRY_SERVICE_URL` | `http://registry-service.platform-services.svc.cluster.local` | Registry proxy + route discovery |
| `WORKFLOW_SERVICE_URL` | `http://workflow-api.platform-services.svc.cluster.local` | Workflow proxy |
| `ADAPTER_SERVICE_URL` | `http://adapter-service.platform-services-dev.svc.cluster.local` | Adapter proxy |
| `CACHE_SERVICE_URL` | `http://cache-service.platform-services-dev.svc.cluster.local` | Health check target |
| `WEBHOOK_SERVICE_URL` | `http://webhook-service.platform-services-dev.svc.cluster.local` | Health check target |
| `EVENT_PROCESSOR_URL` | `http://event-processor.platform-services-dev.svc.cluster.local` | Health check target |
| `METRICS_SERVICE_URL` | `http://metrics-service.platform-services-dev.svc.cluster.local` | Health check target |

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

## Code Style and Conventions

- **Module layout**: feature modules under `src/modules/`, shared providers under `src/providers/`, guards under `src/guards/`, decorators under `src/decorators/`
- **Global guards**: `TenantGuard` and `AuthGuard` registered as `APP_GUARD` in `AppModule`
- **DI tokens**: string-based constants exported alongside factory providers
- **Global providers**: `ProvidersModule` and `DynamicRoutesModule` are `@Global()`
- **In-memory cache**: `Map<string, object>` with FIFO eviction (max `RESULT_CACHE_MAX = 1024`) for results
- **Route cache**: `Map<string, RouteEntry[]>` sorted by longest prefix, refreshed every 15s
- **Public routes cache**: in-memory with 30s TTL, backed by Redis `public_routes:{env}` key
- **Proxy pattern**: all downstream proxies use native `fetch()` with tenant header injection
- **Batched writes**: Redis `pipeline()` for atomic multi-key writes on publish
- **Parallel I/O**: `Promise.all` for concurrent JetStream publish + Redis pipeline, and for health checks
- **Timeouts**: `AbortSignal.timeout(3000)` on health fetches, 30s on dynamic route proxies
- **Validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`

## Common Tasks

### Add a new proxy route to a downstream service

1. Create a new module under `src/modules/` with a proxy service using `fetch()` against the target URL
2. Add the target URL as an env var (read in the service constructor)
3. Add a controller that delegates to the proxy service
4. Add the service URL to the health controller's `SERVICE_URLS` map
5. Register the module in `src/app.module.ts`

### Run locally

```bash
bun install
bun run start:dev
```

Requires local NATS (`nats://localhost:4222`), Redis (`localhost:6379`), and `JWT_SECRET` env var.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Publishes events to EVENTS stream; subscribes for SSE |
| **Redis** | Stores pending status, callback URLs, reads results; caches public routes |
| **auth-service** | HTTP proxy target for `/auth/*` endpoints |
| **audit-service** | HTTP proxy target for `/audit/events` queries |
| **tenant-service** | HTTP proxy target for `/tenants` CRUD |
| **scheduler-service** | HTTP proxy target for `/schedulers/*` endpoints |
| **registry-service** | HTTP proxy target for `/registry/*` endpoints; polls `GET /routes` for dynamic routing |
| **workflow-api** | HTTP proxy target for `/workflows` endpoints |
| **adapter-service** | HTTP proxy target for `/adapters/*` endpoints |
| **event-processor** | Downstream consumer (health check only) |
| **cache-service** | No data dependency (health check only) |
| **webhook-service** | No data dependency (health check only) |
| **metrics-service** | No data dependency (health check only) |
| **`@yoizen/shared`** | Stream names, subject prefixes, key prefixes, TTLs, cache limits, auth types |
