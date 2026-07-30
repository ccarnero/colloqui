# Cache Service

HTTP CRUD API backed by a two-tier cache: L1 in-memory `Map` (1000 entries, FIFO eviction) and L2 Redis. Supports single operations, batch GET via pipelines, and key listing via SCAN.

Standalone HTTP service: no NATS client and no calls to other platform services. It DOES depend on the shared workspace packages:

- `@yoizen/shared` — `TENANT_HEADER` for tenant-scoped keys (`src/modules/cache/cache.controller.ts:14`), `evictOldestIfCapacityBeforeSet` for the L1 FIFO eviction (`src/modules/cache/cache.service.ts:3`), and the `ICacheServiceHealthResponse` type (`src/modules/health/health.controller.ts:4`).
- `@yoizen/database` — the `redisProvider` / `REDIS_CLIENT` token re-exported by `src/redis.module.ts:2-8`.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: Redis (`localhost:6379`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cache/:key` | Get cached value |
| `PUT` | `/cache/:key` | Set value `{ value, ttl? }` |
| `DELETE` | `/cache/:key` | Delete key |
| `POST` | `/cache/batch` | Batch GET `{ keys: [] }` |
| `GET` | `/cache` | List keys by pattern |
| `GET` | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `CACHE_L1_MAX_SIZE` | `1000` | Max L1 entries |

## Testing

```bash
bun test:unit          # Mocked Redis
bun test:integration   # Requires local Redis
```

## Architecture

See [AGENTS.md](AGENTS.md) for two-tier cache design, eviction strategy, and conventions.
