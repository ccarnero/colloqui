# Proxy Service

Forwards incoming HTTP requests to external servers, preserving method, path,
query string, body and headers. Three handlers differ ONLY in how the upstream
base URL is resolved:

| Handler | Path prefix | Target resolution |
|---|---|---|
| Generic | `/proxy/generic` | The `x-proxy-target` request header (`src/modules/proxy/proxy.service.ts:13`, `:60-64`) |
| ySocial | `/proxy/ysocial` | The tenant's `configuration.ySocialUrl` (`proxy.service.ts:27-30`, `:73-75`) |
| yFlow | `/proxy/yflow` | The tenant's `configuration.yFlowUrl` (`proxy.service.ts:27-30`, `:77-79`) |

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: tenant-service reachable at `TENANT_SERVICE_URL` for the ySocial/yFlow
handlers. The generic handler works standalone.

## Endpoints

Each proxy handler is registered TWICE — a bare route and a wildcard — so both
`/proxy/generic` and `/proxy/generic/some/deep/path` match
(`src/modules/proxy/proxy.controller.ts:9-55`).

| Method | Path | Description |
|---|---|---|
| `ALL` | `/proxy/generic`, `/proxy/generic/*` | Proxy to the `x-proxy-target` header URL |
| `ALL` | `/proxy/ysocial`, `/proxy/ysocial/*` | Proxy to the tenant's `ySocialUrl` |
| `ALL` | `/proxy/yflow`, `/proxy/yflow/*` | Proxy to the tenant's `yFlowUrl` |
| `GET` | `/health` | See below |

`GET /health` is NOT a static `{ status: "ok" }`: it calls
`GET <TENANT_SERVICE_URL>/health` with a 3 s timeout and returns
`{ status, tenantService }` where `status` is `"degraded"` and `tenantService`
is `"unreachable"` whenever that probe fails or is non-2xx
(`src/modules/health/health.controller.ts:5`, `:9-30`). A proxy-service pod is
therefore reported degraded when tenant-service is down, even though the generic
handler still works.

## Proxy flow

`proxyTo`, `src/modules/proxy/proxy.service.ts:115-158`:

1. Resolve the target base URL (header or tenant config).
2. Split the incoming `req.url` with two pure helpers: `extractPath` strips the
   handler prefix and defaults to `/` when nothing remains (`:211-215`);
   `extractQuery` returns the `?...` tail verbatim (`:217-220`).
3. Build `<base><path><query>`.
4. Copy every request header EXCEPT the hop-by-hop set — `host`, `connection`,
   `transfer-encoding`, `accept-encoding` (`HOP_BY_HOP`, `:18-23`) — then FORCE
   `accept-encoding: identity` on the upstream call (`:126`), so the upstream
   never compresses and the body can be relayed as text.
5. For non-`GET`/`HEAD` with a defined body, send `JSON.stringify(req.body)`
   (`:134-140`) — this proxy assumes JSON; it does not relay raw binary bodies.
6. `tracedFetch` with `AbortSignal.timeout(30000)` (`PROXY_TIMEOUT_MS`, `:14`).
7. Relay the upstream status and all response headers except
   `transfer-encoding` / `connection` (`:147-150`), then the body as text.

### Error responses

| Status | Condition | Source |
|---|---|---|
| `400` | Missing `x-proxy-target` (generic) | `proxy.service.ts:62-64` |
| `400` | Missing `x-yoizen-tenant` (ySocial/yFlow) | `proxy.service.ts:86-89` |
| `404` | Tenant unknown to tenant-service | `proxy.service.ts:96-98` |
| `422` | Tenant has no `ySocialUrl` / `yFlowUrl` configured | `proxy.service.ts:100-105` |
| `502` | Any upstream failure — timeout, DNS, connection refused | `proxy.service.ts:154-157` |

## Tenant config cache

`getTenantConfig`, `proxy.service.ts:160-208`:

- `Map<string, ICacheEntry>` where `ICacheEntry = { config, expiresAt }` (`:37-40`).
- TTL 60 s (`TENANT_CACHE_TTL_MS`, `:15`); max 512 entries with FIFO eviction
  via the shared `evictOldestIfCapacityBeforeSet` (`:9`, `:190-194`).
- Source: `GET <TENANT_SERVICE_URL>/tenants/<tenantId>` with a 5 s timeout
  (`:168-171`); only `tenant.configuration` is cached (`:185-188`).
- **Failure behaviour is asymmetric on purpose**: a `404` DELETES the cache
  entry and returns null → the caller answers `404` (`:173-176`). Any other
  error (non-2xx or a thrown fetch) returns the STALE cached config if one
  exists, so a tenant-service outage does not break in-flight proxying
  (`:178-183`, `:202-207`). Only a cold cache turns such an outage into a `404`.

## Environment Variables

The whole config is two values (`src/config.ts:6-11`); nothing else in `src/`
reads `process.env`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port (`src/config.ts:7`) |
| `TENANT_SERVICE_URL` | `http://tenant-service.platform-services.svc.cluster.local` | Base URL for tenant config lookups and the health probe (`src/config.ts:8-10`) |

`src/config.ts` is NOT lazy — both values are read at module load, so setting
them after import has no effect.

## Testing

```bash
cd services/proxy-service
bun test test/unit
```

Run `bun test` directly, as shown — **do not use the package scripts.**
`"test": "bun run build && pnpm test"` and
`"test:unit": "bun run build && pnpm test test/unit"` both re-invoke this
package's own `test` script, so `pnpm test` / `pnpm test:unit` recurse: they
rebuild and re-enter forever and never reach a test runner (reproduced
2026-08-02; the log is `$ bun run build && pnpm test test/unit` repeating).
`test:integration` is not recursive but matches nothing: only `test/unit/`
exists. Fixing the scripts is a code change, escalated by the docs-truth audit
rather than done here.

## Deploy

Knative Service, min 1 / max 5, concurrency target 50, image
`dev.local/proxy-service:local`, CPU 100m–500m, memory 128Mi–256Mi
(`knative/services/base/proxy-service.yaml:14-16`, `:21`, `:37-41`).

```bash
./rebuild-redeploy.sh proxy-service dev
```
