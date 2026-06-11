# Registry Service

Knative-based service registry for tenant workloads. Tenants can register, deploy, update, and remove their own Knative services. Supports route management for API Gateway dynamic routing, canary deployments with progressive traffic splitting, and revision listing.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: PostgreSQL, Kubernetes cluster access.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/services` | Register and deploy a service |
| `GET` | `/services` | List registered services |
| `GET` | `/services/:id` | Get service detail |
| `PATCH` | `/services/:id` | Update service |
| `DELETE` | `/services/:id` | Remove service |
| `GET` | `/services/:id/revisions` | List Knative revisions |
| `POST` | `/services/:id/canary` | Start canary deployment |
| `PATCH` | `/services/:id/canary` | Update canary traffic % |
| `POST` | `/services/:id/canary/promote` | Promote canary |
| `POST` | `/services/:id/canary/rollback` | Rollback canary |
| `GET` | `/services/:id/canary` | Canary status |
| `POST` | `/services/:id/routes` | Create route |
| `GET` | `/services/:id/routes` | List routes |
| `DELETE` | `/services/:id/routes/:routeId` | Remove route |
| `GET` | `/routes` | Route discovery (used by API Gateway) |
| `GET` | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `postgres.support-services-dev.svc.cluster.local` | PostgreSQL host |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for Knative integration, canary flow, database schema, and conventions.
