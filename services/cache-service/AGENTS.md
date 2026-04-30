# AGENTS.md - Cache Service

## Project Overview

The Cache Service is an HTTP CRUD API backed by a two-tier cache: an L1 in-memory `Map` for hot keys and an L2 Redis layer for shared persistence. It supports single get/set/delete, batch GET via Redis pipelines, and key listing via SCAN. It has no NATS dependency and operates as a standalone HTTP service.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Cache | Redis via `ioredis` |

The service imports `TENANT_HEADER` from `@yoizen/shared` for tenant-scoped cache keys.

## Repository Structure

```
src/
├── main.ts                         # Bootstrap: Fastify adapter, port binding
├── app.module.ts                   # Root module
├── redis.module.ts                 # @Global() re-exports redisProvider + REDIS_CLIENT from @yoizen/database
└── modules/
    ├── cache/
    │   ├── cache.module.ts
    │   ├── cache.controller.ts     # GET/PUT/DELETE /cache/:key, GET /cache, POST /cache/batch
    │   └── cache.service.ts        # L1 Map + L2 Redis, FIFO eviction, batch pipeline
    └── health/
        ├── health.module.ts
        └── health.controller.ts    # GET /health (Redis ping)

test/
├── unit/
│   ├── cache.service.spec.ts
│   ├── cache.controller.spec.ts
│   └── health.controller.spec.ts
└── integration/
    └── cache.integration.spec.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | App bootstrap with Fastify adapter |
| `src/app.module.ts` | Imports RedisModule, CacheModule, HealthModule |
| `src/redis.module.ts` | `@Global()` module exporting `REDIS_CLIENT` from `@yoizen/database` |
| `src/modules/cache/cache.service.ts` | Two-tier cache logic: L1 `Map<string, L1Entry>` with FIFO eviction + L2 Redis |
| `src/modules/cache/cache.controller.ts` | HTTP endpoints for cache operations |
| `src/modules/health/health.controller.ts` | Redis ping health check |

## Architecture Highlights

### Two-Tier Cache

- **L1 (in-memory)**: `Map<string, L1Entry>` where `L1Entry = { value, expiry }`. Provides O(1) lookups for hot keys without Redis round-trips.
- **L2 (Redis)**: Shared persistence across instances. Values are JSON-serialized; non-JSON strings pass through as raw.
- **Read path**: L1 check (with TTL validation) -> L2 Redis GET -> populate L1 on hit
- **Write path**: Redis SET (with optional EX) -> update L1

### L1 Eviction

FIFO eviction when `Map` exceeds `CACHE_L1_MAX_SIZE` (default 1000). The oldest entry (`Map.keys().next().value`) is removed before inserting a new key.

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cache` | List keys by pattern (default `*`), optional `count` param |
| `GET` | `/cache/:key` | Get cached value |
| `PUT` | `/cache/:key` | Set value with body `{ value, ttl? }` |
| `DELETE` | `/cache/:key` | Delete cached value |
| `POST` | `/cache/batch` | Batch GET with body `{ keys: string[] }` |
| `GET` | `/health` | Redis connection health |

### Batch GET

Uses `redis.pipeline()` to batch multiple GET commands into a single Redis round-trip. Returns `Map<string, unknown>` internally, serialized as a plain object in the HTTP response.

### Module Dependency Graph

```
AppModule
├── RedisModule (@Global) -> REDIS_CLIENT
├── CacheModule -> CacheController, CacheService
└── HealthModule -> HealthController
```

### DI Token

| Token | Type | Source |
|-------|------|--------|
| `REDIS_CLIENT` | `Redis` (ioredis) | `redis.module.ts` → `@yoizen/database` `redisProvider` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `CACHE_L1_MAX_SIZE` | `1000` | Max entries in L1 in-memory Map |

### Knative

- Image: `dev.local/cache-service:local`
- Autoscaling: min 0, max 5, target concurrency 100
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests (mocked Redis) |
| `bun test test/integration` | Integration tests (requires local Redis on :6379) |

Unit tests mock the `REDIS_CLIENT` token. Integration tests bootstrap the full app against a real Redis instance.

## Code Style and Conventions

- **Global Redis module**: `RedisModule` is `@Global()` so `REDIS_CLIENT` is injectable without re-importing
- **Lazy connect**: Redis uses `lazyConnect: true` to defer connection until first use
- **L1 as Map**: `Map<string, L1Entry>` for O(1) get/set/delete with iteration-order-based FIFO eviction
- **Batch via pipeline**: `redis.pipeline()` for batched multi-key reads in a single round-trip
- **JSON serialization**: Values are `JSON.stringify`/`JSON.parse` for Redis; non-JSON strings returned as raw
- **Module layout**: feature modules under `src/modules/`, shared provider under `src/providers/`

## Common Tasks

### Add a new cache endpoint

1. Add a method to `CacheService` with the cache logic
2. Add a route handler to `CacheController`

### Add a new provider (e.g., a second data store)

1. Create a provider file in `src/providers/`
2. Export the token and factory from a `@Global()` module (or add to `RedisModule`)
3. Inject the token in services that need it

### Run locally

```bash
bun install
bun run start:dev   # watch mode on src/main.ts
```

Requires local Redis (`localhost:6379`).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **Redis** | L2 cache backend |
| **api-gateway** | Calls `/health` for aggregated health checks |

This service does not depend on NATS or other microservices; it uses `@yoizen/shared` only for `TENANT_HEADER`.
