# Workflow HTTP Worker

Standalone Temporal worker that executes HTTP-based workflow activities on the `workflow-http` task queue. Makes HTTP requests to arbitrary endpoints via `axios` with tenant header injection. No NestJS framework — raw Temporal worker with health server.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: Temporal server (`localhost:7233`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check (200 ok / 503 starting) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for activity details, worker configuration, and conventions.
