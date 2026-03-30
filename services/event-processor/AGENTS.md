# AGENTS.md - Event Processor

## Project Overview

The Event Processor consumes domain events from the NATS JetStream `EVENTS` stream, runs them through an ordered enrichment pipeline (validation, enrichment, adapter enrichment, transform, adapter forwarding), routes them to type-specific handlers resolved via a pluggable registry, persists results to Redis, and publishes completion events to the `RESULTS` stream. Adapter pipeline stages resolve configuration from the adapter-service via `AdapterClient` (Redis SWR cache) and are non-blocking on failure. It is a message-driven service with no inbound HTTP API beyond `/health`.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Cache/Store | Redis via `ioredis` |
| Validation | AJV (pipeline payload schemas) |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                             # Bootstrap: Fastify adapter, port binding
├── app.module.ts                       # @Global() root module with NATS + Redis providers
├── providers/
│   ├── nats.provider.ts                # NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT, JETSTREAM_PUBLISHER
│   └── redis.provider.ts              # REDIS_CLIENT
├── handlers/
│   ├── event-handler.interface.ts      # EventHandler interface
│   ├── event-type.decorator.ts         # @EventType('...') class decorator
│   ├── handler-registry.ts             # DiscoveryService-based Map<string, EventHandler> lookup
│   ├── created.handler.ts              # @EventType('created')
│   ├── updated.handler.ts              # @EventType('updated')
│   ├── deleted.handler.ts              # @EventType('deleted')
│   ├── default.handler.ts              # Fallback handler for unknown types
│   └── index.ts                        # Barrel export
├── pipeline/
│   ├── pipeline-stage.interface.ts     # PipelineStage and PipelineContext interfaces
│   ├── pipeline-runner.ts              # Sorts stages by order, runs sequentially
│   ├── pipeline.module.ts              # Provides all stages + PipelineRunner
│   ├── validation.stage.ts             # Order 10: AJV schema validation (pass-through if no schema)
│   ├── enrichment.stage.ts             # Order 20: Adds correlationId, receivedAt, source metadata
│   ├── adapter-enrichment.stage.ts     # Order 25: Fetches data from adapter endpoint, merges into payload._enriched
│   ├── transform.stage.ts             # Order 30: Runs registered PayloadTransformer functions
│   ├── adapter-forward.stage.ts        # Order 40: POSTs payload to adapter endpoint with retry
│   └── index.ts                        # Barrel export
└── modules/
    ├── processor/
    │   ├── processor.module.ts         # Imports DiscoveryModule + PipelineModule, registers handlers
    │   └── processor.service.ts        # Main consumer loop, pipeline + handler invocation, Redis + RESULTS publish
    └── health/
        ├── health.module.ts
        └── health.controller.ts        # GET /health (NATS + Redis)

test/
├── unit/
│   ├── processor.service.spec.ts
│   └── health.controller.spec.ts
└── integration/
    └── processor.integration.spec.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.module.ts` | `@Global()` module exporting all NATS and Redis tokens |
| `src/providers/nats.provider.ts` | Creates EVENTS and RESULTS streams, durable consumer `event-processor` (explicit ack, max_deliver 5) |
| `src/handlers/handler-registry.ts` | Uses `DiscoveryService` + `Reflector` to find `@EventType()` providers, stores in `Map` for O(1) lookup |
| `src/handlers/event-type.decorator.ts` | `@EventType(type)` sets metadata via `SetMetadata` |
| `src/handlers/event-handler.interface.ts` | `EventHandler` contract: `handle(eventId, payload) -> EventResult` |
| `src/pipeline/pipeline-runner.ts` | Sorts stages by `order` at construction, runs them sequentially per message |
| `src/pipeline/validation.stage.ts` | AJV validation against registered per-type schemas |
| `src/pipeline/enrichment.stage.ts` | Attaches `metadata.receivedAt`, `metadata.correlationId`, `metadata.source` |
| `src/pipeline/transform.stage.ts` | Runs registered `PayloadTransformer` functions in sequence |
| `src/modules/processor/processor.service.ts` | Consumer loop: decode -> pipeline -> handler -> Redis setex + RESULTS publish -> ack/nak |

## Architecture Highlights

### Data Flow

```
NATS (events.>) -> consumer.consume(batch=100, expires=30s)
  -> msg.json() as EventEnvelope
  -> PipelineRunner:
       ValidationStage(10) -> EnrichmentStage(20) -> AdapterEnrichmentStage(25)
       -> TransformStage(30) -> AdapterForwardStage(40)
  -> HandlerRegistry.get(type) ?? DefaultHandler
  -> handler.handle(eventId, payload) -> EventResult
  -> Promise.all([
       redis.setex(result:<id>, 3600, JSON),
       publisher.publish(results.<type>, CompletionEvent)
     ])
  -> msg.ack()   // or msg.nak() on error
```

### Module Dependency Graph

```
AppModule (@Global)
├── NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT, JETSTREAM_PUBLISHER, REDIS_CLIENT
├── ProcessorModule
│   ├── DiscoveryModule (NestJS core)
│   ├── PipelineModule -> ValidationStage, EnrichmentStage, AdapterEnrichmentStage, TransformStage, AdapterForwardStage, PipelineRunner
│   ├── HandlerRegistry (Map-based, O(1) lookup)
│   ├── CreatedHandler, UpdatedHandler, DeletedHandler, DefaultHandler
│   └── ProcessorService (consumer loop)
└── HealthModule -> HealthController
```

### Handler Registry

Handlers are discovered automatically at startup via NestJS `DiscoveryService`. Each handler is decorated with `@EventType('type')` and implements the `EventHandler` interface. The registry stores them in a `Map<string, EventHandler>`.

| Handler | Event Type | Behavior |
|---------|------------|----------|
| `CreatedHandler` | `created` | Returns `{ processed: true }` |
| `UpdatedHandler` | `updated` | Returns `{ processed: true }` |
| `DeletedHandler` | `deleted` | Returns `{ processed: true }` |
| `DefaultHandler` | *(fallback)* | Processes if payload has content |

### Pipeline Stages

Stages implement `PipelineStage` interface with an `order` property. They are sorted once at `PipelineRunner` construction and run sequentially for each message.

| Stage | Order | Purpose |
|-------|-------|---------|
| `ValidationStage` | 10 | AJV validation per registered schema (no schema = pass-through) |
| `EnrichmentStage` | 20 | Adds `metadata.receivedAt`, `metadata.correlationId`, `metadata.source` |
| `AdapterEnrichmentStage` | 25 | If `enrichAdapter` present, fetches data from adapter endpoint via `AdapterClient`, merges into `payload._enriched`. Non-blocking on failure |
| `TransformStage` | 30 | Runs registered payload transformers in sequence |
| `AdapterForwardStage` | 40 | If `forwardAdapter` present, POSTs payload to adapter endpoint with exponential backoff retry. Non-blocking on failure |

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| NATS JetStream (EVENTS) | NATS | Inbound | Consume events from `events.>` via durable consumer `event-processor` |
| NATS JetStream (RESULTS) | NATS | Outbound | Publish completion events to `results.<type>` |
| Redis | TCP | Outbound | Store results at `result:<eventId>` with TTL 3600s; adapter config SWR cache |
| adapter-service | HTTP | Outbound | Fetch adapter config for enrichment/forward stages via `AdapterClient` |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `JETSTREAM_CLIENT` | `Consumer` | `nats.provider.ts` |
| `JETSTREAM_PUBLISHER` | `JetStreamClient` | `nats.provider.ts` |
| `REDIS_CLIENT` | `Redis` (ioredis) | `redis.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (health endpoint) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `ADAPTER_SERVICE_URL` | `http://adapter-service.platform-services-dev.svc.cluster.local` | Adapter service URL |

### Stream Configuration (from `@yoizen/shared`)

| Stream | Retention | Max Age | Max Bytes |
|--------|-----------|---------|-----------|
| `EVENTS` | Limits | 7 days | 512 MB |
| `RESULTS` | Limits | 7 days | 256 MB |

Consumer: `event-processor` -- explicit ack, deliver all, max deliver 5.

### Knative

- Image: `dev.local/event-processor:local`
- Autoscaling: KPA, target concurrency
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests (mocked NATS, Redis, handlers, pipeline) |
| `bun test test/integration` | Integration tests (requires local NATS on :4222 and Redis on :6379) |

Unit tests mock all DI tokens and verify `processEvent` logic, handler routing, stats tracking, and health responses. Integration tests publish to real NATS and verify Redis results.

## Code Style and Conventions

- **Global providers**: `AppModule` is `@Global()`, exporting all NATS and Redis tokens
- **Handler discovery**: `DiscoveryService` + `Reflector` scans for `@EventType()` metadata at init
- **Map-based registry**: `Map<string, EventHandler>` for O(1) handler lookup by event type
- **Map-based stats**: `Map<string, number>` tracks per-type processing counts
- **Pipeline sorting**: stages sorted by `order` once at construction time, O(n) per message
- **Batched consumer**: `consume({ max_messages: 100, expires: 30_000 })` for efficient pull
- **Parallel writes**: `Promise.all` for concurrent Redis setex + NATS RESULTS publish
- **Lifecycle hooks**: `OnModuleInit` starts the consumer loop; `OnModuleDestroy` stops it
- **Explicit ack/nak**: messages are acked on success, naked on failure for redelivery

## Common Tasks

### Add a new event handler

1. Create a file in `src/handlers/`, e.g. `my-type.handler.ts`
2. Implement `EventHandler` interface and decorate with `@EventType('my-type')` and `@Injectable()`
3. Register the handler in `ProcessorModule` providers array
4. The `HandlerRegistry` discovers it automatically at startup

```typescript
import { Injectable } from '@nestjs/common';
import type { EventResult } from '@yoizen/shared';
import { EventType } from './event-type.decorator';
import type { EventHandler } from './event-handler.interface';

@Injectable()
@EventType('my-type')
export class MyTypeHandler implements EventHandler {
  readonly eventType = 'my-type';

  async handle(eventId: string, payload: unknown): Promise<EventResult> {
    return { processed: true, data: { eventId } };
  }
}
```

### Add a new pipeline stage

1. Create a file in `src/pipeline/`, e.g. `my-stage.ts`
2. Implement `PipelineStage` with an `order` value (stages run lowest-to-highest)
3. Register it in `PipelineModule` providers
4. Inject it into `PipelineRunner` constructor and add to the sorted array

### Register a JSON schema for payload validation

```typescript
validationStage.registerSchema('my-type', {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
});
```

### Register a payload transformer

```typescript
transformStage.registerTransformer((payload) => {
  // transform and return modified payload
  return { ...payload, transformed: true };
});
```

### Run locally

```bash
bun install
bun run start:dev   # watch mode on src/main.ts
```

Requires local NATS (`nats://localhost:4222`) and Redis (`localhost:6379`).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Consumes from EVENTS stream, publishes to RESULTS stream |
| **Redis** | Writes processed results at `result:<eventId>`; adapter config SWR cache |
| **adapter-service** | Provides adapter config via REST API (fetched through `AdapterClient`) |
| **api-gateway** | Upstream producer (publishes events to EVENTS stream) |
| **webhook-service** | Downstream consumer (consumes from RESULTS stream) |
| **`@yoizen/shared`** | Stream names, subject prefixes, consumer names, key prefixes, TTLs, limits, interfaces, `AdapterClient`, `DEFAULT_ADAPTER_SERVICE_URL` |
| **`@yoizen/observability`** | `tracedFetch` for adapter HTTP calls |
