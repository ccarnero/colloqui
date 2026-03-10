# API Gateway

HTTP entry point for the Yoizen event-driven platform. Validates and publishes events to NATS JetStream, serves results from Redis, streams events via SSE, and proxies requests to all downstream services. Enforces JWT authentication and tenant isolation via global guards. Dynamically routes tenant traffic to registered Knative services.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), Redis (`localhost:6379`), `JWT_SECRET` env var.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Ingest event (202 Accepted) |
| `GET` | `/results/:id` | Fetch processing result |
| `GET` | `/events/stream` | SSE real-time stream |
| `POST` | `/auth/token` | Client credentials grant |
| `POST` | `/auth/login` | User login |
| `POST` | `/auth/refresh` | Refresh access token |
| `GET/POST/DELETE` | `/auth/users` | Platform user management |
| `GET/POST/DELETE` | `/auth/clients` | API client management |
| `GET/POST/DELETE` | `/auth/public-routes` | Dynamic public route management |
| `GET` | `/audit/events` | Query audit events |
| `POST/GET/DELETE` | `/tenants` | Tenant management |
| `POST/GET/PATCH/DELETE` | `/schedulers/schedules` | Schedule management |
| `GET` | `/schedulers/executions` | Execution history |
| `POST/GET/PATCH/DELETE` | `/registry/services` | Service registry |
| `POST/PATCH/GET` | `/registry/services/:id/canary` | Canary deployments |
| `POST/GET` | `/workflows` | Workflow management |
| `GET` | `/health` | Aggregated health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | *(required)* | HS256 signing key |

## Testing

```bash
bun test:unit          # Unit tests (mocked dependencies)
bun test:integration   # Integration tests (requires NATS + Redis)
```

## Architecture

See [AGENTS.md](AGENTS.md) for detailed architecture, module dependency graphs, data flows, and conventions.
