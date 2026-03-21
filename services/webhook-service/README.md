# Webhook Service

Consumes completion events from the NATS JetStream `RESULTS` stream and delivers them to client-specified callback URLs via HTTP POST with exponential backoff retry (1s, 5s, 30s). When a `CompletionEvent` includes an `adapterId`, the service fetches the adapter configuration via `AdapterClient` to inject custom headers, auth credentials, and use adapter-specific retry/timeout settings for the webhook delivery. Failed deliveries after retries are published to a DLQ stream.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), Redis (`localhost:6379`).

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
| `ADAPTER_SERVICE_URL` | `http://adapter-service...` | Adapter service URL |
| `REDIS_HOST` | `localhost` | Redis host (adapter cache) |
| `REDIS_PORT` | `6379` | Redis port |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for retry policy, DLQ details, delivery tracking, and conventions.
