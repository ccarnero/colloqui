# AGENTS.md - Metrics Service

## Project Overview

The Metrics Service consumes metric events from the NATS JetStream `EVENTS` stream (filtered to `events.metrics` subject), persists them to per-tenant PostgreSQL databases, and exposes a paginated query API. It uses the `TenantConnectionManager` pattern to dynamically create connection pools to each tenant's dedicated PostgreSQL instance.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Database | Per-tenant PostgreSQL via `postgres` (postgres.js) |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                 # Bootstrap: Fastify adapter, port binding
├── app.module.ts                           # @Global() root module with NATS + TenantConnectionManager
├── providers/
│   ├── nats.provider.ts                    # NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT (metrics-writer consumer)
│   ├── postgres.provider.ts                # POSTGRES_SQL (unused, kept for reference)
│   └── tenant-connection-manager.ts        # Per-tenant PostgreSQL pools (Map-based)
└── modules/
    ├── metrics/
    │   ├── metrics.module.ts
    │   ├── metrics.controller.ts           # GET /metrics, GET /metrics/:id
    │   └── metrics.service.ts              # NATS consumer loop, per-tenant persist, query API
    └── health/
        ├── health.module.ts
        └── health.controller.ts            # GET /health

test/
├── unit/
└── integration/
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.module.ts` | `@Global()` module exporting NATS tokens and `TenantConnectionManager` |
| `src/providers/nats.provider.ts` | Creates EVENTS stream, durable consumer `metrics-writer` (filter: `events.metrics`, explicit ack, max_deliver 5) |
| `src/providers/tenant-connection-manager.ts` | Lazy pool creation per tenant; connects to `postgres.{tenantId}-{env}-ns.svc.cluster.local` |
| `src/modules/metrics/metrics.service.ts` | Consumer loop: decode envelope -> extract tenantId -> ensure schema -> INSERT metrics -> ack/nak |
| `src/modules/metrics/metrics.controller.ts` | Paginated query endpoints with source/name/date filters |

## Architecture Highlights

### Data Flow

```
NATS (events.metrics) -> consumer.consume(batch=100, expires=30s)
  -> msg.json() as EventEnvelope
  -> extract tenantId from metadata
  -> TenantConnectionManager.getConnection(tenantId)
  -> ensureTable() (lazy schema init per tenant)
  -> INSERT INTO metrics ... ON CONFLICT DO NOTHING
  -> msg.ack()   // or msg.nak() on error
```

### Module Dependency Graph

```
AppModule (@Global)
├── NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT
├── TenantConnectionManager (Map<string, Sql>)
├── MetricsModule
│   ├── MetricsController (GET /metrics, GET /metrics/:id)
│   └── MetricsService (consumer loop + query logic)
└── HealthModule -> HealthController
```

### Database Schema (per-tenant)

```sql
CREATE TABLE metrics (
    id          TEXT             PRIMARY KEY,
    source      TEXT             NOT NULL,
    name        TEXT             NOT NULL,
    value       DOUBLE PRECISION NOT NULL DEFAULT 0,
    tags        JSONB            NOT NULL DEFAULT '{}',
    metadata    JSONB            NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
-- Indexes: source, name, (source, created_at DESC), created_at DESC
```

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| NATS JetStream (EVENTS) | NATS | Inbound | Consume `events.metrics` via durable consumer `metrics-writer` |
| Per-tenant PostgreSQL | TCP | Outbound | Persist metrics to `postgres.{tenantId}-{env}-ns.svc.cluster.local` |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `JETSTREAM_CLIENT` | `Consumer` | `nats.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (health + query endpoints) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `POSTGRES_PORT` | `5432` | PostgreSQL port (per-tenant) |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | PostgreSQL password |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name for tenant namespace resolution |

### Knative

- Image: `dev.local/metrics-service:local`
- Autoscaling: min 1, max 5, target concurrency 50
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires NATS + PostgreSQL) |

## Code Style and Conventions

- **Global providers**: `AppModule` is `@Global()`, exporting all NATS tokens and `TenantConnectionManager`
- **Per-tenant pools**: `Map<string, Sql>` keyed by tenant ID, lazy creation on first message
- **Schema lazy init**: `ensureTable()` runs once per tenant (tracked via `Set<string>`)
- **Batched consumer**: `consume({ max_messages: 100, expires: 30_000 })` for efficient pull
- **Idempotent writes**: `ON CONFLICT (id) DO NOTHING` prevents duplicate inserts
- **Lifecycle hooks**: `OnModuleInit` starts consumer, `OnModuleDestroy` stops it and closes all pools

## Common Tasks

### Run locally

```bash
bun install
bun run start:dev
```

Requires local NATS (`nats://localhost:4222`) and a PostgreSQL instance per tenant.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Consumes from `events.metrics` on EVENTS stream |
| **Per-tenant PostgreSQL** | Writes metrics to `postgres.{tenantId}-{env}-ns.svc.cluster.local` |
| **api-gateway** | Upstream producer (publishes metric events) |
| **tenant-service** | Provisions the per-tenant PostgreSQL instances |
| **`@yoizen/shared`** | Stream/consumer names, `MetricsPayload`, `TENANT_HEADER` |
