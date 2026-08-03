# Audit Service

Writes four independent audit trails into each tenant's own database and exposes
a read API over them, including causal-chain reconstruction. It is a consumer of
the bus, not a producer.

The four trails are separate modules with separate tables, separate durables and
separate endpoints — they are NOT four views of one table.

| Trail | Table | Fed by |
|---|---|---|
| Platform events | `events` (`src/modules/audit/audit.postgres.repository.ts:26`) | durable `audit-events` |
| Channel messaging | `channel_events` (`src/modules/channel-audit/channel-audit.postgres.repository.ts:29`) | durable `channel-audit` |
| Agent/workflow executions | `execution_events` (`src/modules/execution-audit/execution-audit.postgres.repository.ts:32`) | durable `execution-audit` |
| Gateway HTTP requests | `gateway_audit_events` (`src/modules/gateway-audit/gateway-audit.postgres.repository.ts:60`) | durable `gateway-audit-writer` |

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: NATS (JetStream) and the per-tenant store for the active engine.

## NATS consumed

Three of the four durables reconcile per-tenant streams matching `/^INGRESS-/`
via `MultiTenantConsumerManager`, each with `runnerOptions.concurrency = 16`
(`HANDLER_CONCURRENCY`) and `ensureOnly` in api mode:

| Durable | Filter | Source |
|---|---|---|
| `audit-events` | `evt.*.*.platform.>` (`CANONICAL_AUDIT_PATTERN`) | `src/modules/audit/audit.service.ts:47-51`, `:68-76` |
| `channel-audit` | `CHANNEL_AUDIT_SUBJECT_PATTERN` = `evt.*.channel-service.messaging.>` (`packages/shared/src/channel.constants.ts`) | `src/modules/channel-audit/channel-audit.service.ts:49-51`, `:68-76` |
| `execution-audit` | the three `ai-agent-gateway` execution lifecycle subjects, tenant-wildcarded (`src/modules/execution-audit/execution-audit.service.ts:55-59`) | `execution-audit.service.ts:43-45`, `:75-84` |

**Why `execution-audit` exists as a separate consumer**: the canonical
`audit-events` filter only matches `evt.*.*.platform.>`, and execution lifecycle
events use the `automation` domain, so they fall outside that pattern entirely.
The dedicated consumer closes that blind spot — this is spelled out in the code
comment at `execution-audit.service.ts:47-54`.

The fourth trail is different: gateway audit rides its OWN stream, not the
per-tenant INGRESS streams.

| | Value | Source |
|---|---|---|
| Stream | `GATEWAY_AUDIT`, subjects `audit.gateway.>`, max 128 MiB | `GATEWAY_AUDIT_STREAM_NAME` / `GATEWAY_AUDIT_STREAM_SUBJECTS` / `GATEWAY_AUDIT_STREAM_MAX_BYTES` (`packages/shared/src/constants.ts`) |
| Durable | `gateway-audit-writer` | `GATEWAY_AUDIT_CONSUMER_NAME` (same file) |
| Created by | this service at bootstrap | `src/providers/nats.provider.ts:38-47` |

## HTTP endpoints

| Method | Path | Source |
|---|---|---|
| `GET` | `/audit/events` | `src/modules/audit/audit.controller.ts:16` |
| `GET` | `/audit/events/chain/:correlationId` | `audit.controller.ts:34` — declared above `:id`; see the ordering note below |
| `GET` | `/audit/events/:id` | `audit.controller.ts:46` |
| `GET` | `/audit/channel-events` | `src/modules/channel-audit/channel-audit.controller.ts:19` |
| `GET` | `/audit/channel-events/chain/:correlationId` | `channel-audit.controller.ts:37` — same ordering note |
| `GET` | `/audit/channel-events/:id` | `channel-audit.controller.ts:55` |
| `GET` | `/audit/execution-events` | `src/modules/execution-audit/execution-audit.controller.ts:18` |
| `GET` | `/audit/execution-events/:id` | `execution-audit.controller.ts:35` |
| `GET` | `/audit/gateway/stats` | `src/modules/gateway-audit/gateway-audit.controller.ts:16` — declared above `:requestId`; see the ordering note below |
| `GET` | `/audit/gateway` | `gateway-audit.controller.ts:24` |
| `GET` | `/audit/gateway/:requestId` | `gateway-audit.controller.ts:41` |
| `GET` | `/readyz` | `src/modules/health/health.controller.ts:20-23` — static `{ status: "ok" }`, no dependency probe |
| `GET` | `/health` | `health.controller.ts:25-47` — `{ status, nats, postgres }` or `{ status, nats, mongo }` by engine |

**Route-ordering note.** Three in-file comments say a route is "declared ABOVE
`:id` to prevent NestJS route shadowing". The ordering is real, but it is
defensive rather than load-bearing: this service runs on the Fastify adapter,
whose router (find-my-way) prefers a static segment over a parametric one
independently of registration order. `chain/:correlationId` could not collide
with `:id` in any case — it is two segments deep. `stats` vs `:requestId` is the
only same-depth pair, and Fastify resolves that by static priority.

All four audit controllers — and only those four — carry
`@UseGuards(TenantGuard)` (`@yoizen/database`), so every `/audit/**` call needs
an `x-yoizen-tenant` header matching `/^[a-zA-Z0-9-]{3,32}$/`; a missing or
malformed value is a `400` from the guard, before any handler runs. The health
controller is unguarded.

`/readyz` and `/health` are deliberately different: `/readyz` answers as soon as
the process is up, `/health` actually probes NATS and the tenant pools.

Chain assembly lives in a pure function, `src/modules/audit/build-chain-tree.ts`,
kept out of both the controller and the repository.

## Storage

`DB_ENGINE` picks Postgres or Mongo; `ProvidersModule` binds one connection
manager and one eviction listener from that single value
(`src/providers/providers.module.ts:14-27`). Every module has a matching
`*.postgres.repository.ts` / `*.mongo.repository.ts` pair.

Tenancy is the database, not a column: the Postgres manager runs in
`SharedTenantDatabaseMode.PerTenantDatabase`
(`src/providers/tenant-connection-manager.postgres.ts:13-15`).

Schema creation is lazy and guarded by two helpers in
`src/common/ensure-tenant-schema.postgres.ts`:
`ensurePostgresTenantSchemaOnce` runs the DDL once per tenant (`:6-15`), and
`ensurePostgresTenantNamespaceOnce` runs it once per `(namespace, tenant)` pair
so a second trail's DDL is not skipped just because the first trail already
initialized that tenant (`:20-30`).

## Environment Variables

`src/config.ts` declares exactly two values:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`src/config.ts:9-11`) |
| `DB_ENGINE` | `postgres` | Storage engine: `postgres` or `mongo`; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`, read at `src/config.ts:12-14`) |

Everything else — NATS URL, per-tenant database hosts and credentials,
`PLATFORM_ENVIRONMENT` — is read by the shared `@yoizen/database` /
`@yoizen/observability` providers, not by this service's own config object.
`SERVICE_MODE` is consumed indirectly through `isWorkerMode()`: in api mode all
three INGRESS durables are created but consume nothing
(`audit.service.ts:66`, `channel-audit.service.ts:66`,
`execution-audit.service.ts:74`), and the gateway-audit consumer returns early
without subscribing at all (`gateway-audit.service.ts:50`, `:60`).

## Testing

```bash
cd services/audit-service
bun run test:unit
```

Only `test/unit/` exists.

## Deploy

`audit-service-api` (`knative/services/base/audit-service-api.yaml`) and
`audit-service-worker` (`knative/services/base/audit-service-worker.yaml`) run
the same image from one build.

```bash
./rebuild-redeploy.sh audit-service dev
```
