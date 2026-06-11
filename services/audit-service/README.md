# Audit Service

Consumes all events from the NATS JetStream `EVENTS` stream via the `audit-writer` consumer and persists them to per-tenant PostgreSQL databases. Exposes a paginated query API for historical event lookup.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), per-tenant PostgreSQL.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit/events` | Query events (type, from, to, limit, offset) |
| `GET` | `/audit/events/:id` | Get single event |
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
