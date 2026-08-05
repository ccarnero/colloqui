# API Gateway

Class: descriptive
Summary: The single HTTP entry point: its proxy modules, global JWT and tenant guards, webhook ingress and gateway-audit publication, and the dynamic route registry.

The single HTTP entry point for the platform. It proxies to every downstream
service, enforces JWT authentication and tenant isolation through global guards,
publishes webhook ingress and gateway-audit events to NATS, and dynamically
routes non-platform paths to tenant-registered Knative services.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: NATS (`nats://localhost:4222`), Redis (`localhost:6379`), `JWT_SECRET` env var.

## API Versioning

All application routes are externally served under the global `/api` prefix
plus NestJS URI versioning (`src/main.ts`), with no per-controller
`@Version()` decorators needed:

```ts
app.setGlobalPrefix("api", { exclude: [...] });
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: ["1", VERSION_NEUTRAL],
});
```

- Canonical routes are `/api/v1/...`.
- The unversioned `/api/...` alias still resolves (`VERSION_NEUTRAL`) but is
  treated as deprecated: responses get a `Deprecation: true` header and a
  `Link: <.../api/v1/...>; rel="successor-version"` header pointing callers
  at the versioned path.
- `/api/docs` (Swagger) is listed in `VERSIONING_EXEMPT_PREFIXES` and is
  never flagged as deprecated, since it was never a versioned route.
- The tables below show the unversioned form for brevity; prefer
  `/api/v1/...` in new clients.

## Endpoints

All application routes are externally served under the global `/api` prefix.
Only health-style routes such as `/health` and `/readyz` are excluded.

### Controllers

Every mounted controller (`rg '@Controller\(' services/api-gateway/src`):

| Base path | Controller |
|---|---|
| `/api/auth` | `src/modules/auth/auth.controller.ts:35` |
| `/api/audit/events`, `/api/audit/channel-events` | `src/modules/audit/audit.controller.ts:17`, `channel-audit.controller.ts:17` |
| `/api/tenants` | `src/modules/tenants/tenants.controller.ts:21` |
| `/api/registry` | `src/modules/registry/registry.controller.ts:27` |
| `/api/workflows` | `src/modules/workflows/workflows.controller.ts:26` |
| `/api/connectors` | `src/modules/connectors/connectors.controller.ts:26` (CRUD) and `src/modules/connector-invoke/connector-invoke.controller.ts:28` (invoke facade) |
| `/api/channels`, `/api/webhooks` | `src/modules/channels/channels.controller.ts:39`, `webhooks.controller.ts:28` |
| `/api/admin/...` | ten controllers under `src/modules/admin/` — agents, jobs, config, knowledge-bases (+ documents), mcp-servers, memories, skills, structured-kb, system-variables, tools |
| `/api/runtime`, `/api/runtime/executions` | `src/modules/runtime/runtime-health.controller.ts:8`, `runtime.controller.ts:21` |
| `/api/tracking` | `src/modules/tracking/tracking.controller.ts:18` |
| `/api/provisioning` | `src/modules/provisioning/provisioning.controller.ts:47` |
| `/api/dashboard` | `src/modules/dashboard/dashboard.controller.ts:8` |
| `/api/proxy` | `src/modules/proxy/proxy.controller.ts:7` |
| `/health`, `/readyz` | `src/modules/health/health.controller.ts:9` — excluded from the `/api` prefix (`src/main.ts:80-85`) |

There is no events module: the gateway does not expose `POST /api/events`,
`GET /api/results/:id` or an SSE stream. Real-time agent execution streaming is
served by `/api/runtime/executions` (proxied to ai-agent-gateway).

### Auth (proxy to auth-service)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/token` | Client credentials grant |
| `POST` | `/api/auth/login` | User login (platform and tenant users) |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `GET/POST` | `/api/auth/users` | Platform user management |
| `GET/POST/DELETE` | `/api/auth/clients` | API client management |
| `GET/POST/DELETE` | `/api/auth/public-routes` | Public route management |
| `POST` | `/api/auth/tenant-users` | Create tenant user (platform or matching tenant scope) |
| `GET` | `/api/auth/tenant-users` | List tenant users |
| `GET` | `/api/auth/tenant-users/:id` | Get tenant user |
| `PATCH` | `/api/auth/tenant-users/:id` | Update tenant user |
| `DELETE` | `/api/auth/tenant-users/:id` | Deactivate tenant user |

### Platform Services (proxy)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit/events` | Query audit events |
| `POST/GET/PATCH/DELETE` | `/api/tenants` | Tenant management |
| `POST/GET/PATCH/DELETE` | `/api/registry/services` | Service registry |
| `POST/PATCH/GET` | `/api/registry/services/:id/canary` | Canary deployments |
| `POST/GET` | `/api/workflows` | Workflow management |
| `POST/GET/PATCH/DELETE` | `/api/connectors` | HTTP connector management |
| `GET` | `/health` | Aggregated health check |

## Authentication and tenancy

Two global `APP_GUARD`s run in order:

1. **`TenantGuard`** (`src/guards/tenant.guard.ts`) resolves the tenant from the
   request — hostname or the `x-yoizen-tenant` header — and attaches it.
   `@SkipTenant()` (`src/decorators/skip-tenant.decorator.ts`) opts a handler out.
2. **`AuthGuard`** (`src/guards/auth.guard.ts`) verifies the JWT with `jose`,
   unless the handler carries `@Public()` or the method+path matches a DYNAMIC
   public route. A `platform`-scoped token passes everywhere; a `tenant:<name>`
   token must match the resolved tenant. `@Scopes(...)` and `@Permissions(...)`
   (`src/decorators/`) add per-handler requirements.

Dynamic public routes come from Redis through
`src/modules/auth/public-routes-cache.service.ts`, cached in memory until
`PUBLIC_ROUTES_CACHE_TTL` seconds elapse — 30 s
(`packages/shared/src/auth.constants.ts`, applied by
`PublicRoutesCacheService`). A route added to auth-service is therefore not effective at
the gateway until that TTL expires.

## Dynamic routing

A Fastify `onRequest` hook (`src/hooks/proxy.hook.ts`) intercepts every path
that does NOT start with a platform prefix. The prefix list is explicit
(`PLATFORM_PREFIXES`, `proxy.hook.ts`):

```
/api/audit  /api/tenants  /api/registry  /api/connectors  /api/channels
/api/webhooks  /api/workflows  /api/proxy  /api/auth  /api/dashboard
/api/admin  /api/runtime  /health
```

Version segments are stripped before matching, so `/api/v1/workflows` and
`/api/workflows` hit the same prefix (`stripVersionSegment`, applied by
`isPlatformRoutePath` in `proxy.hook.ts`).

Everything else is matched against `DynamicRouteCacheService`
(`src/modules/dynamic-routes/dynamic-route-cache.service.ts`), which polls
registry-service's `GET /routes` every 15 s (`POLL_INTERVAL_MS`, `:28`,
`:44`) — so a newly registered route can take up to 15 s to become routable.
Non-public matches still go through JWT + tenant-scope verification before the
request is proxied to the tenant's Knative service.

## Webhook publish safety nets

Introduced after the 2026-05-22 stress post-mortem, when the NATS client's
default ~5 s request timeout fired during JetStream stalls and surfaced to
providers as opaque 500s (the reasoning is recorded in the doc comment above
`gatewayConfig.webhook` in `src/config/gateway.config.ts`):

| Setting | Env var | Default | Effect |
|---|---|---|---|
| Publish ack timeout | `WEBHOOK_PUBLISH_TIMEOUT_MS` | `10000` | On expiry the publisher raises `ServiceUnavailableException`, so the filter answers **503 + `Retry-After`** and WhatsApp/Telegram/Meta RETRY instead of dropping the webhook (`gatewayConfig.webhook.publishTimeoutMs`) |
| In-flight cap | `WEBHOOK_PUBLISH_INFLIGHT_CAP` | `200` | Bounds concurrent publishes per pod so a backend stall cannot grow pending acks without limit (`gatewayConfig.webhook.publishInflightCap`) |

Both are parsed by `positiveIntEnv` (`gateway.config.ts`), which falls back to
the default on an empty, NaN or non-positive value — a misconfiguration cannot
silently turn the knob into a no-op.

## Gateway audit

A global `APP_INTERCEPTOR` (`AuditInterceptor`, `src/app.module.ts:63-64`) publishes one gateway-audit event per request to the
`GATEWAY_AUDIT` JetStream stream, consumed by audit-service. Two flags on
`gatewayConfig.audit`, both `get` accessors over `parseBoolEnv`
(`gateway.config.ts`), so a value change takes effect without a restart:

| Env var | Default | Effect |
|---|---|---|
| `GATEWAY_AUDIT_ENABLED` | `true` | Master switch |
| `GATEWAY_AUDIT_SKIP_WEBHOOKS` | `false` | Skips the audit publish on webhook ingress paths to shed NATS load under stress |

## Tenant-User Proxy Endpoints

The gateway proxies all `/api/auth/tenant-users` CRUD operations to the auth-service. The `POST` endpoint (create) allows `platform` scope or a matching tenant-scoped `tenant_admin` at the gateway (`@Scopes("platform", "tenant")`). The create path validates that the `tenant_id` in the request body corresponds to an existing tenant; tenant admins cannot create users for another tenant. The `GET`, `PATCH`, and `DELETE` endpoints are accessible to platform-scoped tokens and tenant-scoped tokens whose scope matches the resolved tenant.

The existing `AuthGuard` automatically enforces that a JWT with `scope: 'tenant:acme'` can only access resources when `x-yoizen-tenant: acme`.

## Environment Variables

All of these live in `src/config/gateway.config.ts`, in the `gatewayConfig`
object literal. Every `*_SERVICE_URL` / `*_URL` default is
`platformServiceUrl(<name>, env)` under `gatewayConfig.services`, so the
"Default" column names only the SERVICE the URL resolves to.

| Variable | Default | `gatewayConfig` key | Description |
|---|---|---|---|
| `PORT` | `3000` | `port` | HTTP server port (module-level `gatewayPort`) |
| `JWT_SECRET` | *(required)* | `jwtSecret` | HS256 verification key. A `get` accessor, so it is read at ACCESS time rather than module load and tests can set it late; an unset value falls back to `""`, not an error |
| `PLATFORM_ENVIRONMENT` | `dev` | `environment` | Feeds every default service URL (module-level `env`) |
| `CORS_ORIGIN` | `http://localhost:4200` | `corsOrigin` | |
| `API_GATEWAY_SELF_URL` | `http://127.0.0.1:<PORT>` | `selfBaseUrl` | Used by the dashboard aggregator to fetch this gateway's own `/health` |
| `AUTH_SERVICE_URL` | `auth-service` | `services.auth` | |
| `AUDIT_SERVICE_URL` | `audit-service-api` | `services.audit` | |
| `TENANT_SERVICE_URL` | `tenant-service` | `services.tenant` | |
| `REGISTRY_SERVICE_URL` | `registry-service` | `services.registry` | |
| `WORKFLOW_SERVICE_URL` | `workflow-service-api` | `services.workflow` | |
| `CONNECTOR_ADMIN_URL` | `connector-admin-api` | `services.connectorAdmin` | |
| `CACHE_SERVICE_URL` | `cache-service` | `services.cache` | |
| `PROXY_SERVICE_URL` | `proxy-service` | `services.proxy` | |
| `CHANNEL_SERVICE_URL` | `channel-service-api` | `services.channel` | |
| `ADMIN_SERVICE_URL` | `agent-admin-service` | `services.admin` | |
| `AI_AGENT_GATEWAY_URL` | `ai-agent-gateway` | `services.aiAgentGateway` | |
| `AGENT_MEMORY_SERVICE_URL` | `agent-memory-service` | `services.agentMemory` | |
| `TRACKING_SERVICE_URL` | `tracking-ingester-worker` **+ `:3000`** | `services.tracking` | see the port note below |
| `CONNECTOR_RUNTIME_HTTP_URL` | `connector-runtime-http` **+ `:3100`** | `services.connectorRuntimeHttp` | see the port note below |
| `PROVISIONING_SERVICE_URL` | `provisioning-service` | `services.provisioning` | plain ksvc — no port suffix |
| `RATE_LIMIT_ALGORITHM` | `token-bucket` | `rateLimit.algorithm` | Typed as `token-bucket` \| `sliding-window` \| `fixed-window`, but the value is a bare cast — an unrecognised string is passed through, not rejected |
| `RATE_LIMIT_DEFAULT_LIMIT` / `_WINDOW_MS` / `_CAPACITY` / `_REFILL_RATE` | `100` / `60000` / `100` / `10` | `rateLimit.*` | Parsed with bare `Number(...)`, unlike the webhook knobs below |
| `WEBHOOK_PUBLISH_TIMEOUT_MS` | `10000` | `webhook.publishTimeoutMs` | See webhook safety nets above |
| `WEBHOOK_PUBLISH_INFLIGHT_CAP` | `200` | `webhook.publishInflightCap` | |
| `GATEWAY_AUDIT_ENABLED` | `true` | `audit.enabled` | `get` accessor — re-read per request |
| `GATEWAY_AUDIT_SKIP_WEBHOOKS` | `false` | `audit.skipWebhookPaths` | `get` accessor — re-read per request |

Two targets need an EXPLICIT port suffix because they are plain Deployments
behind a ClusterIP Service rather than Knative ksvcs listening on port 80:
`tracking-ingester-worker:3000` and `connector-runtime-http:3100`. Dropping the
suffix makes the proxy connect to port 80 and hang until the 30 s timeout —
the reason is recorded in the code comments above `services.tracking` and
`services.connectorRuntimeHttp`.

`NATS_URL`, `REDIS_HOST` and `REDIS_PORT` are read by the shared
`@yoizen/database` providers, not by `gateway.config.ts`.

## Testing

```bash
cd services/api-gateway
bun run test:unit          # mocked NATS, Redis, downstream services
```

Only `test/unit/` exists; `test:integration` matches no directory today, so
`bun run test` (which chains both) currently fails at the second step.

## Deploy

```bash
./rebuild-redeploy.sh api-gateway dev
```
