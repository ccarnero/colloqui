# AGENTS.md - Usage Aggregator Service

## Project Overview

The Usage Aggregator Service consumes billing/usage events from per-tenant NATS JetStream streams and writes aggregated metrics into tenant usage storage (Timescale on Postgres engine, Mongo time-series collections on mongo engine).

## Storage engines

**Postgres** (default) or **Mongo** batch inserter behind `ITenantProvisioner` usage path. See [DOCS/runbooks/storage-engines.md](../../DOCS/runbooks/storage-engines.md).

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify (api/worker split via `SERVICE_MODE`) |
| Language | TypeScript 5.7 (strict) |
| Database | Per-tenant MongoDB (`MONGO_USAGE_HOST`, usage database) |
| Messaging | NATS JetStream durable consumers (`agg-INGRESS-*`, `agg-DLQ`) |
| Shared | `@yoizen/shared`, `@yoizen/database` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_HOST` | platform Mongo host | Platform catalog lookups |
| `MONGO_USAGE_HOST` | usage cluster host | Time-series usage writes |
| `MONGO_PORT` | `27017` | MongoDB port |
| `MONGO_DB` | `yoizen` | Database name |
| `MONGO_USER` / `MONGO_PASSWORD` | from Secret | Credentials |

## Health

Worker `/health` reports `{ status, mongo, nats }`. Aggregations use MongoDB aggregation pipelines (`$setWindowFields`, `$dateTrunc`) instead of SQL `time_bucket`.

## Testing

```bash
bun test test/unit
```
