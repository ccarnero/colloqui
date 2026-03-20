# API Gateway

HTTP entry point for the Yoizen event-driven platform. Validates and publishes events to NATS JetStream, serves results from Redis, streams events via SSE, and proxies requests to all downstream services. Enforces JWT authentication and tenant isolation via global guards. Dynamically routes tenant traffic to registered Knative services.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), Redis (`localhost:6379`), `JWT_SECRET` env var.

## Endpoints

### Events

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Ingest event (202 Accepted) |
| `GET` | `/results/:id` | Fetch processing result |
| `GET` | `/events/stream` | SSE real-time stream |

### Auth (proxy to auth-service)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/token` | Client credentials grant |
| `POST` | `/auth/login` | User login (platform and tenant users) |
| `POST` | `/auth/refresh` | Refresh access token |
| `GET/POST` | `/auth/users` | Platform user management |
| `GET/POST/DELETE` | `/auth/clients` | API client management |
| `GET/POST/DELETE` | `/auth/public-routes` | Public route management |
| `POST` | `/auth/tenant-users` | Create tenant user (platform scope) |
| `GET` | `/auth/tenant-users` | List tenant users |
| `GET` | `/auth/tenant-users/:id` | Get tenant user |
| `PATCH` | `/auth/tenant-users/:id` | Update tenant user |
| `DELETE` | `/auth/tenant-users/:id` | Deactivate tenant user |

### Platform Services (proxy)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit/events` | Query audit events |
| `POST/GET/PATCH/DELETE` | `/tenants` | Tenant management |
| `POST/GET/PATCH/DELETE` | `/schedulers/schedules` | Schedule management |
| `GET` | `/schedulers/executions` | Execution history |
| `POST/GET/PATCH/DELETE` | `/registry/services` | Service registry |
| `POST/PATCH/GET` | `/registry/services/:id/canary` | Canary deployments |
| `POST/GET` | `/workflows` | Workflow management |
| `POST/GET/PATCH/DELETE` | `/adapters` | HTTP adapter management |
| `GET` | `/health` | Aggregated health check |

## Tenant-User Proxy Endpoints

The gateway proxies all `/auth/tenant-users` CRUD operations to the auth-service. The `POST` endpoint (create) requires `platform` scope and validates that the `tenant_id` in the request body corresponds to an existing tenant. The `GET`, `PATCH`, and `DELETE` endpoints are accessible to both platform-scoped tokens and tenant-scoped tokens whose scope matches the requested tenant.

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

## Testing

```bash
bun test:unit          # Unit tests (mocked dependencies)
bun test:integration   # Integration tests (requires NATS + Redis)
```

## Architecture

See [AGENTS.md](AGENTS.md) for detailed architecture, module dependency graphs, data flows, and conventions.
