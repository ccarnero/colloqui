# agent-scheduler-service

Platform-level multi-tenant job scheduling service that reads scheduled jobs from tenant databases and publishes `job_trigger` events via NATS JetStream.

> **Read "Known gaps (as-built)" before trusting this page operationally.**
> Several of the paths described below are wired but not reachable in the
> shipped configuration.

## Overview

This is a **separate platform service** (not tenant-scoped) that:

1. Talks to tenant databases through `SchedulerTenantConnectionManager`, a
   `TenantConnectionManager` subclass configured with
   `SharedTenantDatabaseMode.PerTenantDatabase`. Pools are opened lazily; the
   tenant set it iterates is `getKnownTenantIds()`, i.e. the tenants this
   process has already opened a pool for.
2. Reads each known tenant's `jobs` table — `JobReaderService.readTenantJobs`
   selects `WHERE is_active = true AND schedule IS NOT NULL AND schedule != ''`
   and classifies every row with `parseSchedule` from `@yoizen/shared`; rows
   that parse as `once` or `invalid` are logged and skipped, so only `cron` and
   `interval` reach the scheduler.
3. Uses `toad-scheduler` (`CronJob` / `SimpleIntervalJob`, keyed
   `"<tenantId>:<jobId>"`) and keeps its own bookkeeping map
   `Map<tenantId, Map<jobId, ActiveSchedule>>`, where
   `ActiveSchedule = { type, schedule }` — the toad `Task` objects live inside
   `ToadScheduler`, not in this map.
4. When a schedule fires, `SchedulerService.executeJob` →
   `JobTriggerService.publishTrigger` → `NatsSchedulerPublisher.publishJobTrigger`
   publishes a CloudEvents envelope on `AGENT_ADMIN_JOB_TRIGGER`
   (`evt.<tenant>.agent-admin-service.automation.platform.internal.job_trigger.v1`),
   which the tenant's `INGRESS-<TENANT>` stream captures via its
   `evt.<tenant>.>` subject filter (`getTenantSubjectPattern`).
5. `SchedulerService.startScheduler` re-reconciles every
   `RECONCILE_INTERVAL_MS` (default 30 s) to detect new, changed, or deleted
   jobs. A job whose `schedule` string is unchanged is left alone; a changed
   `schedule` is removed and re-added.

## Architecture

```
agent-scheduler-service (single process)

  TenantJobReconcilerService        OnModuleInit hook only
        │ SchedulerService.start()
        ▼
  LeaderElectionService             pg_try_advisory_lock(32767)
        │ leader only — otherwise a 10 s retry loop
        ▼
  SchedulerService
        ToadScheduler: CronJob / SimpleIntervalJob, id "<tenant>:<job>"
        Map<tenantId, Map<jobId, ActiveSchedule>>
        reconcile every RECONCILE_INTERVAL_MS
        ├── JobReaderService          reads each tenant's jobs table
        ├── JobTriggerService         NatsSchedulerPublisher → JetStream
        └── ExecutionHistoryService   Redis, 7-day TTL

  HeartbeatService                  separate module, 15 s interval
        └── SCHEDULER_HEARTBEAT per ACTIVE tenant
```

`TenantJobReconcilerService` is not itself a loop: its only job is the
`OnModuleInit` hook that calls `SchedulerService.start()`. The 30 s loop is
`SchedulerService`'s own `reconcileInterval`.

## Key Design Decisions

- **Platform-level, not per-tenant**: a single instance serves every tenant it has a pool for, unlike the tenant-scoped services
- **Leader election**: `pg_try_advisory_lock(32767)` on `LEADER_ELECTION_POSTGRES_URL` prevents duplicate triggers when multiple replicas run. `reconcileAllTenants()` returns immediately unless `isCurrentlyLeader()`, and `tryAcquireLeadership(undefined)` returns `false` — **no URL means no scheduling at all**, not "single-replica mode"
- **Defensive reconciliation**: every `RECONCILE_INTERVAL_MS`, diffs active schedules against DB state (add/remove/update)
- **CloudEvents envelope**: `NatsSchedulerPublisher` builds the same envelope shape as agent-admin-service — and reuses its identity: `producer: AGENT_ADMIN_PRODUCER` (`"agent-admin-service"`) and `type: "io.yoizen.agent-admin-service.job.triggered.v1"`, while `source` is `agent-scheduler-service/scheduler/job-trigger`. Consumers keying off `producer` see agent-admin-service, not this service (see Known gaps)

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | PostgreSQL via `TenantConnectionManager`; tier is resolved per tenant, and shared-tier tenants each get their OWN database on the shared host (`SharedTenantDatabaseMode.PerTenantDatabase`) |
| Scheduling | toad-scheduler (cron + interval) |
| Messaging | NATS JetStream (publisher) |
| Caching | Redis (execution history) |

## Configuration

Read by this service's own `src/config.ts` (all getters — the value is re-read
on every access, so late `process.env` writes DO take effect here):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name (also used by `TenantConnectionManager` to build cluster DNS names) |
| `RECONCILE_INTERVAL_MS` | `30000` | Job reconciliation interval |
| `ADMIN_API_KEY` | unset | Enables `/admin/*` endpoints when set; clients must send `x-internal-api-key` |
| `LEADER_ELECTION_POSTGRES_URL` | unset | PostgreSQL URL for the leader-election advisory lock. **Unset = the scheduler never becomes leader and never triggers anything** |

Read by the inherited `TenantConnectionManager` (`@yoizen/database`), not by
`src/config.ts` — omitting them still breaks boot:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | **required** | `requireEnv("POSTGRES_PASSWORD")` throws in the constructor, so the process cannot start without it |
| `POSTGRES_USER` | `yoizen` | Tenant DB username |
| `POSTGRES_DB` | `yoizen` | Tenant DB name |
| `POSTGRES_SERVICE_NAME` | `postgres` | Host prefix for dedicated-tier tenants |
| `POSTGRES_PORT` | `5432` | Tenant DB port |
| `TENANT_POSTGRES_*` | see `packages/database/README.md` | Shared/catalog tier resolution; this service pins only `sharedDatabaseMode = PerTenantDatabase` |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | `{ status: "ok", timestamp, checks: { database: "up" \| "idle" } }` — `"up"` only when at least one tenant pool exists |
| GET | `/admin/jobs` | `AdminService.getActiveJobs()` → `getActiveSchedulesSummary()`: `[{ tenantId, jobCount }]`, not the individual jobs |
| GET | `/admin/executions?limit=` | Recent execution history from Redis (`limit` defaults to 50 inside `getRecentExecutions`) |
| GET | `/admin/tenants` | `getKnownTenantIds()` — tenants this process has opened a pool for |

`/admin/*` endpoints require `x-internal-api-key: <ADMIN_API_KEY>`
(`AdminApiKeyGuard`). A missing/incorrect key and an unset `ADMIN_API_KEY`
both raise `ForbiddenException` → **403**.

There is no global route prefix (`bootstrapFastifyApp` never calls
`setGlobalPrefix`), so these paths are literal.

## NATS contracts (publisher only — this service consumes nothing)

| Subject constant | Resolved subject | Envelope `type` | Envelope `producer` |
|---|---|---|---|
| `AGENT_ADMIN_JOB_TRIGGER` | `evt.<tenant>.agent-admin-service.automation.platform.internal.job_trigger.v1` | `io.yoizen.agent-admin-service.job.triggered.v1` | `agent-admin-service` |
| `SCHEDULER_HEARTBEAT` | `evt.<tenant>.agent-scheduler-service.automation.platform.internal.heartbeat.v1` | `SCHEDULER_HEARTBEAT_TYPE` = `io.yoizen.platform.scheduler.heartbeat.v1` | `agent-scheduler-service` |

Both land in the tenant's `INGRESS-<TENANT>` stream (`evt.<tenant>.>`).

The job-trigger publish sets both `Nats-Msg-Id` and the JetStream `msgID`
option to `envelope.idempotencykey`, which is `calculateChecksum(eventPayload)`
— a SHA-256 over the job's payload **and nothing else** (no jobId, no
executionId, no timestamp). Two firings of the same job carry the same dedup
key, so a firing that lands inside the stream's `duplicate_window` (JetStream's
2-minute default; `ensureTenantIngressStream` never sets the field) is dropped
by the broker. Sub-2-minute schedules are therefore thinned, not delivered —
see Known gaps.

The heartbeat publish sets no headers and no `msgID` at all.

Consumers: agent-ai-service's `MultiTenantConsumerService` (durable
`agent-ai-service-consumer`) lists the job-trigger subject in its
`FILTER_SUBJECTS` and routes it to `jobTriggerHandler`. **No service subscribes
to the heartbeat subject** — `rg SCHEDULER_HEARTBEAT services` matches only
this service and `@yoizen/shared`.

## Storage

This service owns no schema: it never calls `setSchema` / `setSchemaInitializer`
on its `TenantConnectionManager` and issues exactly one SQL statement, the
`SELECT … FROM jobs` in `JobReaderService.readTenantJobs`. The columns it
requires in each tenant's `jobs` table are `id`, `name`, `agent_id`, `schedule`,
`payload`, `is_active`, `last_run`, `next_run`, `created_at`, `updated_at` —
the table itself is created by agent-admin-service. Note the reader never
writes `last_run` / `next_run` back.

Redis holds the execution history: `ExecutionHistoryService.recordExecution`
does `SETEX scheduler:history:<tenantId>:<jobId>:<triggeredAt>` with a 7-day
TTL, and `getRecentExecutions` SCANs `scheduler:history:*` and sorts by
`triggeredAt` descending. The scan stops at the first cursor pass that reaches
`limit` keys, so "recent" is best-effort across the keyspace, not a global
top-N.

## Known gaps (as-built)

Verified against the code on 2026-08-02 by T04 of the docs-truth audit. These
are behaviours the code cannot currently reach; they are escalations for the
audit's decision round, not doc bugs — do not "fix" the doc by deleting them.

1. **No tenant discovery.** `JobReaderService.readAllTenantJobs` iterates
   `tenantManager.getKnownTenantIds()`. That set is only written by
   `TenantConnectionManager.getOrCreatePool`, which this service reaches only
   from `readTenantJobs(tenantId)` — for tenants already in the set. Nothing
   seeds it (no tenant-catalog query, no `tenant.created` subscription, no
   `ensureSchema` call at boot), so on a fresh process the set starts empty and
   stays empty, and every reconciliation logs "No tenants known yet".
2. **Leader election is unconfigured in the shipped manifest.**
   `knative/services/base/agent-scheduler-service.yaml` sets `TZ`, `NATS_URL`,
   `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` and
   `PLATFORM_ENVIRONMENT` — and nothing else. With
   `LEADER_ELECTION_POSTGRES_URL` unset, `start()` takes the
   "no URL and no tenants" branch straight into `startLeaderRetryLoop`, whose
   10 s tick returns early on exactly the same condition, so `startScheduler()`
   is never called. (`tryAcquireLeadership(undefined)` also returns `false`
   outright, so neither path can promote this pod.)
   The same manifest omits `REDIS_URL`, so `ExecutionHistoryService` falls back
   to the `redis://localhost:6379` default in `src/config.ts`; the failure is
   swallowed — `recordExecution` and `getRecentExecutions` both catch and log,
   so `/admin/executions` degrades to `[]` instead of erroring.
3. **The heartbeat never fires.** `publishHeartbeats` returns early when
   `getActiveTenants()` is empty, and `markTenantActive` has no caller in this
   service (`rg markTenantActive services` matches only agent-ai-service's
   own same-named method and this service's unit spec).
4. **Payload-only dedup key.** See the NATS contracts section: schedules faster
   than the 2-minute `duplicate_window` are collapsed by the broker unless the
   job's payload changes between firings.

## Testing

```bash
bun run test:unit          # test/unit — heartbeat, job-reader, leader-election, scheduler, execution-history
bun run test:integration   # test/integration — present in package.json, but the directory is empty
bun run test:e2e           # test/e2e — same: script exists, directory is empty
```

Every spec runs with `--preload ./test/preload-env.ts`, which sets only
`PLATFORM_ENVIRONMENT` and `LEADER_ELECTION_POSTGRES_URL`. It does NOT set
`POSTGRES_PASSWORD`; the unit specs get away with that because they stub the
tenant manager instead of constructing the real one.

## Running Locally

```bash
pnpm install
POSTGRES_PASSWORD=... bun run start:dev
```

Requires local NATS, Redis, and per-tenant PostgreSQL. `POSTGRES_PASSWORD` is
mandatory (see Configuration); without it the `TenantConnectionManager`
constructor throws before the HTTP server binds.

## Deploy

Knative Service, min 1 / max 3, concurrency target 50, image
`dev.local/agent-scheduler-service:local`
(`knative/services/base/agent-scheduler-service.yaml`). min-scale 1 matters
here: the schedule map is in-process state, so a scale-to-zero would drop every
registered `toad-scheduler` task.

```bash
./rebuild-redeploy.sh agent-scheduler-service dev
```
