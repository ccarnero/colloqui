# Usage Aggregator Service

Class: descriptive
Summary: The usage aggregator that turns channel-message and connector-call events into billable usage rows, with its batching, DLQ handling and read API.

Consumes every tenant's NATS JetStream traffic and turns two event families into
billable usage rows: **channel messages** (`channel-service` ingress/egress/DLQ)
and **connector endpoint calls** (`connector-runtime`). Rows are batched in
memory and flushed to each tenant's own usage store.

Runs as two processes from one image, selected by `SERVICE_MODE`
(`src/main.ts:13-21`, `bootstrapSplitService`): an HTTP API pod that only serves
`/health`, and a worker pod that owns the durable consumers.

## Quick Start

```bash
pnpm install
bun run --cwd services/usage-aggregator-service start:dev
```

`pnpm`, not `bun install`: the root `package.json` declares no `workspaces`
key, and `pnpm-workspace.yaml` is the single source of truth for workspace
membership, so `bun install` at the root does not link the `@yoizen/*`
`workspace:*` dependencies.

Requires: NATS (JetStream), and the usage database tier for the active engine
(Postgres/TimescaleDB by default).

## Pipeline

`AggregatorEngine` (`src/modules/aggregator/aggregator.engine.ts`) drives everything:

1. **Two durable consumer managers**, one per stream family, both reconciling
   tenant streams dynamically via `MultiTenantConsumerManager`
   (`aggregator.engine.ts:110-140`):
   - ingress — streams matching `/^INGRESS-/`, durable `agg-INGRESS` (`:43`, `config.ts:46-48`)
   - DLQ — streams matching `/^DLQ-/`, durable `agg-DLQ` (`:44`, `config.ts:49-51`)

   Both are registered with `maxAckPending: 1000` and `dlq: { enabled: false }`
   (`aggregator.engine.ts:117-118`, `:132-133`) — the aggregator never produces a
   DLQ of its own.

2. **Route by subject.** A connector call is detected first by a cheap substring
   check on `.connector-runtime.platform.endpoint.`
   (`CONNECTOR_SUBJECT_MARKER`, `src/modules/aggregator/envelope-parser.ts:204`)
   before the channel path runs (`aggregator.engine.ts:188`). Channel events are
   pre-filtered on `.channel-service.messaging.` (`envelope-parser.ts:51`,
   applied at `:91-96`) so the tenant-wide `evt.<tenant>.>` firehose is dropped
   without paying for a JSON decode.

3. **Defense in depth on the channel path**: even on a channel subject, only
   envelopes whose `producer` is `channel-service` are aggregated
   (`envelope-parser.ts:68`, enforced at `:114-119`) — pre-account-resolution
   envelopes emitted by `api-gateway` can never poison usage rows.

4. **Direction mapping.** `KIND_TO_DIRECTION` (`envelope-parser.ts:31-39`):
   `received`/`webhook_received` → `ingress`; `sent`/`delivered`/`read`/`failed`
   → `egress`; `send` maps to `null` and is ignored, because it is an intent, not
   bytes on the wire, and counting it would double-count egress. A message
   arriving on a `DLQ-*` stream is forced to `direction = dlq` regardless of its
   kind, because the DLQ stream is authoritative (`resolveDirection`,
   `envelope-parser.ts:178-196`).

5. **Tenant id comes from the STREAM NAME, not the envelope**
   (`extractTenantId`, `aggregator.engine.ts:382-392`) — the envelope's `tenant`
   field is optional in older producers. `INGRESS-<TENANT>` is uppercase and
   lowercased on the way out; `DLQ-<tenant>` is already lowercase.

6. **Batch and flush.** One `BatchBuffer` per tenant, created lazily on the first
   message from that tenant (`aggregator.engine.ts:245-272` for channel rows,
   `:280-343` for connector rows), flushing at `USAGE_BATCH_SIZE` rows or after
   `USAGE_BATCH_FLUSH_MS`.

### Ack semantics

The handler acks only after the row is buffered. Failures are split by
retryability (`aggregator.engine.ts:170-239`):

- Expected-and-boring parse outcomes (`skipped-kind`, `non-channel-subject`,
  `non-channel-producer`, `non-connector-subject` — `SKIP_REASONS`,
  `aggregator.engine.ts:51-56`) are counted and acked silently.
- Genuine parse rejections and an underivable tenant throw `PermanentError`, so
  the shared runner `term()`s the message instead of retrying forever.
- Everything else (store unavailable, batch commit failure) throws a plain
  `Error` so the runner `nak()`s with backoff.

## Storage

Selected at bootstrap by `DB_ENGINE`; `ProvidersModule` binds one of two
connection managers from that single value (`src/providers/providers.module.ts:21-46`).

| Engine | Manager | Target |
|---|---|---|
| `postgres` (default) | `UsageTenantConnectionManagerPostgres` (`src/providers/tenant-connection-manager.postgres.ts:14-44`) | usage TimescaleDB tier, shared host `postgres-usage-shared.support-services-<env>` in `SingleDatabase` mode, database `yoizen_usage` |
| `mongo` | `UsageTenantConnectionManagerMongo` (`src/providers/tenant-connection-manager.mongo.ts:19-58`) | usage Mongo tier, shared host `mongo-usage-shared.support-services-<env>`, same `SingleDatabase` mode |

Tables/collections written:

| Target | Engine | Written by |
|---|---|---|
| `channel_events` | Postgres | `src/modules/aggregator/batch-inserter.postgres.ts:52`, `:103` |
| `channel_events` | Mongo (time series) | `src/modules/aggregator/batch-inserter.mongo.ts:51` |
| `connector_call_events` | Postgres only | `src/modules/aggregator/batch-inserter.connector.ts:47` |

**Connector call events are Postgres-only** — `getConnectorBufferFor` casts the
manager to `TenantConnectionManager` unconditionally
(`aggregator.engine.ts:288-290`); there is no Mongo mirror for that family.

Schema DDL comes from `@yoizen/shared`: `CHANNEL_USAGE_SCHEMA_SQL` /
`SHARED_CHANNEL_USAGE_SCHEMA_SQL` (per-tenant vs single-database) and
`CONNECTOR_CALL_USAGE_SCHEMA_SQL`, applied by the schema initializer
(`tenant-connection-manager.postgres.ts:35-43`).

## Contracts

### Consumed

| Stream pattern | Durable | Subject filter |
|---|---|---|
| `INGRESS-<TENANT>` | `agg-INGRESS` | `evt.<tenant>.channel-service.messaging.*` and `*.connector-runtime.platform.endpoint.*` (everything else on the firehose is skipped) |
| `DLQ-<tenant>` | `agg-DLQ` | all — DLQ streams are populated only by channel failures, so the producer check is not enforced there (`envelope-parser.ts:110-113`) |

### Published

None. This service is a pure consumer; it emits OTel metrics, not events.

### HTTP

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ status, nats, postgres }` on the Postgres engine, `{ status, nats, mongo }` on Mongo (`src/modules/health/health.controller.ts:24-44`) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SERVICE_MODE` | `api` | `api` or `worker`. In `api` mode the engine runs `ensureOnly` — it pre-creates the durables but consumes nothing (`aggregator.engine.ts:99`, `:142-146`) |
| `PORT` | `3000` | HTTP port (`src/config.ts:22-24`) |
| `DB_ENGINE` | `postgres` | Storage engine: `postgres` or `mongo`; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`, read at `src/config.ts:25-27`) |
| `USAGE_BATCH_SIZE` | `500` | Rows buffered before a flush (`src/config.ts:40-42`) |
| `USAGE_BATCH_FLUSH_MS` | `1000` | Max wait before flushing a partial batch (`src/config.ts:43-45`) |
| `USAGE_INGRESS_DURABLE` | `agg-INGRESS` | Durable name on every tenant INGRESS stream (`src/config.ts:46-48`) |
| `USAGE_DLQ_DURABLE` | `agg-DLQ` | Durable name on every tenant DLQ stream (`src/config.ts:49-51`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Used to build the default shared usage host (`tenant-connection-manager.postgres.ts:17`) |
| `TENANT_POSTGRES_SHARED_USAGE_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | see `tenant-connection-manager.postgres.ts:20-33` | Shared usage Postgres target and credentials |
| `TENANT_MONGO_SHARED_USAGE_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | fall back to the `TENANT_POSTGRES_SHARED_USAGE_*` equivalents (`tenant-connection-manager.mongo.ts:26-48`) | Shared usage Mongo target and credentials |

`TENANT_SERVICE_URL` and `TENANT_DISCOVERY_INTERVAL_MS` are declared in
`src/config.ts:28-39` but nothing reads them: tenant discovery is implicit via
JetStream stream reconciliation, never a poll of tenant-service
(`aggregator.engine.ts:74-78`). They are listed here only so nobody sets them
expecting an effect.

## Observability

OTel metrics from `src/modules/aggregator/aggregator.metrics.ts`:
`usage_aggregator.events.total` (`:14`), `usage_aggregator.parse_failures.total`
(`:20-21`), `usage_aggregator.skipped.total` (`:29`),
`usage_aggregator.insert_failures.total` (`:37-38`),
`usage_aggregator.batch.duration` (`:44-45`), `usage_aggregator.consumer.lag`
(`:59`), `usage_aggregator.last_event.timestamp_ms` (`:68`).

## Testing

```bash
cd services/usage-aggregator-service
bun run test:unit
```

## Deploy

Two manifests from one image (`dev.local/usage-aggregator-service:local`); the
K8s names drop the `-service` suffix carried by the package directory
(`src/main.ts:10-13`):

| Resource | Kind | Scale |
|---|---|---|
| `usage-aggregator-api` | Knative Service (`knative/services/base/usage-aggregator-api.yaml`) | min 1 / max 3 (`:27-28`) |
| `usage-aggregator-worker` | Deployment (`knative/services/base/usage-aggregator-worker.yaml`) | fixed `replicas: 1` (`:14`) |

```bash
./rebuild-redeploy.sh usage-aggregator-service dev
```
