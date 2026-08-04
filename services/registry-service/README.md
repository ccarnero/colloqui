# Registry Service

Knative-based service registry for tenant workloads. Tenants register their own
services; this service creates and manages the corresponding Knative Service
through the Kubernetes CustomObjects API, tracks routes for api-gateway's
dynamic routing, and drives canary deployments via traffic splitting.

State lives in a **shared platform database** (one database, `tenant_id`
columns), not a per-tenant one — unlike most services on this platform.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: the platform database for the active engine, and Kubernetes cluster
access.

## Endpoints

Every `/services**` operation reads the `x-yoizen-tenant` header and is scoped
by `tenant_id`. Two endpoints are NOT: `GET /routes` (cross-tenant discovery,
see below) and `GET /health` take no tenant at all.

The header is read with a bare `@Headers(TENANT_HEADER)` parameter — there is
no `TenantGuard` and no `@UseGuards` anywhere in this service — so an omitted
header is `undefined` at the service layer rather than a `400`, and it reaches
`knativeServiceName(dto.name, tenantId)` / `namespaceName(tenantId, env)` as-is.
Callers arrive through api-gateway, which supplies the header.

| Method | Path | Source |
|---|---|---|
| `POST` | `/services` | `src/modules/services/services.controller.ts:21` |
| `GET` | `/services` | `services.controller.ts:30` |
| `GET` | `/services/:id` | `services.controller.ts:35` |
| `PATCH` | `/services/:id` | `services.controller.ts:40` |
| `DELETE` | `/services/:id` | `services.controller.ts:49` |
| `GET` | `/services/:id/revisions` | `services.controller.ts:58` |
| `POST` | `/services/:serviceId/canary` | `src/modules/canary/canary.controller.ts:20` |
| `PATCH` | `/services/:serviceId/canary` | `canary.controller.ts:30` |
| `POST` | `/services/:serviceId/canary/promote` | `canary.controller.ts:39` |
| `POST` | `/services/:serviceId/canary/rollback` | `canary.controller.ts:48` |
| `GET` | `/services/:serviceId/canary` | `canary.controller.ts:57` |
| `POST` | `/services/:serviceId/routes` | `src/modules/routes/routes.controller.ts:20` |
| `GET` | `/services/:serviceId/routes` | `routes.controller.ts:30` |
| `DELETE` | `/services/:serviceId/routes/:routeId` | `routes.controller.ts:38` |
| `GET` | `/routes` | `routes.controller.ts:48` — discovery, polled by api-gateway. **No tenant parameter**: `RoutesService.discover()` caches under the single key `"__all__"` and returns every active route across every tenant, each row carrying its own `tenantId` |
| `GET` | `/health` | `src/modules/health/health.controller.ts:24-48` |

`GET /health` probes Kubernetes plus the active store and returns
`{ status, kubernetes, postgres }` or `{ status, kubernetes, mongo }`;
`status` is `"ok"` only when BOTH are connected (`health.controller.ts:31-47`).

### Route discovery cache

`GET /routes` is served from an in-memory cache with a 10 s TTL
(`RoutesService.CACHE_TTL_MS`, `src/modules/routes/routes.service.ts:44`,
checked at `:142`). api-gateway polls this endpoint, so a newly created route
can take up to the TTL to become routable.

### Canary revision polling

Starting a canary updates the Knative image and then polls for a NEW revision
name every 2 s until a caller-supplied deadline
(`waitForNewRevision`, `src/modules/canary/canary.service.ts:320-337`). It
returns `null` on timeout rather than throwing.

## Storage

`DB_ENGINE` selects Postgres or Mongo (`src/config.ts:36-38`). The Postgres DDL
runs at startup from `src/providers/postgres.module.ts` and creates three
tables:

| Table | Line |
|---|---|
| `registered_services` | `postgres.module.ts:11` |
| `service_routes` | `postgres.module.ts:31` |
| `canary_deployments` | `postgres.module.ts:43` |

## Service-events publisher

After every `register` / `update` / `remove`, `ServicesService` emits a
CloudEvents envelope to the tenant's own INGRESS stream. The publish happens
**post-commit and never throws to the caller**, so the HTTP response does not
depend on broker availability
(`src/modules/services/service-events.publisher.ts`).

- Subject: `evt.<tenant>.registry-service.platform.service.system.<upserted|deleted>.v1`,
  built by `buildRegistryPlatformSubject`.
- CloudEvents `type`: `io.yoizen.registry.service.upserted.v1` /
  `io.yoizen.registry.service.deleted.v1`
  (`packages/shared/src/platform.utils.ts:66-69`).
- CloudEvents `source`: `registry-service/services`
  (`platform.utils.ts:72`).
- `msgID` is the envelope's deterministic CloudEvents `id`
  (`service-events.publisher.ts:261`), so JetStream de-duplicates retries even
  across publisher restarts.
- Bounded retry: three attempts total with backoffs `[100, 500, 2000]` ms
  (`RETRY_BACKOFFS_MS`, `service-events.publisher.ts:49`). The 2 s cap is
  deliberate — a longer tail would leave the post-commit hook hanging during a
  broker outage (`:40-48`).

Consumer: connector-admin materializes these into per-tenant `http_adapters`
mirrors via its `adapter-internal-sync` durable.

### Feature flag

`REGISTRY_EMIT_ADAPTER_SYNC` defaults to **false** (`src/config.ts:51-53`), in
which case the publisher short-circuits before any broker contact. The flag
parser accepts `true|1|yes` and `false|0|no` and silently falls back to the
default on anything else (`parseBoolEnv`, `src/config.ts:23-29`).

### Metrics

`src/modules/services/service-events.metrics.ts`:
`registry_publish_attempts_total{event_type}` (`:57`),
`registry_publish_successes_total{event_type}` (`:69`),
`registry_publish_failures_total{event_type,reason}` (`:85`), and
`registry_ensure_stream_calls_total{result}` (`:97`) where `result` is
`hit`/`miss` for the per-tenant `ensureTenantIngressStream` cache.

## Environment Variables

`src/config.ts` — lazy getters (`:31-32`).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`src/config.ts:33-35`) |
| `DB_ENGINE` | `postgres` | Storage engine; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`, read at `src/config.ts:36-38`) |
| `POSTGRES_HOST` | `postgres.support-services-dev.svc.cluster.local` | (`src/config.ts:4-5`, `:42-44`) |
| `MONGO_HOST` | `mongo.support-services-dev.svc.cluster.local` | (`src/config.ts:3`, `:39-41`) |
| `MONGO_DB` | `yoizen` | (`src/config.ts:45-47`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Namespace resolution (`src/config.ts:48-50`) |
| `REGISTRY_EMIT_ADAPTER_SYNC` | `false` | Service-events publisher on/off (`src/config.ts:51-53`) |

## Testing

```bash
cd services/registry-service
bun run test:unit
```

Only `test/unit/` exists; `test:integration` matches no directory today.

## Deploy

Knative Service, min 1 / max 3, concurrency target 50, image
`dev.local/registry-service:local`
(`knative/services/base/registry-service.yaml:14-16`, `:22`).

RBAC: the `registry-service-manager` ClusterRole
(`knative/services/rbac/cluster-role.yaml:28`) grants Knative service/revision
and namespace access.

```bash
./rebuild-redeploy.sh registry-service dev
```
