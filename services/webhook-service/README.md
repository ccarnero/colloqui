# Webhook Service

Consumes completion events from the NATS JetStream `RESULTS` stream and delivers them to client-specified callback URLs via HTTP POST with exponential backoff retry (1s, 5s, 30s). Failed deliveries after 3 attempts are published to a DLQ stream.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

No other HTTP endpoints — this is a message-driven service.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health endpoint port |
| `NATS_URL` | `nats://localhost:4222` | NATS server |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for retry policy, DLQ details, delivery tracking, and conventions.
