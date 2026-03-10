# Event Processor

Consumes events from the NATS JetStream `EVENTS` stream, runs them through an ordered enrichment pipeline (validation, enrichment, transform), routes to type-specific handlers via a pluggable registry, persists results to Redis, and publishes completion events to the `RESULTS` stream.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), Redis (`localhost:6379`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (NATS + Redis) |

No other HTTP endpoints — this is a message-driven service.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health endpoint port |
| `NATS_URL` | `nats://localhost:4222` | NATS server |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

## Testing

```bash
bun test:unit          # Mocked NATS, Redis, handlers
bun test:integration   # Requires local NATS + Redis
```

## Architecture

See [AGENTS.md](AGENTS.md) for pipeline stages, handler registry, data flow diagrams, and conventions.
