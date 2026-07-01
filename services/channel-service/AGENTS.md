# AGENTS.md - Channel Service

## Project Overview

The Channel Service manages messaging accounts, auto-replies, and usage metrics for each tenant. Platform OLTP and usage time-series support **Postgres** (default, Timescale for usage) or **Mongo** (platform + usage replica sets) per bootstrap.

## Storage engines

Repository interfaces + dual adapters for accounts, auto-reply, and usage. See [DOCS/runbooks/storage-engines.md](../../DOCS/runbooks/storage-engines.md).

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | Selected by `DB_ENGINE` / `STORAGE_ENGINE`: Postgres by default, Mongo optional |
| Messaging | NATS JetStream |
| Shared | `@yoizen/shared`, `@yoizen/database` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_ENGINE` / `STORAGE_ENGINE` | `postgres` | Storage engine selector: `postgres` or `mongo` |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` | environment-specific | Postgres connection when using the default engine |
| `MONGO_HOST` / `MONGO_PORT` / `MONGO_DB` | environment-specific | Mongo connection when `DB_ENGINE=mongo` |
| `MONGO_USAGE_HOST` | per-tenant / shared usage cluster | Usage metrics MongoDB host when using Mongo |
| credentials | from namespace Secrets | Engine-specific database credentials |

## Health

`GET /health` returns `{ status, nats, postgres }` for the Postgres engine or `{ status, nats, mongo }` for the Mongo engine.

## Testing

```bash
bun test test/unit
```
