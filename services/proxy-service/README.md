# Proxy Service

Proxies incoming HTTP requests to external servers, preserving all headers, body, method, path, and query string. Supports three handlers: generic (target via header), ySocial (target from tenant config `ySocialUrl`), and yFlow (target from tenant config `yFlowUrl`). Tenant configuration is cached in-memory with 60s TTL.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: tenant-service reachable at `TENANT_SERVICE_URL` (for ySocial/yFlow handlers).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `ALL` | `/proxy/generic/**` | Proxy to URL in `x-proxy-target` header |
| `ALL` | `/proxy/ysocial/**` | Proxy to tenant's `ySocialUrl` |
| `ALL` | `/proxy/yflow/**` | Proxy to tenant's `yFlowUrl` |
| `GET` | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TENANT_SERVICE_URL` | `http://tenant-service.platform-services.svc.cluster.local` | Tenant service for config lookup |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for proxy flow, tenant config caching, and conventions.
