# AGENTS.md - Audit Service

## Project Overview

The Audit Service consumes domain events from the NATS JetStream `EVENTS` stream via durable consumer `audit-writer`, persists every event to per-tenant MongoDB databases, and exposes a paginated query API. It uses the `TenantConnectionManager` pattern to dynamically create connection pools to each tenant's dedicated MongoDB instance, with lazy schema initialization on first message per tenant.

## Storage engines

Supports **Postgres** (default) and **Mongo** per-tenant via `AuditTenantConnectionManager` (postgres/mongo variants) and repository adapters. See [DOCS/runbooks/storage-engines.md](../../DOCS/runbooks/storage-engines.md).

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Database | Per-tenant MongoDB via official `mongodb` driver |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                 # Bootstrap: Fastify adapter, port binding
├── app.module.ts                           # @Global() root module with NATS + TenantConnectionManager
├── common/
│   ├── audit-list-helpers.ts               # Pagination helpers
│   ├── gateway-audit-projection.ts         # Shared SQL SELECT list for gateway_audit_events
│   └── channel-audit-projection.ts         # Shared SQL SELECT list for channel_events
├── providers/
│   └── nats.provider.ts                    # NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT (audit-writer consumer)
└── modules/
    ├── audit/
    │   ├── audit.module.ts
    │   ├── audit.controller.ts             # GET /audit/events, GET /audit/events/:id
    │   └── audit.service.ts                # NATS consumer loop, per-tenant persist, query API
    ├── channel-audit/
    │   ├── channel-audit.controller.ts
    │   └── channel-audit.service.ts        # Channel message audit ingest + query
    ├── gateway-audit/
    │   ├── gateway-audit.controller.ts
    │   └── gateway-audit.service.ts        # Gateway audit ingest + query + dashboard stats
    └── health/
        ├── health.module.ts
        └── health.controller.ts            # GET /health

test/
└── unit/                                   # Controller + service unit tests (no integration/ in repo)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.module.ts` | `@Global()` module exporting all NATS tokens and `TenantConnectionManager` |
| `src/providers/nats.provider.ts` | Creates EVENTS stream, durable consumer `audit-writer` (explicit ack, all subjects, max_deliver 5) |
| `TenantConnectionManager` | From `@yoizen/database`; lazy pool per tenant to `mongo.{tenantId}-{env}-ns.svc.cluster.local` |
| `src/modules/audit/audit.service.ts` | Consumer loop: decode envelope -> extract tenantId -> ensure schema -> INSERT events -> ack/nak |
| `src/modules/audit/audit.controller.ts` | Paginated query endpoints with type/date filters |

## Architecture Highlights

### Data Flow

```
NATS (events.>) -> consumer.consume(batch=100, expires=30s)
  -> msg.json() as EventEnvelope
  -> extract tenantId from envelope.metadata.tenantId
  -> TenantConnectionManager.getConnection(tenantId)
  -> ensureTable() (lazy schema init per tenant)
  -> INSERT INTO events ... ON CONFLICT DO NOTHING
  -> msg.ack()   // or msg.nak() on error
```

### Module Dependency Graph

```
AppModule (@Global)
├── NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT
├── TenantConnectionManager (Map<string, MongoClient>)
├── AuditModule
│   ├── AuditController (GET /audit/events, GET /audit/events/:id)
│   └── AuditService (consumer loop + query logic)
└── HealthModule -> HealthController
```

### Database Schema (per-tenant)

```sql
CREATE TABLE events (
    id          TEXT        PRIMARY KEY,
    type        TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}',
    metadata    JSONB       NOT NULL DEFAULT '{}',
    subject     TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexes: type, created_at DESC, (type, created_at DESC)
```

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| NATS JetStream (EVENTS) | NATS | Inbound | Consume all events via durable consumer `audit-writer` |
| Per-tenant MongoDB | TCP | Outbound | Persist events to `mongo.{tenantId}-{env}-ns.svc.cluster.local` |

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
| `MONGO_PORT` | `27017` | MongoDB port (per-tenant) |
| `MONGO_USER` | `yoizen` | MongoDB username |
| `MONGO_PASSWORD` | `yoizen-dev-password` | MongoDB password |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name for tenant namespace resolution |

### Stream Configuration (from `@yoizen/shared`)

| Stream | Retention | Max Age | Max Bytes |
|--------|-----------|---------|-----------|
| `EVENTS` | Limits | 7 days | 512 MB |

Consumer: `audit-writer` -- explicit ack, deliver all, max deliver 5.

### Knative

- Image: `dev.local/audit-service:local`
- Autoscaling: min 1, max 5, target concurrency 50
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| *(none in-service)* | No `test/integration/` directory; use `bun test test/unit` only |

## Code Style and Conventions

- **Global providers**: `AppModule` is `@Global()`, exporting all NATS tokens and `TenantConnectionManager`
- **Per-tenant pools**: `Map<string, MongoClient>` keyed by tenant ID, lazy creation on first message
- **Schema lazy init**: `ensureTable()` runs once per tenant (tracked via `Set<string>`)
- **Batched consumer**: `consume({ max_messages: 100, expires: 30_000 })` for efficient pull
- **Idempotent writes**: `ON CONFLICT (id) DO NOTHING` prevents duplicate inserts
- **Tenant routing**: messages without `metadata.tenantId` are logged and dropped
- **Lifecycle hooks**: `OnModuleInit` starts consumer, `OnModuleDestroy` stops it and closes all pools

## Common Tasks

### Run locally

```bash
pnpm install
bun run start:dev
```

Requires local NATS (`nats://localhost:4222`) and a MongoDB instance per tenant.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Consumes from EVENTS stream via `audit-writer` consumer |
| **Per-tenant MongoDB** | Writes events to `mongo.{tenantId}-{env}-ns.svc.cluster.local` |
| **api-gateway** | Upstream producer (publishes events) + proxies audit query endpoints |
| **tenant-service** | Provisions the per-tenant MongoDB instances |
| **`@yoizen/shared`** | Stream/consumer names, `EventEnvelope`, `TENANT_HEADER` |
