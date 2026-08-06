# Cache Service

Class: descriptive
Summary: The standalone two-tier cache HTTP API (L1 in-memory Map, L2 Redis): its CRUD/batch/scan wire contract, its consumers, and the caller gotchas an in-cluster e2e run proved.

HTTP CRUD API backed by a two-tier cache: L1 in-memory `Map` (1000 entries, FIFO eviction) and L2 Redis. Supports single operations, batch GET via pipelines, and key listing via SCAN.

## Consumers

`connector-runtime` is the first live consumer (SPEC
`PENDIENTES/01-bugs-group-b.spec.md` T11/E36b): its HTTP-response cache — the
per-endpoint `cache` strategy the admin console exposes — reads and writes
`httpcache:v1:*` keys here through `GET`/`PUT /cache/:key`
(`services/connector-runtime/src/activities/_shared/http-cache/cache-service-store.ts`).
It sends NO `x-yoizen-tenant` header on purpose (its key already hashes the
tenant id) and treats every error from this service as a cache miss/no-op, so
an outage here degrades connector calls to uncached, never to failures. The
other callers are this service's own suites and `scripts/e2e/cache-service.sh`
(whose stage 10 drives exactly that consumer path end to end).

It had NEVER had a live consumer before, which is exactly how two defects
survived to the T10 audit — both are now covered by regression tests
(`test/unit/`, `test/integration/`) and by the e2e script:

1. A Redis hit backfilled L1 with "never expires", so a key whose TTL was
   written by ANOTHER writer (a second replica — max-scale is 5 — or any direct
   Redis client) stayed readable from that instance forever after Redis had
   expired it. `get` now reads PTTL alongside GET and inherits the remaining
   TTL (`src/modules/cache/cache.service.ts:35-62`).
2. A cached STRING was handed to Fastify as a plain-string payload, which it
   ships verbatim as `text/plain` — `GET` returned `hello`, unparseable by any
   JSON client, while objects/numbers/`null` came back as JSON. `GET /cache/:key`
   now serializes explicitly and always answers `application/json`
   (`src/modules/cache/cache.controller.ts:58-66`).

Standalone otherwise: no NATS client and no calls to other platform services.
It DOES depend on the shared workspace packages:

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
| `GET` | `/cache/:key` | Get cached value. ALWAYS `200` + `application/json`, for every value type; a miss is the JSON literal `null`, never a `404` and never an empty body (`cache.controller.ts:58-66`) |
| `PUT` | `/cache/:key` | Set value `{ value, ttl? }` → `{ ok: true }`. `ttl` is seconds, integer `>= 1` (`cache.dto.ts:12-21`) |
| `DELETE` | `/cache/:key` | Delete from Redis AND L1 → `{ ok: true }`. Idempotent: deleting a missing key is still `{ ok: true }` (`cache.controller.ts:89-96`) |
| `POST` | `/cache/batch` | Batch GET `{ keys: string[] }` → object keyed by the SCOPED key; `200`, not `201`. Misses are OMITTED from the object rather than returned as `null` (`cache.controller.ts:103-112`) |
| `GET` | `/cache` | SCAN by `pattern` (default `*`) with `count` (default `100`, max `10000`) (`cache.dto.ts:30-41`) |
| `GET` | `/health` | `{ status, redis }` — `"ok"`/`"degraded"` and `"connected"`/`"disconnected"` (`src/modules/health/health.controller.ts:12-19`) |

### Caller gotchas

- **Never send `Content-Type: application/json` on a bodyless request.** A
  `DELETE /cache/:key` that declares a JSON content type with no body is
  rejected by Fastify with `400 Body cannot be empty when content-type is set
  to 'application/json'` before it ever reaches the controller. This is
  platform-wide Nest+Fastify behaviour, not something this service opts into —
  an HTTP client that pins the header on every request (a shared axios/fetch
  wrapper, say) cannot delete a key. `scripts/e2e/cache-service.sh` hit exactly
  this and now sets the header only when it sends a body.
- **The `PUT` body is validated with `whitelist + forbidNonWhitelisted`**
  (`src/main.ts` → `bootstrapFastifyApp({ withValidationPipe: true })`), so any
  property other than `value`/`ttl` is a `400`.
- **Values are JSON round-tripped, not stored verbatim**: `undefined` inside an
  object disappears, `Date` becomes an ISO string, and a key written into Redis
  by a non-JSON writer is returned as its RAW string (`cache.service.ts:50-55`).

## Two-tier cache

`src/modules/cache/cache.service.ts`

- **L1** — `Map<string, IL1Entry>` where `IL1Entry = { value, expiry }` (`:7-10`).
  `expiry === 0` means "no expiry"; otherwise it is an absolute epoch-ms
  deadline (`:38`).
- **Read path** (`get`, `:35-62`): L1 hit with a fresh entry returns
  immediately; an expired entry is deleted and the read falls through to Redis.
  A Redis hit backfills L1 with the key's REMAINING Redis TTL, read via a PTTL
  issued in the same tick as the GET (`:43-46`, `:60`) — so a TTL written by
  another replica or a foreign Redis client is honoured here too. PTTL `-1`
  (key without TTL) backfills with no expiry; PTTL `-2` (the key expired
  between the two commands, which are pipelined but NOT atomic) returns the
  value and backfills nothing (`:56-59`).
- **Write path** (`set`, `:70-79`): always writes through to Redis first
  (`SET ... EX ttl` when a TTL is given), then updates L1 with the matching
  deadline.
- **JSON handling**: values are `JSON.stringify`d on the way in; on the way out
  a `JSON.parse` failure returns the RAW string rather than erroring
  (`:50-55`, and the same fallback per key in `batchGet`, `:136-140`).
- **`scan`** (`:96-111`) loops the Redis cursor until it returns to `"0"`, so one
  HTTP call can issue many SCAN round-trips.
- **`batchGet`** (`:118-143`) issues one `redis.pipeline()` with an N-key GET
  fan-out — a single round-trip. Per-key errors and misses are skipped, so the
  response object simply omits them. Unlike `get` it neither reads nor writes
  L1: every batch key is a Redis round-trip.

### L1 eviction

FIFO by `Map` insertion order, delegated to the shared
`evictOldestIfCapacityBeforeSet` helper (`cache.service.ts:3`, `:145-148`):
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
bun run test:unit          # Mocked REDIS_CLIENT token — no infrastructure

# The integration suite bootstraps the REAL AppModule, so it needs a reachable
# Redis. It is env-gated (same convention as agent-admin-service's
# TEST_POSTGRES_URL suite) and SKIPS itself when TEST_REDIS_URL is unset, which
# is why a bare `bun test` is green on a laptop with no Redis.
kubectl port-forward -n support-services-dev svc/redis 16379:6379 &
TEST_REDIS_URL=redis://localhost:16379 bun run test:integration
```

`TEST_REDIS_URL` also sets `REDIS_HOST`/`REDIS_PORT` for the shared
`redisProvider` before the app module loads
(`test/integration/cache.integration.spec.ts:28-34`). Keys are written under a
run-unique `integ:<pid>-<ts>` prefix and deleted in `afterAll` — the dev
cluster's Redis is shared with every other service.

### Live cluster check

`scripts/e2e/cache-service.sh` exercises the DEPLOYED ksvc over its Knative
route: health, object and string round trips, TTL expiry (both a TTL this
service wrote and one a foreign Redis writer wrote), batch GET, SCAN, DELETE
and tenant scoping. Exit `0` = verified, `1` = a stage failed, `2` = missing
prerequisite or unreachable service. It cleans up its own keys on exit.

```bash
bash scripts/e2e/cache-service.sh
```

## Deploy

Knative Service, min 1 / max 5, concurrency target 100, image
`dev.local/cache-service:local`
(`knative/services/base/cache-service.yaml:14-16`, `:21`).

```bash
./rebuild-redeploy.sh cache-service dev
```
