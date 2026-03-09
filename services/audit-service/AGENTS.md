# AGENTS.md - Audit Service

## Project Overview

The Audit Service is an independent NATS consumer that persists every event from the `EVENTS` stream to PostgreSQL, providing a durable audit log. It runs alongside the Event Processor as a separate durable consumer (`audit-writer`), demonstrating multi-consumer fan-out on a single JetStream stream. It also exposes a paginated HTTP query API for historical event lookup.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Messaging | NATS JetStream (`nats` package) |
| Database | PostgreSQL via `postgres` (postgres.js) |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                         # Bootstrap: Fastify adapter, port binding
├── app.module.ts                   # @Global() root module with NATS + Postgres providers
├── providers/
│   ├── nats.provider.ts            # NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT tokens
│   └── postgres.provider.ts        # POSTGRES_SQL token (postgres.js client)
└── modules/
    ├── audit/
    │   ├── audit.module.ts
    │   ├── audit.controller.ts     # GET /audit/events, GET /audit/events/:id
    │   └── audit.service.ts        # NATS consumer + PostgreSQL persistence + query logic
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
| `src/app.module.ts` | `@Global()` module exporting NATS and Postgres tokens |
| `src/providers/nats.provider.ts` | Creates EVENTS stream (if missing), durable consumer `audit-writer` (explicit ack, max_deliver 5) |
| `src/providers/postgres.provider.ts` | `postgres()` client factory: max 20 connections, idle_timeout 20s, connect_timeout 30s, prepared statements |
| `src/modules/audit/audit.service.ts` | Consumer loop + `ensureTable()` + `persistMessage()` + query methods |
| `src/modules/audit/audit.controller.ts` | HTTP endpoints with pagination (limit 1-500, default 50) |
| `src/modules/health/health.controller.ts` | Simple `{ status: 'ok' }` response |

## Architecture Highlights

### Data Flow

```
NATS (events.>) -> consumer.consume(batch=100, expires=30s)
  -> msg.json() as EventEnvelope
  -> INSERT INTO events (id, type, payload, metadata, subject) ON CONFLICT (id) DO NOTHING
  -> msg.ack()   // or msg.nak() on error
```

### Database Schema

Table `events` is created on module init via `ensureTable()`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (event UUID) |
| `type` | `TEXT` | NOT NULL |
| `payload` | `JSONB` | NOT NULL, default `{}` |
| `metadata` | `JSONB` | NOT NULL, default `{}` |
| `subject` | `TEXT` | NATS subject, NOT NULL, default `''` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` |

### Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_events_type` | `(type)` | Filter by event type |
| `idx_events_created_at` | `(created_at DESC)` | Time-range queries |
| `idx_events_type_created` | `(type, created_at DESC)` | Combined type + time filter |

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit/events` | Paginated query with optional `type`, `from`, `to`, `limit` (1-500), `offset` |
| `GET` | `/audit/events/:id` | Single event lookup by ID |
| `GET` | `/health` | Health check |

### Module Dependency Graph

```
AppModule (@Global)
├── NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM_CLIENT, POSTGRES_SQL
├── AuditModule -> AuditController, AuditService
└── HealthModule -> HealthController
```

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| NATS JetStream (EVENTS) | NATS | Inbound | Consume events via durable consumer `audit-writer` |
| PostgreSQL | TCP | Outbound | Persist events to `events` table |
| HTTP | Fastify | Inbound | Query API (`/audit/events`) and health |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `JETSTREAM_CLIENT` | `Consumer` | `nats.provider.ts` |
| `POSTGRES_SQL` | `Sql` (postgres.js) | `postgres.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | Database name |
| `POSTGRES_USER` | `yoizen` | Database username |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | Database password |

### Knative

- Image: `dev.local/audit-service:local`
- Uses `postgres-credentials` secret for `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests |

Test scripts are defined but test files are not yet implemented. When adding tests, mock `JETSTREAM_CLIENT` and `POSTGRES_SQL` tokens for unit tests. Integration tests should require local NATS, and PostgreSQL (`localhost:5432`, database `yoizen`).

## Code Style and Conventions

- **Global providers**: `AppModule` is `@Global()`, exporting all NATS and Postgres tokens
- **Lifecycle hooks**: `OnModuleInit` creates table + starts consumer; `OnModuleDestroy` stops consumer + closes Postgres
- **Idempotent writes**: `ON CONFLICT (id) DO NOTHING` prevents duplicate event inserts
- **Tagged template SQL**: Uses postgres.js tagged template literals for parameterized queries (SQL injection safe)
- **Dynamic WHERE**: Conditional filter fragments via template interpolation (`${type ? sql\`AND type = ${type}\` : sql\`\`}`)
- **Query limits**: `limit` clamped to 1-500 (default 50), `offset` clamped to >= 0
- **Prepared statements**: `prepare: true` in Postgres config for query plan caching
- **Connection pool**: max 20 connections, 20s idle timeout, 30s connect timeout
- **Batch consumer**: `consume({ max_messages: 100, expires: 30_000 })` for efficient pull
- **Explicit ack/nak**: messages acked on success, naked on failure

## Common Tasks

### Add a new query filter

1. Add a query parameter to `AuditController.queryEvents()`
2. Add the corresponding property to `AuditQueryParams` interface in `audit.service.ts`
3. Add a conditional `WHERE` fragment in the `queryEvents` SQL template

### Add a new audit-related endpoint

1. Add a method to `AuditService` with the query logic
2. Add a route handler to `AuditController`

### Run locally

```bash
bun install
bun run start:dev   # watch mode on src/main.ts
```

Requires local NATS (`nats://localhost:4222`) and PostgreSQL (`localhost:5432`, database `yoizen`, user `yoizen`, password `yoizen-dev-password`).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Consumes from EVENTS stream via `audit-writer` consumer |
| **PostgreSQL** | Persistent storage for the `events` table |
| **api-gateway** | Proxies audit queries to this service over HTTP; also calls `/health` |
| **`@yoizen/shared`** | Stream names, subject prefixes, consumer names (`AUDIT_CONSUMER_NAME`), limits, interfaces (`EventEnvelope`) |
