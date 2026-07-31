# `@yoizen/database`

The platform's shared data-plane and messaging plumbing. Every service that
touches Postgres, Mongo, Redis, NATS/JetStream or the Kubernetes API does it
through this package rather than a local client, so connection pooling, tenant
routing, health probes and consumer semantics are decided in ONE place.

Consumed as a workspace package (`"@yoizen/database": "workspace:*"`); it ships
TypeScript source directly (`main`/`types` both point at `src/index.ts`,
`package.json:5-6`), so there is no build step.

## What lives here

| Area | Entry points |
|---|---|
| Storage-engine selection | `resolveStorageEngine`, `StorageEngine` (`src/engine.ts`), `createRepositoryProvider` (`src/repository.provider.ts`), `src/engine-module.factory.ts` |
| Per-tenant connections | `TenantConnectionManager` (`src/tenant-connection-manager.ts`), `TenantMongoConnectionManager` (`src/tenant-mongo-connection-manager.ts`) |
| Tenant lifecycle listeners | `TenantDeletionEvictionListener`, `TenantMongoDeletionEvictionListener`, `TenantReadySchemaListener` (`src/index.ts:10-12`) |
| Platform providers | `PostgresModule` / `POSTGRES_SQL` (`src/postgres-provider.ts`), `redisProvider` / `REDIS_CLIENT` (`src/redis-provider.ts`), Mongo (`src/mongo-provider.ts`), Kubernetes (`src/kubernetes-provider.ts`) |
| NATS + JetStream | `createNatsConnectionProvider`, `ensureStream`, `ensureTenantIngressStream` (`src/nats-provider.ts`), `ensureDurableConsumer` (`src/nats-durable-consumer.ts`), `MultiTenantConsumerManager` (`src/multi-tenant-consumer-manager.ts`), `NatsConsumerRunner` (`src/nats-consumer-runner.ts`), DLQ helpers (`src/nats-dlq.ts`), claim-check (`src/claim-check.ts`) |
| Health probes | `checkPostgres`, `checkMongo`, `checkNats`, `checkRedis`, `checkK8s` (`src/health-checks.ts`, re-exported at `src/index.ts:53-59`) plus the aggregate `getNatsTenant*HealthStatus` helpers |
| HTTP tenancy | `TenantGuard`, `@TenantId()` (`src/tenant-guard.ts`) |

## Storage-engine selection

```ts
resolveStorageEngine(env = process.env): "postgres" | "mongo"
```

`DB_ENGINE` wins, then `STORAGE_ENGINE`, then the `postgres` default; anything
else **throws** rather than silently degrading (`src/engine.ts:13-23`). Ten
services call this — guard **K11** in `scripts/checks/doc-code-guards.sh`
requires each of their READMEs to document the variable.

`createRepositoryProvider({ token, engine, postgresClass, mongoClass })`
(`src/repository.provider.ts:10-20`) is the standard way to bind one repository
token to the adapter for the active engine.

## Tenancy

`TenantGuard` (`src/tenant-guard.ts:24`) requires the `x-yoizen-tenant` header
(`:9`) and validates it against `/^[a-zA-Z0-9-]{3,32}$/` (`:10`), raising
`400` when it is missing (`:29-33`). It sets `request.tenantId` for the
`@TenantId()` param decorator.

`TenantConnectionManager` resolves each tenant to a database target and caches
one pool per tenant. `SharedTenantDatabaseMode` picks the topology:
`PerTenantDatabase` (the database itself is the tenant boundary — no
`tenant_id` columns) or `SingleDatabase` (one shared database, tenant-scoped
rows), exported from `src/tenant-connection-manager.ts` via `src/index.ts:1-4`.

## Durable consumers

This is the part with the sharpest failure modes, so read it before writing a
consumer.

### `ensureDurableConsumer(jsm, options)`

`src/nats-durable-consumer.ts:131`. Idempotently creates a durable **pull**
consumer with the platform's expected config: `ack_policy: Explicit`,
`deliver_policy: All`, `replay_policy: Instant`, plus `max_deliver`, `backoff`,
`max_ack_pending` and `ack_wait` (`:101-111`, applied at `:171-188`).

Three behaviours worth knowing:

1. **It reconciles, it does not skip.** When the durable already exists, the
   mutable fields (`ack_wait`, `max_deliver`, `max_ack_pending`, `description`)
   are compared against the desired config and `jsm.consumers.update(...)` is
   issued on drift (`:112-118`, `reconcileDurableConsumer` at `:213`). That is
   what makes a default change in this file actually reach running clusters
   without a delete/recreate cycle.
2. **Immutable fields are NOT reconciled** — filter subjects, ack/deliver/replay
   policies, `backoff` and `deliver_group`. The server rejects changes to those,
   so a drift there requires an operator to delete and recreate the durable
   (`:120-123`).
3. **Ensures are cached in-process** in a `Map` keyed `"<stream>::<durable>"`
   (`:87-91`), so repeated hot-path calls short-circuit (`:135-136`).

Server-side invariant honoured by the update path: on NATS ≥ 2.10 `max_deliver`
must be strictly greater than `backoff.length`, so the new `backoff` and
`max_deliver` are sent as one atomic update (`:208-211`).

### `DEFAULT_ACK_WAIT_MS` — and why it matters

```
DEFAULT_MAX_DELIVER      = 5                                    (:12)
DEFAULT_MAX_ACK_PENDING  = 1000                                 (:13)
DEFAULT_ACK_WAIT_MS      = 60_000                               (:30)
DEFAULT_BACKOFF_MS       = [60_000, 120_000, 300_000, 600_000]  (:43-48)
```

`ack_wait` is how long the server waits for an ack before **redelivering**. If
a handler routinely runs longer than that window, the message is redelivered
while the first attempt is still in flight and the side effect happens twice.

This is not hypothetical. A prior value of `1_000` ms leaked into the platform's
`INGRESS-*` durables and caused silent at-least-once duplication of outbound
Telegram replies: the handler exceeded 1 s, the server redelivered, and a second
replica sent the reply again (`:21-28`).

**`backoff` overrides `ack_wait`.** NATS semantics: when a `backoff` array is
set, the effective ack window for the i-th delivery is `backoff[i-1]`, with the
last value reused once the array is exhausted. So the FIRST backoff element
doubles as the initial redelivery window, and setting it shorter than the
longest-running handler causes duplicate deliveries even when `ack_wait` looks
generous. The default schedule therefore anchors its first step at
`DEFAULT_ACK_WAIT_MS` to keep the two consistent (`:31-42`).

### Guard K7 — the ackWait census

Because the 60 s default is safe for fast I/O-bound handlers but dangerous for
slow ones (LLM calls, large-file ingestion, multi-step provisioning), the
platform enforces a census rather than trusting review:
`k7_ack_wait_census` in `scripts/checks/doc-code-guards.sh:311`.

It discovers every `new MultiTenantConsumerManager(...)` / `ensureDurableConsumer(...)`
registration under `services/` and fails when one is not in the script's
`known_files` list, or declares no explicit `ackWaitMs` and is not on the
allowlist with a written justification. A new consumer with a slow handler that
forgets `ackWaitMs` fails the build until someone consciously triages it — see
the guard's header comment (`scripts/checks/doc-code-guards.sh:288-310`) for
the full rationale.

Rule of thumb when adding a consumer: if the handler can exceed a few seconds,
set `ackWaitMs` explicitly. Existing long handlers use `300_000`
(tenant provisioning, KB/SKB ingestion) or `900_000` (agent LLM execution).

### `MultiTenantConsumerManager`

`src/multi-tenant-consumer-manager.ts:161`. Keeps one durable + runner alive
**per tenant stream** matched by `streamPattern`, all sharing the SAME durable
name so replicas compete for deliveries on each stream (`:34-38`).

- **Startup**: list streams, filter by pattern, ensure + start a runner each
  (`:148-150`).
- **Reconciliation** every `reconcileIntervalMs` (default `5_000`,
  `DEFAULT_RECONCILE_INTERVAL_MS` at `:137`, applied `:199-207`): binds tenant
  streams created after startup, so a new tenant needs no pod restart. It never
  stops existing runners — tenant streams are long-lived (`:152-156`).
- The reconcile timer is `unref()`d (`:208-210`), so it does not hold the
  process open.
- Per-stream lookup is O(1) via `Map<streamName, IRunnerEntry>` (`:158-159`,
  `:162`).

Notable config (`IMultiTenantConsumerConfig`, `:39-130`):

| Option | Default | Meaning |
|---|---|---|
| `ensureOnly` | `false` (`:101`) | Create the durable on every matching stream but start no runner and consume nothing. This is what `*-api` pods use so the durable exists and `jetstream_consumer_num_pending{consumer_name=...}` stays populated in Prometheus even with no worker running (`:90-103`) |
| `dlq.enabled` | `true` (`:75`) | Built-in per-tenant DLQ router: ensures `DLQ-<tenant>` and republishes terminated envelopes to `dlq.<tenant>.<original-subject>` before `msg.term()` (`:67-83`) |
| `onPermanent` | — | Custom `PermanentError` handler; when set it OVERRIDES the built-in DLQ router (`:62-66`, `:72`) |
| `resolveClaimChecks` | `true` (`:124`) | Inflate claim-check envelopes before the inner handler. `false` opts out, for consumers that resolve claim-checks themselves (`:355`, `:370`) |
| `metrics` | no-op | Applied uniformly across tenant runners, labelled by durable name so Prometheus rolls up across tenants (`:84-89`) |

`start()` throws if called after `stop()` (`:194-196`); `stop()` is idempotent.

### `NatsConsumerRunner`

Pull loop with `max_messages` default `100` and `expires` default `30_000`
(`src/nats-consumer-runner.ts:362-363`). `concurrency` defaults to `1`, which
takes a serial path that preserves exact ordering semantics; anything higher
uses a bounded-concurrency path keeping up to N handlers in flight
(`:427-431`, `:452`).

Error contract: a `PermanentError` (from `@yoizen/shared`) is terminal — it
routes to the DLQ / `onPermanent` and `term()`s the message. Any other thrown
`Error` is transient and `nak()`s with backoff.

## Environment Variables

Read directly by this package, so services do NOT need to declare them in their
own config objects.

| Variable | Default | Description |
|---|---|---|
| `DB_ENGINE` / `STORAGE_ENGINE` | `postgres` | Storage engine; invalid values throw (`src/engine.ts:16-21`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Builds in-cluster tenant hostnames |
| `TENANT_POOL_PROBE_TIMEOUT_MS` | `2000` | Per-pool liveness probe ceiling (`src/tenant-connection-manager.ts:111-112`) |
| `TENANT_POOL_END_TIMEOUT_MS` | `5000` | Hard ceiling on `pool.end({ timeout })` (`src/tenant-connection-manager.ts:121-122`) |
| `TENANT_POSTGRES_DEFAULT_TIER` / `TENANT_MONGO_DEFAULT_TIER` | `shared` | Tier assumed when the catalog has no row (`src/tenant-connection-manager.ts:259-262`) |
| `TENANT_POSTGRES_TIER_OVERRIDES` / `TENANT_MONGO_TIER_OVERRIDES` | — | Per-tenant tier overrides parsed at construction (`src/tenant-connection-manager.ts:218-220`) |
| `TENANT_POSTGRES_SHARED_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` / `_DATABASE_MODE` | see source | Shared-tier target |
| `TENANT_POSTGRES_CATALOG_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | see source | Catalog used for tier lookup |
| `TENANT_MONGO_SHARED_*` / `TENANT_MONGO_CATALOG_*` | mirror the Postgres names | Mongo-engine equivalents |
| `POSTGRES_SERVICE_NAME` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_DB` | — | Per-tenant Postgres connection parts |
| `MONGO_SERVICE_NAME` / `MONGO_PORT` / `MONGO_USER` / `MONGO_PASSWORD` / `MONGO_DB` / `MONGO_HOST` | — | Per-tenant Mongo connection parts |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_CLUSTER_MODE` | `localhost` / `6379` | Read by `createRedisClient` (`src/redis-provider.ts`) |

Full list: `rg -o 'process\.env\.[A-Z_0-9]+' packages/database/src | sort -u`.

## Testing

```bash
cd packages/database
bun test
```
