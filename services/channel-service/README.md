# Channel Service

Class: descriptive
Summary: Everything a tenant's messaging channels need: account CRUD, webhook ingress, egress sends, auto-reply, and the provider implementations behind them.

Owns everything a tenant's messaging channels need: channel **accounts** (CRUD),
**ingress** (inbound provider messages → canonical JetStream events), **egress**
(outbound sends, HTTP and command-driven), **auto-reply** rules, and **usage**
reads off the billing time-series tier.

Supported channels are whatever `ChannelRouter` has a provider for
(`src/providers/channel-router.ts:18-28`): `telegram`, `http` and the
outbound-only `e2e-tests` sink. There is no provider family registry — each
channel registers its own provider directly.

Runs as two processes from one image, selected by `SERVICE_MODE`
(`src/main.ts:10-21`, `bootstrapSplitService`).

## Quick Start

```bash
pnpm install
bun run --cwd services/channel-service start:dev
```

`pnpm`, not `bun install`: the root `package.json` declares no `workspaces`
key, and `pnpm-workspace.yaml` is the single source of truth for workspace
membership, so `bun install` at the root does not link the `@yoizen/*`
`workspace:*` dependencies.

Requires: NATS (JetStream), the OLTP store for the active engine, and Redis (the
egress circuit breaker, `src/providers/redis.provider.ts:29-34`).

## api / worker split

`isWorkerMode()` gates every NATS-driven component. In `api` mode each consumer
is constructed with `ensureOnly: true` — it creates/updates its durable and then
consumes nothing:

| Component | File | api mode |
|---|---|---|
| Webhook ingress consumer | `src/modules/webhooks/webhook-ingress-consumer.service.ts:61-80` | ensure-only |
| Auto-reply dispatcher | `src/modules/auto-reply/auto-reply.service.ts:81-121` | ensure-only |
| Egress send-command consumer | `src/modules/egress/send-command-consumer.service.ts:96-117` | ensure-only |

## Contracts

### HTTP endpoints

Every `/channels/**` route reads the tenant header `x-yoizen-tenant`
(`TENANT_HEADER`) via a bare `@Headers` parameter — there is no `TenantGuard`
in this service, so an omitted header reaches the service layer as `undefined`
rather than being rejected with a `400`. `/health` takes no tenant.

| Method | Path | Source |
|---|---|---|
| `POST` | `/channels/accounts` | `src/modules/accounts/accounts.controller.ts:29-31` |
| `GET` | `/channels/accounts` | `accounts.controller.ts:58-59` |
| `GET` | `/channels/accounts/:id` | `accounts.controller.ts:66-67` |
| `PATCH` | `/channels/accounts/:id` | `accounts.controller.ts:75-76` |
| `DELETE` | `/channels/accounts/:id` | `accounts.controller.ts:88-90` |
| `POST` | `/channels/auto-reply` | `src/modules/auto-reply/auto-reply.controller.ts:26-28` |
| `GET` | `/channels/auto-reply` | `auto-reply.controller.ts:41-42` |
| `DELETE` | `/channels/auto-reply/:id` | `auto-reply.controller.ts:49-51` |
| `POST` | `/channels/:accountId/messages` | `src/modules/egress/egress.controller.ts:19-21` |
| `GET` | `/channels/streams` | `src/modules/streams/streams.controller.ts:10-11` |
| `GET` | `/channels/streams/:key/messages` | `streams.controller.ts:15-16` |
| `GET` | `/channels/usage` | `src/modules/usage/usage.controller.ts:17-18` |
| `GET` | `/channels/usage/summary` | `usage.controller.ts:29-30`. The in-file comment says it is "declared before `@Get('totals')` to avoid route shadowing" — that rationale is wrong: `summary` and `totals` are both static siblings and cannot shadow each other in any order, and this service runs on the Fastify adapter, whose router prefers static over parametric segments regardless of registration order |
| `GET` | `/channels/usage/totals` | `usage.controller.ts:34-35` |
| `GET` | `/health` | `src/modules/health/health.controller.ts:23-47` |

There is no webhook HTTP controller in this service — inbound webhooks arrive
over NATS from `api-gateway` (see below).

### NATS consumed

Every consumer reconciles tenant streams matching `/^INGRESS-/` via
`MultiTenantConsumerManager`.

| Durable | Filter subject | Purpose |
|---|---|---|
| `channel-webhook-ingress` (`webhook-ingress-consumer.service.ts:32`) | `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1` (`WEBHOOK_INGRESS_SUBJECT_FILTER`, `packages/shared/src/channel.constants.ts:51-52`) | Decode the forwarded webhook and hand it to ingress |
| `auto-reply` (`auto-reply.service.ts:50`) | `evt.*.channel-service.messaging.*.*.received.v1` (built at `auto-reply.service.ts:99`) | Match rules, send the reply |
| `channel-egress` (`send-command-consumer.service.ts:38`) | `evt.*.channel-service.messaging.*.*.send.v1` (`CHANNEL_SEND_SUBJECT_PATTERN`, `channel.constants.ts:35-36`) | Execute outbound send commands (e.g. workflow-service `channelSend`) |

There is no webhook-verify request/reply server any more: the `hub.challenge`
GET verification handshake was Meta's, and it was removed end-to-end with the
Meta provider family (the api-gateway `GET /api/webhooks/:channel/:tenantId`
route went with it). `WEBHOOK_VERIFY_RPC_SUBJECT` in
`packages/shared/src/channel.constants.ts` is now unused and dies with the
contract shrink.

The webhook ingress handler runs with a concurrency of 32 by default,
overridable via `WEBHOOK_INGRESS_HANDLER_CONCURRENCY`
(`webhook-ingress-consumer.service.ts:35-38`).

Webhook envelopes are validated before use: subject must parse, the envelope's
`tenant` must equal the subject's tenant, and `raw_body_b64` must be present —
otherwise the message is dropped with a warn
(`webhook-ingress-consumer.service.ts:116-140`).

### NATS published

`IngressService` (`src/modules/ingress/ingress.service.ts`) publishes the
canonical 8-token messaging subject
`evt.<tenant>.channel-service.messaging.<channel>.<provider>.<kind>.v1`
(`buildChannelSubject`; token constants at `channel.constants.ts:12-15`), after
ensuring the tenant's INGRESS and DLQ streams exist
(`ensureTenantIngressStream` / `ensureTenantDlqStream`, imported at
`ingress.service.ts:23`).

**Claim-check**: when the serialized payload exceeds
`CLAIM_CHECK_THRESHOLD_BYTES` (256 KiB, `packages/shared/src/channel.constants.ts`)
the service stores it in a per-tenant NATS Object Store bucket and publishes a
slim envelope instead. The `payloadBytes.byteLength > CLAIM_CHECK_THRESHOLD_BYTES`
test and both `buildClaimCheckBucket(tenantId)` call sites live in
`ingress.service.ts`; bucket TTL (`CLAIM_CHECK_BUCKET_TTL_NS`, equal to
`CHANNEL_STREAM_MAX_AGE_NS`) and cap (`CLAIM_CHECK_BUCKET_MAX_BYTES`, 512 MiB)
are constants in the same shared file.

## Storage

`DB_ENGINE` picks Postgres or Mongo at bootstrap; the choice is read ONCE at
module-definition time and branches the whole provider graph
(`src/app.module.ts:33`, `:95`; `src/providers/channel-tenant-db.module.ts:7-11`).
Each feature module has a repository interface with two adapters
(`accounts.postgres.repository.ts` / `accounts.mongo.repository.ts`, and the same
pair for auto-reply and usage).

The service keeps **two independent per-tenant connection caches**, each with its
own tenant-deletion eviction listener (`src/app.module.ts:35-45`):

| Cache | Mode | Contents |
|---|---|---|
| `ChannelTenantConnectionManager` | `PerTenantDatabase` (`src/providers/channel-tenant-connection-manager.postgres.ts:19-22`) | OLTP: `channel_accounts`, `auto_reply_rules` (DDL `CHANNEL_ACCOUNTS_SCHEMA_SQL` / `AUTO_REPLY_SCHEMA_SQL`, `packages/shared/src/channel-schema.ts:10`, `:50`) |
| `UsageTenantConnectionManager` | `SingleDatabase` on the usage tier (`src/modules/usage/tenant-connection-manager.postgres.ts:20-36`) | READ-ONLY view of the billing time series written by usage-aggregator-service |

Because the OLTP tables live in per-tenant databases, neither carries a tenant
column — the database is the boundary.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SERVICE_MODE` | `api` | `api` or `worker`; gates all three NATS components (see the split table above) |
| `PORT` | `3000` | HTTP port (`src/config.ts:17-19`) |
| `DB_ENGINE` | `postgres` | Storage engine: `postgres` or `mongo`; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`, read at `src/config.ts:20-22`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Feeds every in-cluster default hostname (`src/config.ts:4`) |
| `CHANNEL_SERVICE_PUBLIC_URL` | `platformServiceUrl("channel-service-api", env)` | Public base URL advertised to providers (`src/config.ts:23-28`) |
| `POSTGRES_HOST` | `postgres.support-services-<env>.svc.cluster.local` | Platform Postgres (`src/config.ts:29-34`) |
| `MONGO_HOST` | `mongo-platform.support-services-<env>.svc.cluster.local` | Platform Mongo (`src/config.ts:35-40`) |
| `MONGO_DB` | `yoizen` | Mongo database name (`src/config.ts:41-43`) |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Egress circuit-breaker state (`src/providers/redis.provider.ts:31-32`); `lazyConnect` keeps the process startable while Redis is down and the breaker falls back to a local in-memory view (`redis.provider.ts:17-19`). `REDIS_CLUSTER_MODE` is honoured through `createRedisClient` (`redis.provider.ts:10-16`) |
| `WEBHOOK_INGRESS_HANDLER_CONCURRENCY` | `32` | Concurrent webhook ingress handlers (`webhook-ingress-consumer.service.ts:35-38`) |
| `TENANT_POSTGRES_SHARED_USAGE_HOST` / `_PORT` / `_DB` / `_USER` / `_PASSWORD` | see `src/modules/usage/tenant-connection-manager.postgres.ts:22-35` | Shared usage Postgres tier (read path) |
| `TENANT_MONGO_SHARED_USAGE_*` | fall back to the `TENANT_POSTGRES_SHARED_USAGE_*` equivalents | Shared usage Mongo tier (read path, `src/modules/usage/tenant-connection-manager.mongo.ts`) |

## Health

`GET /health` (`src/modules/health/health.controller.ts:23-47`) returns
`{ status, postgres, nats }` on the Postgres engine and `{ status, mongo, nats }`
on Mongo. Component values are `"connected"` / `"disconnected"`; `status` is
`"ok"` only when BOTH the store and NATS are up, otherwise `"degraded"`.

## Testing

```bash
cd services/channel-service
bun run test:unit
bun run test:integration
```

## Deploy

Two manifests from one image (`dev.local/channel-service:local`):

| Resource | Kind | Scale |
|---|---|---|
| `channel-service-api` | Knative Service (`knative/services/base/channel-service-api.yaml`) | min 1 / max 20 (`:31-32`) |
| `channel-service-worker` | Deployment (`knative/services/base/channel-service-worker.yaml`) | fixed `replicas: 1` (`:17`) |

```bash
./rebuild-redeploy.sh channel-service dev
```
