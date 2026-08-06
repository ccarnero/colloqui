# Connector Admin

Class: descriptive
Summary: Multi-tenant connector configuration: connector and endpoint CRUD, auth types, cache and retry settings, and the internal sync consumer.

Multi-tenant connector configuration service. It manages connector definitions (base URL, auth type, custom headers, timeouts, retries) and their endpoints per tenant. Internally some modules still use legacy `adapter` names, but the public HTTP surface is `/connectors`.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires the configured storage engine. `DB_ENGINE` / `STORAGE_ENGINE` defaults to `postgres`; `mongo` is optional.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/connectors` | Create connector (+ optional inline endpoints) |
| `GET` | `/connectors` | List connectors for tenant (optional `?context=`, `?tag=`, `?name=`, `?limit=`, `?offset=` filters) |
| `GET` | `/connectors/usage` | Connector call usage stats |
| `GET` | `/connectors/:id` | Get connector with endpoints |
| `PATCH` | `/connectors/:id` | Partial update connector |
| `DELETE` | `/connectors/:id` | Delete connector (cascades endpoints) |
| `POST` | `/connectors/:id/endpoints` | Add endpoint to connector |
| `PATCH` | `/connectors/:id/endpoints/:epId` | Partial update endpoint |
| `DELETE` | `/connectors/:id/endpoints/:epId` | Remove endpoint |
| `GET` | `/health` | Health check |
| `GET` | `/healthz` | Liveness probe — returns 200 unconditionally while the process is up |
| `GET` | `/readyz` | Readiness probe — gates differ per `SERVICE_MODE`, surfaces discrete readiness checks in the JSON body |

All connector routes require `x-yoizen-tenant` for tenant scoping.
`GET /connectors/usage` is declared BEFORE `GET /connectors/:id` on purpose, so
Nest does not treat `usage` as an id (`src/modules/adapters/adapters.controller.ts:60-66`).

### Health, liveness and readiness

Three endpoints with three different jobs
(`src/modules/health/health.controller.ts:30-73`):

| Endpoint | Behaviour |
|---|---|
| `/healthz` | `200` unconditionally while the process is up; no dependency probe (`:30-34`) |
| `/readyz` | `{ status, mode, failed[] }`; `503` when not ready (`:36-53`). Gates differ per `SERVICE_MODE` — see below |
| `/health` | Legacy aggregate: `{ status, nats, postgres }` or `{ status, nats, mongo }` by engine (`:55-73`) |

In **api** mode `/readyz` intentionally does NOT depend on NATS — a dead broker
must not block HTTP CRUD. In **worker** mode it requires the JetStream manager,
at least one healthy tenant pool, and at least one healthy consumer runner.

## Topology (api / worker split)

Two workloads, one image, selected at runtime by `SERVICE_MODE`; bootstrap goes
through `bootstrapSplitService` from `@yoizen/observability`.

| Workload | Kind | `SERVICE_MODE` | Purpose |
|---|---|---|---|
| `connector-admin-api` | Knative Service | `api` | HTTP CRUD + probes |
| `connector-admin-worker` | Deployment | `worker` | Pull-based JetStream consumer only |

## Internal sync durable

`src/modules/internal-sync/internal-sync.service.ts` materializes
registry-service's service lifecycle events into per-tenant connector mirrors
(`context=internal`, `managed_by=registry-service`).

| Field | Value | Source |
|---|---|---|
| Durable | `adapter-internal-sync` — the same name on every tenant stream, so `jetstream_consumer_num_pending{consumer_name=...}` aggregates across tenants in ONE Prometheus query (`:50-54`) | `:54` |
| Bound streams | every stream matching `/^INGRESS-/`, attached reactively by `MultiTenantConsumerManager` | `:57` |
| Filter subject | `evt.*.registry-service.platform.service.system.*.v1` | `:67-68` |
| `ackWaitMs` | `60000` — anchors the first backoff step | `:71` |
| `backoffMs` | `[60000, 120000, 300000, 600000]` | `:74` |
| `maxDeliver` | `5` | `:77` |
| Concurrency | `4` per runner | `:157` |

**Tenant routing: the SUBJECT is the source of truth**, not the payload. A
payload `tenantId` that disagrees with the subject's tenant raises
`PermanentError("cross_tenant_attempt")` and the message is `term`'d
(`internal-sync.service.ts:259`).

Poison classes, all `term`'d rather than retried: `invalid_subject` (`:269`),
`unknown_type` (`:279`), `parse_error` (`:300`), `invalid_payload` (`:352`,
`:361`), `cross_tenant_attempt`. Anything that throws a plain `Error` (DB down,
broker disconnect) is `nak`'d and retried instead.

Redelivery is safe by design: the repository operations are upserts and
delete-by-name, so at-least-once delivery cannot corrupt a mirror.

### `ensureOnly`

The manager is constructed with `ensureOnly: !isWorkerMode()`
(`internal-sync.service.ts:150`, `:158`). API pods therefore CREATE the durable
on every reachable tenant stream but never pull — which keeps the durable
present for the worker to bind to and keeps `num_pending` observable to
Prometheus even when no worker is running (`:115-120`).

## Per-tenant schema

DDL is `ADAPTER_SCHEMA_SQL` in `packages/shared/src/adapter-schema.ts:30`,
re-run lazily by `ensureSchema(tenantId)` (all `IF NOT EXISTS`).

- `http_adapters` (`adapter-schema.ts:31-51`) with `UNIQUE(name)` (`:50`) —
  uniqueness is implicitly tenant-scoped because the DATABASE is the tenant
  boundary; this replaced an earlier `UNIQUE(tenant_id, name)` (`:8-9`).
  Indexes: `context` (`:52`), GIN on `tags` (`:54`), partial on `managed_by`
  (`:56`).
- `adapter_endpoints` (`adapter-schema.ts:60-69`) with
  `UNIQUE(adapter_id, method, path)` (`:68`) and an index on `adapter_id`
  (`:70`).

## Auth types

`POST`/`PATCH` accept `authType` from a four-value list
(`ADAPTER_AUTH_TYPES`, `src/modules/adapters/adapters.dto.ts:39`, enforced by
`@IsIn` at `:171` and `:233`): `none`, `api-key`, `bearer`, `basic`.

Header injection happens in the CONSUMING service, not here:
`applyAdapterAuthHeadersSync` (`packages/shared/src/adapter-auth-headers.ts:11`)
handles all four — `none`, `api-key` (header name defaults to `X-API-Key`),
`bearer` and `basic`. `AdapterClient` calls it directly; there is no async
auth flavour left, so no token-fetch path exists.

> Any other stored `authType` (e.g. connectors persisted before the
> client-credentials flow was removed) hits the injector's `default` branch:
> NO `Authorization` header is injected and a warning is logged. Such rows are
> still readable, but a `PATCH` that echoes the old `authType` is rejected by
> `@IsIn`; pick one of the four supported values.

## Retry-chain caps (`timeoutMs`, `maxRetries`, `retryBackoffMs`)

The three connector retry-chain fields have upper caps, exported as shared
constants from `packages/shared/src/adapter-schema.ts` and enforced with
`@Max(...)` on both the Create and the Update DTO in
`src/modules/adapters/adapters.dto.ts`:

| Field | Cap constant | Value |
|-------|--------------|-------|
| `timeoutMs` | `ADAPTER_TIMEOUT_MS_MAX` | `60_000` (60s) |
| `maxRetries` | `ADAPTER_MAX_RETRIES_MAX` | `3` |
| `retryBackoffMs` | `ADAPTER_RETRY_BACKOFF_MS_MAX` | `10_000` (10s) |

**Why the caps exist.** An uncapped `timeoutMs` × retries lets a single
connector call outlive the async invoke consumer's JetStream ack wait
(`INVOKE_CONSUMER_ACK_WAIT_MS = 300_000` in
`services/connector-runtime/src/config.ts`). Past that window NATS redelivers
the in-flight message and the outbound HTTP call is duplicated. With the caps
in place the worst-case chain is
`3 × (60s + 10s) + 10s` webhook delivery `= 220s < 300s`, so the ack wait is
never exceeded.

**The invariant is a test, not a comment.**
`services/connector-runtime/test/unit/invoke-ack-wait-invariant.spec.ts`
asserts the worst chain against the real exported `INVOKE_CONSUMER_ACK_WAIT_MS`
— raising any of the three caps or lowering the ack wait without rebalancing
breaks the build.

**Validation layer only.** There is no DB `CHECK` constraint and no migration:
pre-existing rows whose values sit above a cap keep working as-is and are only
rejected the next time they are written through `POST`/`PATCH`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `SERVICE_MODE` | `api` when unset | Split-service mode: `api` or `worker` |
| `DB_ENGINE` / `STORAGE_ENGINE` | `postgres` | Storage engine selector: `postgres` or `mongo` |
| `POSTGRES_HOST` | `postgres.support-services-<env>.svc.cluster.local` | TENANT-CATALOG host only (`catalogHost` — the tier lookup), and only as the fallback under `TENANT_POSTGRES_CATALOG_HOST`. Tenant data pools do NOT use it: dedicated-tier hosts are `<POSTGRES_SERVICE_NAME>.<tenant>-<env>-ns.svc.cluster.local` and shared-tier hosts come from `TENANT_POSTGRES_SHARED_HOST` |
| `POSTGRES_SERVICE_NAME` | `postgres` | Host prefix for dedicated-tier tenant pools |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | Database name |
| `POSTGRES_USER` | `yoizen` | Database user |
| `POSTGRES_PASSWORD` | **required — no default** | `TenantConnectionManager`'s constructor calls `requireEnv("POSTGRES_PASSWORD")`, so the process throws before serving if it is unset or empty. (`yoizen-dev-password` is what the dev overlay's `postgres-credentials` Secret supplies; it is not a code default.) |

`src/config.ts` itself declares only `PORT` and `dbEngine`; every
Postgres/Mongo host and credential variable above is read by the shared
`@yoizen/database` `TenantConnectionManager`, plus the
`TENANT_POSTGRES_SHARED_USAGE_*` family read by `UsageTenantConnectionManager`
(`src/providers/tenant-connection-manager.usage.ts`).

## Testing

```bash
cd services/connector-admin
bun run test:unit
bun run test:integration
```

## Rollback of the internal-sync migration

Reversible without redeploying source:

1. Set `REGISTRY_EMIT_ADAPTER_SYNC=false` on registry-service — its publisher
   short-circuits before any broker contact
   (`services/registry-service/src/config.ts:51-53`).
2. Scale `connector-admin-worker` to `replicas: 0`.

`connector-admin-api` keeps serving CRUD throughout, because its `/readyz` in
api mode does not gate on NATS. To re-enable: deploy registry first, run
`src/scripts/backfill-internal-mirrors.ts` once to catch drift, then flip the
flag back and scale the worker up.

## Deploy

```bash
./rebuild-redeploy.sh connector-admin dev
```
