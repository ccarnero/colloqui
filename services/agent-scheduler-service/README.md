# agent-scheduler-service

Platform-level multi-tenant job scheduling service that reads scheduled jobs from all tenant databases and publishes `job_trigger` events via NATS JetStream.

## Overview

This is a **separate platform service** (not tenant-scoped) that:

1. Connects to **all tenant databases** via `TenantConnectionManager`
2. Reads active jobs with cron/interval schedules from each tenant's `jobs` table
3. Uses `toad-scheduler` to manage an in-memory schedule map: `Map<tenantId, Map<jobId, Task>>`
4. When a cron fires, publishes a `job_trigger` CloudEvents envelope to the tenant's `INGRESS-{tenant}` NATS JetStream stream
5. Periodically reconciles schedules (every 30s) to detect new, changed, or deleted jobs

## Architecture

```
┌─────────────────────────────────────────────────┐
│              agent-scheduler-service             │
│                                                  │
│  ┌─────────────────┐    ┌─────────────────────┐ │
│  │  LeaderElection  │    │  TenantJobReconciler│ │
│  │  (PG advisory)   │    │  (every 30s)        │ │
│  └────────┬────────┘    └──────────┬──────────┘ │
│           │                        │             │
│  ┌────────▼────────────────────────▼──────────┐ │
│  │           SchedulerService                  │ │
│  │   (toad-scheduler: cron + interval)         │ │
│  │   Map<tenantId, Map<jobId, Task>>           │ │
│  └────────────────────┬───────────────────────┘ │
│                       │                          │
│  ┌────────────────────▼───────────────────────┐ │
│  │          JobTriggerService                  │ │
│  │   Publishes job_trigger to NATS JetStream   │ │
│  └────────────────────────────────────────────┘ │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │          JobReaderService                   │ │
│  │   Reads jobs from ALL tenant DBs            │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

## Key Design Decisions

- **Platform-level, not per-tenant**: Single instance reads from ALL tenants, unlike other services that are tenant-scoped
- **Leader election**: PostgreSQL advisory lock prevents duplicate triggers when multiple replicas run
- **Defensive reconciliation**: Every 30s, diffs active schedules against DB state (add/remove/update)
- **CloudEvents envelope**: Same format as admin-service for consistency

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | Per-tenant PostgreSQL via `TenantConnectionManager` |
| Scheduling | toad-scheduler (cron + interval) |
| Messaging | NATS JetStream (publisher) |
| Caching | Redis (execution history) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name |
| `RECONCILE_INTERVAL_MS` | `30000` | Job reconciliation interval |
| `ADMIN_API_KEY` | unset | Enables `/admin/*` endpoints when set; clients must send `x-internal-api-key` |
| `LEADER_ELECTION_POSTGRES_URL` | unset | PostgreSQL connection URL used for leader-election advisory locks |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/admin/jobs` | List all active schedules across tenants |
| GET | `/admin/executions` | Recent execution history |
| GET | `/admin/tenants` | List connected tenants |

`/admin/*` endpoints require `x-internal-api-key: <ADMIN_API_KEY>`. If
`ADMIN_API_KEY` is unset, admin endpoints are disabled.

## Running Locally

```bash
pnpm install
bun run start:dev
```

Requires local NATS, Redis, and per-tenant PostgreSQL.
