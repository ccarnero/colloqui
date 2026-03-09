# AGENTS.md - Webhook Service

## Project Overview

The Webhook Service consumes completion events from the NATS JetStream `RESULTS` stream and delivers them to client-specified callback URLs via HTTP POST. It implements retry with exponential backoff (3 attempts at 1s, 5s, 30s intervals) and publishes permanently failed deliveries to a Dead Letter Queue (DLQ) stream. It is a purely message-driven service with no inbound HTTP API beyond `/health`.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                         # Bootstrap: Fastify adapter, port binding
├── app.module.ts                   # @Global() root module with NATS providers
├── providers/
│   └── nats.provider.ts            # NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CONSUMER, JETSTREAM_PUBLISHER
└── modules/
    ├── webhook/
    │   ├── webhook.module.ts
    │   └── webhook.service.ts      # NATS consumer + HTTP callback dispatch + retry + DLQ
    └── health/
        ├── health.module.ts
        └── health.controller.ts    # GET /health

test/
├── unit/                           # (scripts defined, tests not yet implemented)
└── integration/                    # (scripts defined, tests not yet implemented)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.module.ts` | `@Global()` module exporting all NATS tokens |
| `src/providers/nats.provider.ts` | Creates RESULTS stream, DLQ stream, durable consumer `webhook-dispatcher` |
| `src/modules/webhook/webhook.service.ts` | Core logic: consume -> dispatch with retry -> DLQ on exhaustion |
| `src/modules/health/health.controller.ts` | Simple `{ status: 'ok' }` response |

## Architecture Highlights

### Data Flow

```
NATS (results.>) -> consumer.consume(batch=50, expires=30s)
  -> msg.json() as CompletionEvent
  -> if no callbackUrl: ack and skip
  -> dispatchWithRetry:
       for attempt 0..2:
         -> fetch(POST callbackUrl, body=result, timeout=10s)
         -> if 2xx: ack and return
         -> sleep(RETRY_DELAYS[attempt])  // 1s, 5s, 30s
       -> on exhaustion: publish to DLQ (dlq.webhook) and ack
```

### Retry Policy (from `@yoizen/shared`)

| Setting | Value |
|---------|-------|
| Max retries | 3 (`WEBHOOK_MAX_RETRIES`) |
| Retry delays | 1s, 5s, 30s (`WEBHOOK_RETRY_DELAYS`) |
| Request timeout | 10s (`AbortSignal.timeout`) |
| DLQ subject | `dlq.webhook` (`WEBHOOK_DLQ_SUBJECT`) |

### NATS Streams

| Stream | Subjects | Purpose |
|--------|----------|---------|
| `RESULTS` | `results.>` | Inbound completion events |
| `DLQ` | `dlq.>` | Failed webhook deliveries (64 MB max, 7-day retention) |

### Module Dependency Graph

```
AppModule (@Global)
├── NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CONSUMER, JETSTREAM_PUBLISHER
├── WebhookModule -> WebhookService
└── HealthModule -> HealthController
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |

No other HTTP endpoints -- this service is message-driven.

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `JETSTREAM_CONSUMER` | `Consumer` | `nats.provider.ts` (RESULTS stream, `webhook-dispatcher` consumer) |
| `JETSTREAM_PUBLISHER` | `JetStreamClient` | `nats.provider.ts` (for DLQ publishing) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (health endpoint only) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |

### Knative

- Image: `dev.local/webhook-service:local`
- Autoscaling: min 1, max 5, target concurrency 50
- Readiness probe: `GET /health` on port 3000
- Resources: 100m-500m CPU, 128Mi-256Mi memory

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests |

Test scripts are defined but test files are not yet implemented. When adding tests, mock `JETSTREAM_CONSUMER` and `JETSTREAM_PUBLISHER` tokens for unit tests. Integration tests should require local NATS on `:4222`.

## Code Style and Conventions

- **Global providers**: `AppModule` is `@Global()`, exporting all NATS tokens
- **Lifecycle hooks**: `OnModuleInit` starts consumer; `OnModuleDestroy` stops it
- **Iterator-based consumption**: `for await (msg of consumeIterator)` with explicit ack/nak
- **Retry with backoff**: loop with `WEBHOOK_RETRY_DELAYS` array for sleep between attempts
- **Request timeout**: `AbortSignal.timeout(10_000)` on every `fetch()` call
- **DLQ pattern**: after all retries exhausted, publish original `CompletionEvent` to `dlq.webhook`
- **Delivery tracking**: `Map<string, number>` tracks per-event delivery attempt counts, capped at 10k entries with FIFO eviction
- **No callbackUrl = skip**: messages without a `callbackUrl` are immediately acked
- **Batch consumer**: `consume({ max_messages: 50, expires: 30_000 })`

## Common Tasks

### Modify retry behavior

Retry constants are defined in `@yoizen/shared` (`packages/shared/src/constants.ts`):
- `WEBHOOK_MAX_RETRIES` -- number of attempts
- `WEBHOOK_RETRY_DELAYS` -- array of millisecond delays between attempts
- `WEBHOOK_DLQ_SUBJECT` -- subject for failed deliveries

### Add webhook delivery metrics or logging

Extend the `trackDelivery` method in `WebhookService` or add a metrics provider.

### Run locally

```bash
bun install
bun run start:dev   # watch mode on src/main.ts
```

Requires local NATS (`nats://localhost:4222`). The RESULTS stream must exist (created by the event-processor on startup).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Consumes from RESULTS stream, publishes to DLQ stream |
| **event-processor** | Upstream producer (publishes completion events to RESULTS stream) |
| **api-gateway** | Calls `/health` for aggregated health checks |
| **`@yoizen/shared`** | Stream names, consumer names (`WEBHOOK_CONSUMER_NAME`), DLQ config, retry constants, interfaces (`CompletionEvent`) |
