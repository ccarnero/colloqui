# AGENTS.md - Proxy Service

## Project Overview

The Proxy Service forwards incoming HTTP requests to external servers, preserving all headers (including internally-added ones like `x-yoizen-tenant`), body, method, path, and query string. It supports three handler types: generic (target URL from `x-proxy-target` header), ySocial (target from tenant's `ySocialUrl` configuration), and yFlow (target from tenant's `yFlowUrl` configuration). Tenant configuration is fetched from tenant-service and cached in-memory with a 60s TTL and 512-entry FIFO eviction.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                         # Bootstrap: Fastify adapter, port binding
├── app.module.ts                   # Root module imports
└── modules/
    ├── proxy/
    │   ├── proxy.module.ts
    │   ├── proxy.controller.ts     # ALL /proxy/generic/**, /proxy/ysocial/**, /proxy/yflow/**
    │   └── proxy.service.ts        # Core proxy logic, tenant config caching
    └── health/
        ├── health.module.ts
        └── health.controller.ts    # GET /health
```

## Key Files

| File | Purpose |
|------|---------|
| `src/modules/proxy/proxy.service.ts` | Core proxy logic: `handleGeneric`, `handleYSocial`, `handleYFlow`, `proxyTo`, `getTenantConfig` |
| `src/modules/proxy/proxy.controller.ts` | Route handlers: root + wildcard for each of generic, ysocial, yflow |
| `src/modules/health/health.controller.ts` | Simple `{ status: 'ok' }` response |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── ProxyModule -> ProxyController, ProxyService
└── HealthModule -> HealthController
```

### Three Proxy Handlers

| Handler | Path | Target Resolution |
|---------|------|-------------------|
| **Generic** | `/proxy/generic/**` | `x-proxy-target` request header |
| **ySocial** | `/proxy/ysocial/**` | Tenant config field `ySocialUrl` |
| **yFlow** | `/proxy/yflow/**` | Tenant config field `yFlowUrl` |

### Proxy Flow

1. Resolve target base URL (from header or tenant config)
2. Extract remaining path after handler prefix and query string
3. Build upstream URL: `{targetBaseUrl}{remainingPath}{queryString}`
4. Copy all request headers except hop-by-hop (`host`, `connection`, `transfer-encoding`)
5. Forward request body for non-GET/HEAD methods via `JSON.stringify`
6. Execute `fetch()` with `AbortSignal.timeout(30_000)`
7. Return upstream status, headers (except `transfer-encoding`, `connection`), and body

### Tenant Config Caching

- **Storage**: `Map<string, CacheEntry>` where `CacheEntry = { config, expiresAt }`
- **TTL**: 60 seconds (`TENANT_CACHE_TTL_MS`)
- **Max entries**: 512 (`TENANT_CACHE_MAX`) with FIFO eviction
- **Source**: `GET {TENANT_SERVICE_URL}/tenants/{tenantId}` with 5s timeout
- **Fallback**: On fetch failure, returns stale cached config if available; on 404, removes cache entry

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `ALL` | `/proxy/generic` | Proxy to `x-proxy-target` header URL |
| `ALL` | `/proxy/generic/*` | Proxy to `x-proxy-target` header URL with sub-path |
| `ALL` | `/proxy/ysocial` | Proxy to tenant's `ySocialUrl` |
| `ALL` | `/proxy/ysocial/*` | Proxy to tenant's `ySocialUrl` with sub-path |
| `ALL` | `/proxy/yflow` | Proxy to tenant's `yFlowUrl` |
| `ALL` | `/proxy/yflow/*` | Proxy to tenant's `yFlowUrl` with sub-path |
| `GET` | `/health` | Health check |

### Error Responses

| Status | Condition |
|--------|-----------|
| 400 | Missing `x-proxy-target` header (generic) or missing tenant header (ySocial/yFlow) |
| 404 | Tenant not found in tenant-service |
| 422 | Tenant does not have `ySocialUrl` or `yFlowUrl` configured |
| 502 | Upstream fetch failed (timeout, network error, etc.) |

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| tenant-service | HTTP | Fetch tenant configuration for ySocial/yFlow handlers |
| External servers | HTTP | Proxy target (generic, ySocialUrl, yFlowUrl) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TENANT_SERVICE_URL` | `http://tenant-service.platform-services.svc.cluster.local` | Tenant service base URL |

### Knative

- Image: `dev.local/proxy-service:local`
- Autoscaling: min 1, max 5, target concurrency 50
- Readiness probe: `GET /health` on port 3000
- Resources: 100m-500m CPU, 128Mi-256Mi memory

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| *(none in-service)* | No `test/integration/` directory; `package.json` `test:integration` is reserved |

## Code Style and Conventions

- **Hop-by-hop filtering**: `Set<string>` for O(1) header exclusion check
- **Tenant config cache**: `Map<string, CacheEntry>` with TTL and FIFO eviction at 512 entries
- **Stale fallback**: On tenant-service errors, returns stale cached config rather than failing
- **Path extraction**: Pure functions `extractPath` and `extractQuery` for URL manipulation
- **Proxy pattern**: Native `fetch()` with `AbortSignal.timeout(30_000)` for all upstream calls
- **Module layout**: Feature modules under `src/modules/`

## Common Tasks

### Add a new proxy handler

1. Add a handler method to `ProxyService` (resolve target URL, call `proxyTo`)
2. Add root + wildcard route handlers to `ProxyController`

### Run locally

```bash
pnpm install
bun run start:dev   # watch mode on src/main.ts
```

Requires tenant-service reachable at `TENANT_SERVICE_URL` for ySocial/yFlow handlers. Generic handler works standalone.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **tenant-service** | HTTP fetch for tenant configuration (ySocial/yFlow handlers) |
| **api-gateway** | Upstream proxy — all requests arrive through the gateway at `/proxy/**` |
| **`@yoizen/shared`** | `TENANT_HEADER` constant |
