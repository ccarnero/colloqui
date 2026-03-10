# Scheduler Service

Multi-tenant job scheduling service with support for cron, interval, and one-time executions. Dispatches jobs to pluggable executors (inline JS, Kubernetes Jobs). State persisted in per-tenant PostgreSQL databases.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: PostgreSQL (per-tenant), Kubernetes cluster access.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/schedules` | Create schedule |
| `GET` | `/schedules` | List schedules |
| `GET` | `/schedules/:id` | Get schedule |
| `PATCH` | `/schedules/:id` | Update schedule |
| `DELETE` | `/schedules/:id` | Delete schedule |
| `POST` | `/schedules/:id/trigger` | Manual trigger |
| `GET` | `/schedules/:id/executions` | Schedule execution history |
| `GET` | `/executions` | All executions |
| `GET` | `/executions/:id` | Get execution detail |
| `GET` | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment for tenant namespace resolution |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for engine tick loop, executor registry, schedule queue, and conventions.
