# Cache in the platform — architecture, where and how

> Map of the platform's cache layers, verified against the code (2026-06-20).
> Prose in English; identifiers/keys in English (as in the code).

## TL;DR

There are **three layers**, and the most visible one (`cache-service`) is **not** the one sustaining the hot-path:

1. **`cache-service`** — an HTTP key-value store with L1 (memory) + L2 (Redis). Designed for **admin-console / tenants** via gateway, but **nothing calls it today and the gateway ships no `cache` route** (corrected 2026-08-03 — see Layer 1).
2. **Direct Redis within each service** — the "real" runtime caching (SWR for connectors, rate-limit, public-routes, cost-tracker, circuit breakers, execution states…).
3. **In-memory per pod** — the L1 of `cache-service`, the gateway's route cache (~15s), provisioning maps, SDK token.

```
                 ┌─────────────────────────────────────────────────────────┐
   (no caller)   │  cache-service — deployed, healthy, UNCONSUMED            │  LAYER 1
                 │  L1 (Map, FIFO 1000) + L2 Redis; no gateway route exists  │
                 └─────────────────────────────────────────────────────────┘

   ┌──────────────────────────── backend services ──────────────────────────┐
   │  connector-runtime ─ AdapterClient SWR (config) + HTTP-response cache   │
   │  api-gateway       ─ public-routes, dashboard, rate-limit, route-cache  │  LAYER 2
   │  agent-ai-service  ─ cost-tracker, circuit breaker, exec status         │  (direct
   │  ai-agent-gateway  ─ exec status projector, circuit breaker             │   Redis)
   │  agent-scheduler   ─ execution history (TTL 7d)                         │
   │  auth-service      ─ public-routes sync → Redis                         │
   └─────────────────────────────────  Redis  ─────────────────────────────┘

   LAYER 3 (in-memory per pod): L1 of cache-service · gateway route cache (15s)
   · public-routes in-memory · ensuredStreams maps · SDK token/appSecret
```

---

## Layer 1 — `cache-service` (HTTP KV, L1 + L2)

`services/cache-service/src/modules/cache/cache.service.ts`

- **L1**: `Map<string, {value, expiry}>` in memory, per pod. Capped at `CACHE_L1_MAX_SIZE` (default **1000**), **FIFO** eviction via `evictOldestIfCapacityBeforeSet` (`@yoizen/shared`).
- **L2**: Redis (shared client `REDIS_CLIENT` from `@yoizen/database`).
- **Operations**:
  - `set(key, value, ttl?)` → **write-through**: `redis.set(..., "EX", ttl)` and refreshes L1. Without ttl, permanent set.
  - `get(key)` → L1 if fresh → otherwise Redis; on Redis hit it **backfills L1**.
  - `del(key)` → deletes from Redis and L1.
  - `scan(pattern, count)` → iterated Redis `SCAN`.
  - `batchGet(keys)` → pipeline in a single round-trip.
- **Tenant-scoping** (`cache.controller.ts`, `@Controller("cache")`): the key is built with `tenantKey(tenantId, key)` using the `x-yoizen-tenant` header. Routes: `GET /cache` (scan), `GET /cache/:key`, `PUT /cache/:key`, `DELETE /cache/:key`, `POST /cache/batch`.
- **Scaling** (Knative): `knative/services/base/cache-service.yaml` pins
  `min-scale: "1"` / `max-scale: "5"` with `metric: concurrency`, `target: "100"`,
  so it does **not** scale to zero and does not cold-start on the first request.
  (Corrected 2026-08-03: the 2026-06-20 pass recorded "min-scale 0"; the manifest
  says otherwise, and in developer mode the dev overlay pins every ksvc to
  min = max = 1 on top of that. The L1 gotcha below is therefore *worse* than
  originally scoped — a pod that never scales away keeps a TTL-less L1 entry
  alive until FIFO eviction, instead of losing it on the next scale-to-zero.)

**Where it's used: nowhere, today.** (Corrected 2026-08-03. The 2026-06-20 pass
read a `get_architecture` call-graph and concluded "the real consumer is
`admin-console` (≈204 calls across boundaries)". That number is not reproducible
and the conclusion does not survive a direct check — the same class of unreliable
cross-boundary edge `ARCHITECTURE-ANALYSIS.md` §12 warns about.)

What the code actually shows:

- **`admin-console` never calls it.** No source under
  `services/admin-console/src` requests a `/cache` path.
- **The gateway does not proxy it.** There is no `@Controller("cache")` anywhere
  in `services/api-gateway/src`, so the `@Controller("cache")` routes below are
  not reachable through the platform's single HTTP entry point at all.
- **The only thing that consumes its URL is a health probe.** The
  `CACHE_SERVICE_URL` literal appears in exactly one source file,
  `services/api-gateway/src/config/gateway.config.ts`, where it feeds
  `gatewayConfig.services.cache` with a `platformServiceUrl("cache-service", env)`
  fallback (so the URL resolves even when the variable is unset). The only
  consumer of that value is `gateway-health.service.ts`'s `SERVICE_URLS` map,
  which lists `["cache-service", gatewayConfig.services.cache]` alongside the
  other platform services — a liveness probe, not a call. The variable is also
  set in **both** dev overlays
  (`knative/services/overlays/local/{postgres-dev,mongo-dev}/env-patches.yaml`)
  and documented in `services/api-gateway/README.md`'s env table. Nothing else
  in the repo references it. Reproduce — exactly four hits, none of them a call:
  `rg -n "CACHE_SERVICE_URL" -g '!node_modules' -g '!cowork/*' .`
  (the `cowork/*` exclusion drops this file and `DOCS-TRUTH-LEDGER.md`, which
  mention the name only because they audit it).

This matches the service's own README, which opens: "Standalone HTTP service: no
NATS client and no calls to other platform services." So `cache-service` is a
**deployed, healthy, unconsumed** KV — Layer 1 is a design that exists but carries
no traffic. Layers 2 and 3 below are the ones that actually sustain the runtime.

### ⚠️ Gotcha: L1 does not honor Redis TTL on reads

In `get`, the L1 backfill calls `setL1(key, value, 0)`, and `get` treats `expiry === 0` as **always fresh**. Consequence: a value with a TTL in Redis, once read and cached in L1, **lives in memory without expiring** until evicted by FIFO — it can serve stale data after the Redis TTL has already expired. The real TTL in L1 is only set when the pod itself calls `set(key, value, ttl>0)`. In a service with scale-to-zero and a small L1 the impact is limited, but it is a behavior to keep in mind.

---

## Layer 2 — Direct Redis per service (the runtime caching)

| Service | What it caches | Where |
|---|---|---|
| **connector-runtime** | **Connector config (SWR)** + **HTTP responses** | `_shared/adapter-client.provider.ts`, `_shared/http-cache/http-response-cache.ts` |
| api-gateway | public-routes (Redis + in-memory copy), dashboard stats (TTL), rate-limit (token-bucket / sliding-window / fixed-window) | `modules/auth/public-routes-cache.service.ts`, `modules/dashboard/dashboard-proxy.service.ts`, `modules/rate-limit/strategies/*` |
| agent-ai-service | LLM cost, distributed circuit breaker, execution state | `modules/llm/cost-tracker.service.ts` |
| ai-agent-gateway | execution state projector, circuit breaker | `modules/executions/executions.service.ts` |
| agent-scheduler-service | execution history (`scheduler:history:…`, TTL 7d) | `modules/scheduler/execution-history.service.ts` |
| auth-service | syncs public-routes to Redis (read by the gateway) | `modules/public-routes/public-routes.service.ts` |
| YoizenClawExecutionClient | `pending:` / `result:` state per execution (TTL ~1h) | `packages/shared/src/execution-client.ts` |

### Deep-dive: the `AdapterClient` SWR (the most sophisticated cache)

`packages/shared/src/adapter-client.ts` — resolves the config of a connector/endpoint for each outbound HTTP call, with **stale-while-revalidate** over Redis. This is what keeps the hot-path O(1).

**Mechanics (`getAdapter`):**
1. Reads the key `adapter:config:<tenant>:<adapterId>` from Redis (via the `AdapterCache` abstraction).
2. If it exists, parses `{ data, softExpiresAt }`:
   - `now < softExpiresAt` → **fresh hit**, returns `data` without touching the network.
   - soft TTL expired → `refreshOrStale`: attempts `fetchAndCache`; **if the fetch fails for any reason, returns the stale `data`** (resilience against `connector-admin` being down).
3. If nothing is in cache → `fetchAndCache`: GET `/connectors/:id` to `connector-admin` (timeout 5s).

**Double TTL (`fetchAndCache`):**
- **Soft TTL** = `cacheTtlSeconds` (default **60s**, `DEFAULT_CACHE_TTL_S`) → governs when a refresh is attempted. Stored in `entry.softExpiresAt`.
- **Hard TTL** = soft × `STALE_MULTIPLIER` (**5** → 300s) → the actual `setex` TTL in Redis. Keeps the data available as a stale fallback for 5× the soft TTL.

**Keys and variants:**
- `adapter:config:<tenant>:<adapterId>` — connector config.
- `adapter:oauth:<adapterId>` — OAuth token (with a 30s buffer).
- `adapter:internal-by-service:<tenant>:<serviceId>` — internal mirror of a registered service. **Negative caching**: if no mirror exists, caches `data: null` with a short TTL (`NEGATIVE_CACHE_TTL_S` = **10s**) to avoid repeating 404s while still propagating new mirrors quickly.

**Invalidation:** `invalidate`, `invalidateOAuthToken`, `invalidateInternalByServiceId` delete the key. Also, `resolveRequest`, if it cannot find the `endpointId` in the cached config, **invalidates and re-fetches once** (covers the case of a stale adapter that had an endpoint added to it).

**Operational resilience (wiring in connector-runtime, `adapter-client.provider.ts` / `redis-client.ts`):**
- Cache **best-effort**: a miss or Redis error returns `null` and falls back to a fresh fetch; errors are logged **deduplicated** (first occurrence + every 50th) to avoid flooding the pipeline.
- **Cluster-aware**: uses `Redis.Cluster` if `REDIS_CLUSTER_MODE`, with `commandTimeout` per command. (There is a comment explaining that a standalone client used to break under cluster by not following `MOVED`, which poisoned the `cb:workflow:http` circuit breaker by counting every miss as a failure.)
- Alongside the config SWR there is an **HTTP-response cache** (`http-cache/http-response-cache.ts`) that caches responses from outbound calls according to the `cache` policy of the endpoint/adapter.

---

## Layer 3 — In-memory per pod (no Redis)

- **L1 of `cache-service`** (see above).
- **Route cache of `api-gateway`** (`modules/dynamic-routes/dynamic-route-cache.service.ts`): route table refreshed from `registry-service` every ~15s.
- **In-memory copy of public-routes** in the gateway (with its TTL, fallback to stale if Redis fails).
- **`ensuredStreams` maps** in the `nats.provider.ts` files (to avoid re-asserting streams on every publish).
- **Token + `appSecret`** cached in the `@yoizen/platform-sdk` SDK.

---

## Observations

1. **`cache-service` has no consumer at all** (corrected 2026-08-03 — the original
   wording was "underused by the backends … essentially an admin/tenant-facing
   KV"). Nothing calls it, and the gateway exposes no `cache` route, so even a
   tenant could not reach it. The caching that sustains the runtime is direct
   Redis. If the intention was for it to be the central internal cache, it is not
   today — and if the intention was a tenant-facing KV, the gateway route is
   missing. Worth a keep-or-delete decision.
2. **L1 gotcha** (TTL not honored on backfill) — the only latent bug found in this layer.
3. **The `AdapterClient` SWR is the most mature and well-thought-out pattern** (double TTL, stale-on-error, negative cache, best-effort, cluster-aware, interplay with circuit breaker). A good model to replicate if unified caching across other services is desired.

*Sources: `services/cache-service/src/modules/cache/{cache.service,cache.controller,cache.dto}.ts`, `services/cache-service/src/config.ts`, `packages/shared/src/adapter-client.ts`, `services/connector-runtime/src/activities/_shared/{adapter-client.provider,redis-client}.ts`, `services/api-gateway/src/modules/{auth/public-routes-cache.service,dashboard/dashboard-proxy.service,rate-limit/strategies,dynamic-routes}`, and the per-service ioredis usages listed by service.*
