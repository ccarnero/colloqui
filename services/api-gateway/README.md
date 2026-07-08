# API Gateway

HTTP entry point for the Yoizen event-driven platform. Validates and publishes events to NATS JetStream, serves results from Redis, streams events via SSE, and proxies requests to all downstream services. Enforces JWT authentication and tenant isolation via global guards. Dynamically routes tenant traffic to registered Knative services.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), Redis (`localhost:6379`), `JWT_SECRET` env var.

## API Versioning

All application routes are externally served under the global `/api` prefix
plus NestJS URI versioning (`src/main.ts`), with no per-controller
`@Version()` decorators needed:

```ts
app.setGlobalPrefix("api", { exclude: [...] });
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: ["1", VERSION_NEUTRAL],
});
```

- Canonical routes are `/api/v1/...`.
- The unversioned `/api/...` alias still resolves (`VERSION_NEUTRAL`) but is
  treated as deprecated: responses get a `Deprecation: true` header and a
  `Link: <.../api/v1/...>; rel="successor-version"` header pointing callers
  at the versioned path.
- `/api/docs` (Swagger) is listed in `VERSIONING_EXEMPT_PREFIXES` and is
  never flagged as deprecated, since it was never a versioned route.
- The tables below show the unversioned form for brevity; prefer
  `/api/v1/...` in new clients.

## Endpoints

All application routes are externally served under the global `/api` prefix.
Only health-style routes such as `/health` and `/readyz` are excluded.

### Events

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/events` | Ingest event (202 Accepted) |
| `GET` | `/api/results/:id` | Fetch processing result |
| `GET` | `/api/events/stream` | SSE real-time stream |

### Auth (proxy to auth-service)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/token` | Client credentials grant |
| `POST` | `/api/auth/login` | User login (platform and tenant users) |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `GET/POST` | `/api/auth/users` | Platform user management |
| `GET/POST/DELETE` | `/api/auth/clients` | API client management |
| `GET/POST/DELETE` | `/api/auth/public-routes` | Public route management |
| `POST` | `/api/auth/tenant-users` | Create tenant user (platform or matching tenant scope) |
| `GET` | `/api/auth/tenant-users` | List tenant users |
| `GET` | `/api/auth/tenant-users/:id` | Get tenant user |
| `PATCH` | `/api/auth/tenant-users/:id` | Update tenant user |
| `DELETE` | `/api/auth/tenant-users/:id` | Deactivate tenant user |

### Platform Services (proxy)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit/events` | Query audit events |
| `POST/GET/PATCH/DELETE` | `/api/tenants` | Tenant management |
| `POST/GET/PATCH/DELETE` | `/api/registry/services` | Service registry |
| `POST/PATCH/GET` | `/api/registry/services/:id/canary` | Canary deployments |
| `POST/GET` | `/api/workflows` | Workflow management |
| `POST/GET/PATCH/DELETE` | `/api/connectors` | HTTP connector management |
| `GET` | `/health` | Aggregated health check |

## Tenant-User Proxy Endpoints

The gateway proxies all `/api/auth/tenant-users` CRUD operations to the auth-service. The `POST` endpoint (create) allows `platform` scope or a matching tenant-scoped `tenant_admin` at the gateway (`@Scopes("platform", "tenant")`). The create path validates that the `tenant_id` in the request body corresponds to an existing tenant; tenant admins cannot create users for another tenant. The `GET`, `PATCH`, and `DELETE` endpoints are accessible to platform-scoped tokens and tenant-scoped tokens whose scope matches the resolved tenant.

The existing `AuthGuard` automatically enforces that a JWT with `scope: 'tenant:acme'` can only access resources when `x-yoizen-tenant: acme`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | *(required)* | HS256 signing key |
| `AUTH_SERVICE_URL` | `http://auth-service...` | Auth service URL |
| `TENANT_SERVICE_URL` | `http://tenant-service...` | Tenant service URL |
| `CONNECTOR_ADMIN_URL` | `http://connector-admin-api...` | Connector admin proxy URL |
| `PROXY_SERVICE_URL` | `http://proxy-service...` | Proxy service URL |
| `AGENT_MEMORY_SERVICE_URL` | `http://agent-memory-service...` | Agent memory service proxy URL |

## Testing

```bash
bun test:unit          # Unit tests (mocked dependencies)
bun test:integration   # Integration tests (requires NATS + Redis)
```

## Architecture

See [AGENTS.md](AGENTS.md) for detailed architecture, module dependency graphs, data flows, and conventions.
