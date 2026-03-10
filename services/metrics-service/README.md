# Metrics Service

Consumes metric events from the NATS JetStream `EVENTS` stream (filtered to `events.metrics`) and persists them to per-tenant PostgreSQL databases. Exposes a paginated query API for metric lookup by source, name, and date range.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), per-tenant PostgreSQL.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/metrics` | Query metrics (source, name, from, to, limit, offset) |
| `GET` | `/metrics/:id` | Get single metric |
| `GET` | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment for tenant namespace resolution |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for per-tenant connection management, consumer details, and conventions.
