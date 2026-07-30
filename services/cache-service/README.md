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

All `/cache` routes take an OPTIONAL `x-yoizen-tenant` header. When present the
key is prefixed `"<tenant>:<key>"` (`tenantKey`,
`src/modules/cache/cache.controller.ts:18-20`); when absent the raw key is used.
Tenant scoping is therefore a naming convention, not an enforced boundary — this
service has no tenant guard.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cache/:key` | Get cached value; `null` when missing (`cache.controller.ts:47-53`) |
| `PUT` | `/cache/:key` | Set value `{ value, ttl? }` → `{ ok: true }`. `ttl` is seconds, integer `>= 1` (`cache.dto.ts:12-21`) |
| `DELETE` | `/cache/:key` | Delete from Redis AND L1 → `{ ok: true }` (`cache.controller.ts:76-83`) |
| `POST` | `/cache/batch` | Batch GET `{ keys: string[] }` → object keyed by the SCOPED key; `200`, not `201` (`cache.controller.ts:90-99`) |
| `GET` | `/cache` | SCAN by `pattern` (default `*`) with `count` (default `100`, max `10000`) (`cache.dto.ts:30-41`) |
| `GET` | `/health` | `{ status, redis }` — `"ok"`/`"degraded"` and `"connected"`/`"disconnected"` (`src/modules/health/health.controller.ts:12-19`) |

## Two-tier cache

`src/modules/cache/cache.service.ts`

- **L1** — `Map<string, IL1Entry>` where `IL1Entry = { value, expiry }` (`:7-10`).
  `expiry === 0` means "no expiry"; otherwise it is an absolute epoch-ms
  deadline (`:29`).
- **Read path** (`get`, `:26-44`): L1 hit with a fresh entry returns
  immediately; an expired entry is deleted and the read falls through to Redis;
  a Redis hit backfills L1 with `expiry: 0` — **the backfilled entry does not
  inherit the Redis TTL** (`:42`).
- **Write path** (`set`, `:52-61`): always writes through to Redis first
  (`SET ... EX ttl` when a TTL is given), then updates L1 with the matching
  deadline.
- **JSON handling**: values are `JSON.stringify`d on the way in; on the way out
  a `JSON.parse` failure returns the RAW string rather than erroring
  (`:36-41`, and the same fallback per key in `batchGet`, `:112-116`).
- **`scan`** (`:78-93`) loops the Redis cursor until it returns to `"0"`, so one
  HTTP call can issue many SCAN round-trips.
- **`batchGet`** (`:100-119`) issues one `redis.pipeline()` with an N-key GET
  fan-out — a single round-trip. Per-key errors and misses are skipped, so the
  response object simply omits them.

### L1 eviction

FIFO by `Map` insertion order, delegated to the shared
`evictOldestIfCapacityBeforeSet` helper (`cache.service.ts:3`, `:121-124`):
the oldest entry is removed BEFORE inserting a new key once the map is at
`CACHE_L1_MAX_SIZE`. Entries are not re-ordered on read, so this is
insertion-order FIFO, not LRU.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (`src/config.ts:7`) |
| `CACHE_L1_MAX_SIZE` | `1000` | Max L1 entries before FIFO eviction (`src/config.ts:8`) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_CLUSTER_MODE` | `localhost` / `6379` | Read by the shared `redisProvider` in `@yoizen/database`, not by this service's own config object |

Unlike most services, `src/config.ts` is NOT lazy — both values are read at
module load (`src/config.ts:6-9`), so setting them after import has no effect.

## Testing

```bash
bun run test:unit          # Mocked REDIS_CLIENT token
bun run test:integration   # Bootstraps the app against a real Redis on :6379
```

## Deploy

Knative Service, min 1 / max 5, concurrency target 100, image
`dev.local/cache-service:local`
(`knative/services/base/cache-service.yaml:14-16`, `:21`).

```bash
./rebuild-redeploy.sh cache-service dev
```
