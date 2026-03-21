# Adapter Service

Multi-tenant HTTP adapter configuration service. Manages adapters (base URL, auth type, custom headers, timeouts, retries) and their endpoints per tenant. Stores configuration in PostgreSQL via `postgres.js` (raw SQL, no ORM). Consumed by `AdapterClient` in workflow-http-worker, event-processor, and webhook-service.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: PostgreSQL (`localhost:5432`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/adapters` | Create adapter (+ optional inline endpoints) |
| `GET` | `/adapters` | List adapters for tenant (optional `?context=` filter) |
| `GET` | `/adapters/:id` | Get adapter with endpoints |
| `PATCH` | `/adapters/:id` | Partial update adapter |
| `DELETE` | `/adapters/:id` | Delete adapter (cascades endpoints) |
| `POST` | `/adapters/:id/endpoints` | Add endpoint to adapter |
| `DELETE` | `/adapters/:id/endpoints/:epId` | Remove endpoint |
| `GET` | `/health` | Health check (PostgreSQL connectivity) |

All adapter routes require `x-yoizen-tenant` header for tenant scoping.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `postgres.support-services-dev.svc.cluster.local` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | Database name |
| `POSTGRES_USER` | `yoizen` | Database user |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | Database password |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for database schema, module dependency graph, DI tokens, and conventions.
