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
| Database | MongoDB 7 via official `mongodb` driver (platform + per-tenant usage) |
| Messaging | NATS JetStream |
| Shared | `@yoizen/shared`, `@yoizen/database` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_HOST` | `mongo-platform.support-services-<env>.svc.cluster.local` | Platform MongoDB host |
| `MONGO_USAGE_HOST` | per-tenant / shared usage cluster | Usage metrics MongoDB host |
| `MONGO_PORT` | `27017` | MongoDB port |
| `MONGO_DB` | `yoizen` | Platform database name |
| `MONGO_USER` / `MONGO_PASSWORD` | from `mongo-credentials` Secret | Credentials |

## Health

`GET /health` returns `{ status, mongo, nats }` with `mongo: connected | disconnected`.

## Testing

```bash
bun test test/unit
```
