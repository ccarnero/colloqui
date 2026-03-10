# Workflow Service

REST API for Temporal workflow management plus an orchestrator worker. Workflows are defined as ordered action sequences (endpoint calls, inline JS, NATS service bus calls, parallel branches) with template resolution. Runs as two processes: NestJS API server and Temporal worker.

## Quick Start

```bash
bun install

# API server
bun run start:dev

# Worker (separate terminal)
bun run start:worker:dev
```

Requires: Temporal server (`localhost:7233`), NATS (`nats://localhost:4222`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/workflows` | Start workflow (202 Accepted) |
| `GET` | `/workflows` | List workflows for tenant |
| `GET` | `/workflows/:id` | Get workflow status/result |
| `GET` | `/health` | Health check (Temporal connectivity) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `NATS_URL` | `nats://localhost:4222` | NATS server |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for action types, template resolution, dual-process architecture, and conventions.
