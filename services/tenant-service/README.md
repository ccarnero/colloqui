# Tenant Service

Provisions and manages tenant namespaces and per-tenant database infrastructure
through the Kubernetes API. Every instance is environment-scoped by
`PLATFORM_ENVIRONMENT`, so creating a tenant through the dev gateway creates
only `<tenant>-dev-ns`.

Creation is **asynchronous**: `POST /tenants` returns `202 Accepted` after
writing a pending platform row and publishing a JetStream provisioning request;
a durable consumer inside this same service does the slow work.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: Kubernetes cluster access (in-cluster or kubeconfig), NATS
(JetStream), and the platform catalog database.

## Endpoints

`src/modules/tenants/tenants.controller.ts:41-130`

| Method | Path | Description |
|---|---|---|
| `POST` | `/tenants` | `202 Accepted` — writes the row and enqueues provisioning (`:48-54`) |
| `GET` | `/tenants` | List. Optional `?status=` filters on `provisioningStatus`; an unknown value is a `400`, not a silent unfiltered list (`:67-83`) |
| `GET` | `/tenants/:nameOrId` | Dual lookup: a UUID resolves by platform row id (async status polling), anything else by tenant NAME (`:88-96`) |
| `PATCH` | `/tenants/:name` | Replace `configuration` (`:98-104`) |
| `DELETE` | `/tenants/:name` | `204 No Content`. A tenant still `provisioning` yields `409` WITH a `Retry-After` header so clients back off instead of hammering (`:106-130`) |
| `GET` | `/health` | See below |

### Tenant name validation

`CreateTenantDto` (`src/modules/tenants/tenant.dto.ts:40-57`): `name` is
`@MaxLength(32)` and must match `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` — lowercase
alphanumeric with optional inner hyphens, never leading or trailing (`:44-47`).
`tier` is optional and constrained to the shared `TenantDatabaseTier` enum
(`:50-52`); `configuration` is a free-form JSON object (`:54-56`).

### Health

`GET /health` returns `ITenantHealthResponse` and deliberately maps three
statuses onto two HTTP codes (`src/modules/health/health.controller.ts:10-35`):

- `error` (Kubernetes/Postgres down, OR the JetStream provisioning consumer is
  `stopped` and the in-process supervisor has exhausted self-recovery) → **503**
  with the same JSON body, so Knative recycles the pod and the dashboard still
  shows which sub-system failed.
- `degraded` → **200** on purpose: the supervisor is still actively reattaching,
  and a restart would only throw away in-flight reattach progress.

## Async provisioning

### Published

| Subject | Transport | Publisher |
|---|---|---|
| `platform.tenant.provision.requested` (`packages/shared/src/tenant-events.ts:39-40`) | JetStream, `Nats-Msg-Id = tenantId` for idempotency (`tenant-events.ts:48-49`) | `src/providers/tenant-provision-publisher.service.ts:39` |
| `platform.tenant.ready` (`tenant-events.ts:86`) | Core NATS | `src/providers/tenant-ready-publisher.service.ts:57` |
| `platform.tenant.deleted` (`tenant-events.ts:128`) | Core NATS | `src/providers/tenant-deletion-publisher.service.ts:58` |

Both core-NATS publishes are **best-effort and log-only on failure**, with the
fallback named in the log line: a missed `ready` means subscribers fall back to
lazy `ensureSchema` on first request (`tenant-ready-publisher.service.ts:64`),
and a missed `deleted` means downstream connection pools self-heal on their next
readiness probe (`tenant-deletion-publisher.service.ts:65`).

### Consumed

One durable consumer, `tenant-provisioner`
(`TENANT_PROVISIONER_DURABLE`, `tenant-events.ts:42`), on the `PLATFORM_TENANTS`
stream (`tenant-events.ts:30`, subjects `platform.tenant.>` at `:33`), filtered
to the provision-requested subject
(`src/modules/provisioning/tenant-provision-consumer.service.ts:51-59`):

| Setting | Value | Why |
|---|---|---|
| `ackWaitMs` | `300000` (`:57`) | Namespace + StatefulSet provisioning is minutes-long; the 60 s package default would redeliver mid-flight |
| `maxAckPending` | `4` (`:56`) | Bounds concurrent provisioning |
| `maxDeliver` | `TENANT_PROVISION_MAX_DELIVER = 5` (`tenant-events.ts:45`) | Must exceed the backoff schedule length |
| runner | `concurrency: 2`, `maxMessages: 15`, `expires: 60000` (`:65`) | |

## Storage engine and tiers

`DB_ENGINE` selects the catalog repository and the provisioner
(`ITenantsRepository` / `ITenantProvisioner`), read at `src/config.ts:75-77`.
Both a Postgres and a Mongo provisioner exist
(`src/providers/tenant-provisioner.postgres.ts`,
`src/providers/tenant-provisioner.mongo.ts`).

Within the Postgres engine the TIER decides the topology:

- **`shared`** (the column default, `src/providers/platform-postgres.provider.ts:21`) — a logical database and role are created on
  the shared CNPG cluster, plus tenant-namespace credentials and a `postgres`
  ExternalName Service pointing at the shared host.
- **`dedicated`** — real per-tenant resources in the tenant namespace,
  including a StatefulSet.

## Namespace labels

Applied by `TenantProvisioningExecutor`
(`src/modules/provisioning/tenant-provisioning-executor.service.ts:29-34`):

| Label | Value |
|---|---|
| `app.kubernetes.io/part-of` | `yoizen-arch` |
| `yoizen.io/tenant` | `<tenant-name>` |
| `yoizen.io/environment` | `<PLATFORM_ENVIRONMENT>` |
| `yoizen.io/managed-by` | `tenant-service` |

Every list/get query is a label selector over these, which is why the service is
environment-scoped without any extra bookkeeping (`tenants.service.ts:40-42`).

Namespace deletion waits for the `Terminating` phase to clear, polling every
`TENANT_NAMESPACE_TERMINATION_POLL_MS` (default 1000) up to
`TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS` (default 60000)
(`tenant-provisioning-executor.service.ts:36-44`).

## Environment Variables

`src/config.ts` — all lazy getters, so tests can set `process.env` before first
read (`:70-71`). The full surface is large; the load-bearing ones:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`src/config.ts:72-74`) |
| `DB_ENGINE` | `postgres` | Engine for the catalog + provisioner; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`, read at `src/config.ts:75-77`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Scopes every namespace operation (`src/config.ts:66-68`) |
| `POSTGRES_PASSWORD` | *(required)* | Throws `500` at read time if neither this nor `MONGO_PASSWORD` is set (`src/config.ts:11-19`) |
| `MONGO_PASSWORD` | *(required on the Mongo engine)* | Symmetric fallback to `POSTGRES_PASSWORD` (`src/config.ts:21-29`) |
| `POSTGRES_HOST` / `_PORT` / `_DB` / `_USER` | `postgres.support-services-dev...` / `5432` / `yoizen` / `yoizen` | Platform catalog Postgres (`src/config.ts:81-92`) |
| `TENANT_POSTGRES_SHARED_HOST` / `_PORT` / `_ADMIN_DB` / `_ADMIN_USER` / `_ADMIN_PASSWORD` / `_PASSWORD` | `postgres-shared.support-services-<env>...`, `5432`, `postgres`, … | Shared-tier CNPG target and admin credentials (`src/config.ts:96-126`) |
| `TENANT_POSTGRES_IMAGE` | `pgvector/pgvector:pg17` | Dedicated-tier OLTP image (`src/config.ts:6`, `:127-129`) |
| `TENANT_USAGE_POSTGRES_IMAGE` | `timescale/timescaledb-ha:pg17` | Usage-tier image (`src/config.ts:7`, `:130-135`) |
| `TENANT_USAGE_POSTGRES_STORAGE` | `2Gi` | Usage PVC size (`src/config.ts:8`, `:136-141`) |
| `TENANT_MONGO_IMAGE` | `mongo:7.0` | Mongo-engine image (`src/config.ts:9`, `:193-195`) |
| `MONGO_HOST` / `_PORT` / `_DB` / `_USAGE_DB` / `_USER` / `_ROOT_USER` / `_ROOT_PASSWORD` | `mongo-platform.support-services-dev...`, `27017`, `yoizen`, `yoizen_usage`, `yoizen`, `root` | Mongo-engine settings (`src/config.ts:142-165`) |
| `TENANT_MONGO_SHARED_HOST` / `_PORT` / `_ADMIN_USER` / `_ADMIN_PASSWORD` / `_PASSWORD` | `mongo-shared.support-services-<env>...`, `27017`, … | Shared-tier Mongo (`src/config.ts:166-192`) |
| `TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS` / `_POLL_MS` | `60000` / `1000` | Namespace deletion wait (`tenant-provisioning-executor.service.ts:38-44`) |

## Testing

Every script injects a `MONGO_PASSWORD` fallback, because `src/config.ts:11-29`
throws when neither password env var is set (`package.json:9-11`):

```bash
cd services/tenant-service
bun run test:unit
```

Only `test/unit/` exists; `test:integration` matches no directory today.

## Deploy

Knative Service, min 1 / max 3, concurrency target 50, image
`dev.local/tenant-service:local`
(`knative/services/base/tenant-service.yaml:14-16`, `:22`).

RBAC: the `tenant-namespace-manager` ClusterRole
(`knative/services/rbac/cluster-role.yaml:4`) is what grants namespace,
Service, ConfigMap, Secret, PVC and StatefulSet management.

```bash
./rebuild-redeploy.sh tenant-service dev
```
