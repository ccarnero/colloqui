# CLAUDE.md — @yoizen/shared

## Package Overview

`@yoizen/shared` is the single source of truth for cross-service types, constants, schema definitions, and shared runtime utilities in the Yoizen platform. It covers messaging envelopes, NATS/JetStream topology helpers, adapter resolution, circuit breaking, multi-tenancy, workflows, auth, and database schema DDL shared across services.

## Package Details

| Field | Value |
|-------|-------|
| Name | `@yoizen/shared` |
| Version | `1.0.0` |
| Private | `true` |
| Entry | `./src/index.ts` |
| Peer dependencies | `class-transformer`, `class-validator`, `nats` (all required) |
| Dependencies | `reflect-metadata` |

Named subpath exports: `./constants`, `./channel-constants`, `./permanent-error`, `./circuit-breaker`, `./dto/pagination`.

## Repository Structure

```
src/
├── index.ts                        # Barrel export for all modules
│
│── Core event envelope
├── interfaces.ts                   # EventEnvelope, EventTransport, EventData, JsonValue
├── envelope.utils.ts               # canonicalJson, computeIdempotencyKey, buildSubject, parseSubject,
│                                   #   deriveEnvelope, buildEventEnvelope, isCompliantEnvelope,
│                                   #   MAX_DEPTH_BY_CATEGORY, DepthExceededError
├── webhook.interfaces.ts           # WebhookIngressEnvelope, IWebhookIngressData, IWebhookVerifyRequest/Response
│
│── NATS / stream topology
├── constants.ts                    # Platform-level constants: DLQ stream, Redis keys, tenant header,
│                                   #   scheduler, registry/Knative, Temporal task queues,
│                                   #   gateway audit stream, platform event subjects/helpers
├── tenant-stream.constants.ts      # Per-tenant ingress stream helpers: getTenantStreamName,
│                                   #   getTenantSubjectPattern, buildTenantStreamConfig,
│                                   #   TENANT_TIER_LIMITS, checkJetStreamCapacity
├── channel.constants.ts            # Messaging-domain constants: INGRESS stream prefix,
│                                   #   subject patterns, claim-check thresholds, DLQ helpers
│                                   #   (buildDlqStreamName, buildDlqSubjectPattern, buildDlqMessageSubject)
├── channel.utils.ts                # Subject builders/parsers: buildChannelSubject,
│                                   #   buildWebhookIngressSubject, buildIngressStreamName,
│                                   #   buildClaimCheckBucket, parseChannelSubject,
│                                   #   parseWebhookIngressSubject, buildTenantWildcard
├── tenant-events.ts                # PLATFORM_TENANTS stream, tenant provision/ready/deleted
│                                   #   subjects + message types + guards
│
│── Auth
├── auth.constants.ts               # ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, public routes cache config
├── auth.interfaces.ts              # JwtPayload, TokenResponse, TokenScope, UserRole,
│                                   #   PublicRouteEntry, ITenantRole, ITenantRolePermission
│
│── Channel / messaging
├── channel.interfaces.ts           # Channel, ChannelProvider, MessageKind, ChannelEnvelope,
│                                   #   ChannelAccount, InboundMessage, OutboundMessage,
│                                   #   IChannelProvider, AutoReplyRule
│
│── Adapter / connector
├── adapter.interfaces.ts           # AdapterConfig, AdapterEndpointConfig, AdapterCache,
│                                   #   ResolvedAdapterRequest, AdapterReference,
│                                   #   DEFAULT_CONNECTOR_ADMIN_URL
├── adapter-client.ts               # AdapterClient (SWR cache, OAuth2, request resolution),
│                                   #   createAdapterClientWithRedisAndFetch
├── adapter-auth-headers.ts         # applyAdapterAuthHeadersSync (none/api-key/bearer/basic)
│
│── Workflow / Temporal
├── workflow.interfaces.ts          # WorkflowDefinition, WorkflowExecutionContext,
│                                   #   WorkflowAction (union), all activity arg types,
│                                   #   triggers, EventCausalContext
├── execution.interfaces.ts         # YoizenClawExecutionClient interfaces and status types
├── execution-client.ts             # YoizenClawExecutionClient (submit execution, wait for result)
├── http-execution.interfaces.ts    # HttpEndpointRequest, HttpServiceRequest,
│                                   #   AgentChatContextEntry (used by connector-runtime)
│
│── Rate limiting
├── rate-limit.constants.ts         # RATE_LIMIT_KEY_PREFIX, algorithm defaults, poll intervals
├── rate-limit.interfaces.ts        # RateLimitTenantConfig, RateLimitResult, RateLimitAlgorithm
│
│── Multi-tenancy / platform
├── tenant-stream.constants.ts      # (see above — also exports TenantTier, TenantStreamConfig)
├── tenant-database-tier.ts         # TenantDatabaseTier enum, tenantPostgresDatabaseName/RoleName
├── tenant-namespace.ts             # tenantKubernetesNamespaceName, invalidPlatformEnvironmentMessage
├── tenant-events.ts                # (see above)
├── tenant.utils.ts                 # extractTenantId, validateTenantId, isPlatformTenantRowIdParam
├── platform-environment.ts         # VALID_ENVIRONMENTS, Environment type
├── platform-service-url.ts         # platformServiceUrl — in-cluster K8s URL builder
├── platform.utils.ts               # buildRegistryPlatformSubject/Wildcard, service lifecycle
│                                   #   payloads + constants (SERVICE_UPSERTED_EVENT_TYPE, etc.)
│
│── Database schema (DDL + indexes — shared across services and tenant provisioning)
├── mongo-schema.types.ts           # IMongoCollectionSchema, IMongoIndexSpec
├── platform-mongo-schema.ts        # PLATFORM_MONGO_SCHEMA — platform catalog, auth, registry
├── admin-mongo-schema.ts           # PLATFORM_ADMIN_MONGO_SCHEMA — agents, credentials, jobs, executions
├── adapter-mongo-schema.ts         # ADAPTER_MONGO_SCHEMA — per-tenant http_adapters
├── adapter-schema.ts               # ADAPTER_SCHEMA_SQL — Postgres DDL for http_adapters
├── audit-mongo-schema.ts           # AUDIT_MONGO_SCHEMA — per-tenant audit collections
├── channel-mongo-schema.ts         # CHANNEL_MONGO_SCHEMA — channel_accounts, auto_reply_rules
├── channel-schema.ts               # CHANNEL_ACCOUNTS_SCHEMA_SQL — Postgres DDL for channel tables
├── channel-usage-mongo-schema.ts   # CHANNEL_USAGE_MONGO_SCHEMA — per-tenant usage metrics (Mongo)
├── channel-usage-schema.ts         # Channel usage Postgres/TimescaleDB DDL
├── registry-mongo-schema.ts        # REGISTRY_MONGO_SCHEMA — subset of PLATFORM_MONGO_SCHEMA
├── tenant-auth-mongo-schema.ts     # TENANT_AUTH_MONGO_SCHEMA — per-tenant RBAC + user accounts
├── tenant-auth-schema.ts           # Tenant auth Postgres DDL (roles, users, permissions)
├── workflow-mongo-schema.ts        # WORKFLOW_MONGO_SCHEMA — per-tenant workflow collections
├── workflow-schema.ts              # WORKFLOW_SCHEMA_SQL — Postgres DDL for workflow_executions
│
│── Runtime utilities
├── circuit-breaker.ts              # DistributedCircuitBreaker (Redis Lua scripts, local fallback),
│                                   #   computeBreakerKey, IBreakerConfig
├── fifo-map.ts                     # evictOldestIfCapacityBeforeSet, evictOneOldestIfExceedsMax
├── id.utils.ts                     # generateId — crypto.randomUUID() wrapper
├── phone.utils.ts                  # parseSenderId, normalizeRecipient (E.164 + BSUID handling)
├── permanent-error.ts              # PermanentError, isPermanentError (JetStream DLQ signalling)
├── pagination.ts                   # IPaginationQueryDto, clampListLimit, clampListOffset
├── paginated-query.dto.ts          # PaginatedQueryDto (class-validator DTO with @Type transforms)
├── async.utils.ts                  # sleep(ms) — backoff and test timing
│
│── Other interfaces
├── dashboard.interfaces.ts         # DashboardStats, DashboardActivity, DashboardQuota, etc.
├── embedding-client.interfaces.ts  # EmbeddingClientConfig, IEmbeddingClient
├── health.interfaces.ts            # IAuthServiceHealthResponse, ICacheServiceHealthResponse, etc.
├── knowledge-base.interfaces.ts    # IKnowledgeBase, IDocument, DocumentStatus, etc.
├── variable.interfaces.ts          # VariableResolutionContext, VariableDeclaration, IDataConnection
├── chunker.interfaces.ts           # Chunker interfaces for knowledge-base document splitting
```

## NATS Stream Topology

The canonical topology is **per-tenant**. See `DOCS/03-NATS-JETSTREAM.md` and `DOCS/arquitectura/02-diseño-de-mensajes.md` for the authoritative contract.

### Per-Tenant Helpers (`tenant-stream.constants.ts`, `channel.constants.ts`, `channel.utils.ts`)

| Helper / Constant | Value / Pattern |
|---|---|
| `getTenantStreamName(tenantId)` | `INGRESS-<tenant>` |
| `getTenantSubjectPattern(tenantId)` | `evt.<tenant>.>` |
| `buildTenantStreamConfig(tenantId, tier)` | Returns `TenantStreamConfig` with tier-scoped limits |
| `TENANT_TIER_LIMITS` | `free` / `pro` / `enterprise` limits (max_age, max_bytes, replicas, object store) |
| `buildClaimCheckBucket(tenant)` | `PAYLOAD-<tenant>` (Object Store) |
| `buildDlqStreamName(tenantId)` | `DLQ-<tenantId>` |
| `buildDlqSubjectPattern(tenantId)` | `dlq.<tenantId>.>` |
| `CHANNEL_STREAM_SUBJECTS_PATTERN` | `evt.*.channel-service.messaging.>` |
| `WEBHOOK_INGRESS_SUBJECT_FILTER` | `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1` |

### Legacy Global NATS Constants (`constants.ts`) — marked legacy

The following constants from `constants.ts` remain in the source but belong to the legacy pre-tenant-topology:

| Constant | Value | Status |
|---|---|---|
| `DLQ_STREAM_NAME` | `DLQ` | **Legacy** — global fallback stream for `dlq.webhook` only; per-tenant DLQ is `DLQ-<tenant>` via `buildDlqStreamName` |
| `DLQ_STREAM_SUBJECTS` | `['dlq.webhook']` | **Legacy** — only covers the webhook delivery DLQ; `dlq.<tenant>.>` is reserved for per-tenant streams |
| `DLQ_STREAM_MAX_BYTES` | 64 MB | **Legacy** — used with `DLQ_STREAM_NAME` |
| `STREAM_MAX_AGE_NS` | 7 days (ns) | General-purpose, used outside channel streams |
| `MAX_DELIVER` | `5` | General-purpose consumer default |

### Gateway Audit Stream (`constants.ts`)

| Constant | Value |
|---|---|
| `GATEWAY_AUDIT_STREAM_NAME` | `GATEWAY_AUDIT` |
| `GATEWAY_AUDIT_STREAM_SUBJECTS` | `['audit.gateway.>']` |
| `GATEWAY_AUDIT_SUBJECT` | `audit.gateway.request` |
| `GATEWAY_AUDIT_CONSUMER_NAME` | `gateway-audit-writer` |
| `GATEWAY_AUDIT_STREAM_MAX_BYTES` | 128 MB |

### Platform Events (`constants.ts`)

Platform events use subject templates (call `buildPlatformSubject(template, tenantId)` to resolve `{tenant}`):

| Constant | Subject pattern |
|---|---|
| `PLATFORM_CONFIG_SYNC` | `evt.{tenant}.agent-admin-service.automation.platform.internal.config_sync.v1` |
| `PLATFORM_EXECUTION_REQUESTED` | `evt.{tenant}.ai-agent-gateway.automation.platform.internal.execution_requested.v1` |
| `PLATFORM_EXECUTION_STARTED / COMPLETED / FAILED` | same prefix, `execution_started/completed/failed.v1` |
| `PLATFORM_CHAT_RESPOND`, `PLATFORM_AGENT_OUTBOUND`, `PLATFORM_EXECUTION_STATUS`, etc. | `evt.{tenant}.agent-admin-service.automation.platform.internal.<kind>.v1` |

## Temporal Task Queue Constants (`constants.ts`)

| Constant | Value | Used By |
|---|---|---|
| `WORKFLOW_ORCHESTRATOR_TASK_QUEUE` | `workflow-orchestrator` | workflow-service worker and dispatcher |
| `CONNECTOR_RUNTIME_TASK_QUEUE` | `connector-runtime` | connector-runtime worker; workflow-service dispatches HTTP/agent activities here |
| `WORKFLOW_DEFAULT_TIMEOUT_MS` | `600_000` (10 min) | Default `workflowExecutionTimeout` for `runWorkflow` |
| `WORKFLOW_TASK_TIMEOUT_MS` | `30_000` | Default `workflowTaskTimeout` |

> Note: `HTTP_ADAPTER_TASK_QUEUE` (`http-adapter`) does NOT exist in the current source. The canonical task queue is `CONNECTOR_RUNTIME_TASK_QUEUE`.

## EventEnvelope Interface (`interfaces.ts`)

The `EventEnvelope` is a CloudEvents-inspired structure. Fields: `specversion`, `id`, `source`, `type`, `resource`, `time`, `traceid`, `causation_id`, `correlation_id`, `tenant`, `producer`, `domain`, `channel`, `provider`, `accountid`, `idempotencykey`, `transport` (`EventTransport`), `data` (`EventData`).

Optional pipeline extensions: `callback_url`, `adapter_id`, `enrich_adapter`, `forward_adapter`.

For the full envelope contract, field semantics, subject taxonomy, and idempotency rules, see:
- `DOCS/arquitectura/02-diseño-de-mensajes.md` — canonical contract (as-built)
- `DOCS/03-NATS-JETSTREAM.md` — stream topology and operational reference

## Auth Constants and Interfaces

| Constant | Value |
|---|---|
| `ACCESS_TOKEN_TTL` | `3600` s |
| `REFRESH_TOKEN_TTL` | `86_400` s |
| `PUBLIC_ROUTES_CACHE_KEY_PREFIX` | `public_routes:` |
| `PUBLIC_ROUTES_CACHE_TTL` | `30` s |
| `TENANT_HEADER` | `x-yoizen-tenant` |

Auth types exported: `JwtPayload`, `TokenResponse`, `TokenScope`, `UserRole`, `PublicRouteEntry`, `ITenantRole`, `ITenantRolePermission`, `SYSTEM_ROLE_TENANT_ADMIN`.

## Redis Key Constants (`constants.ts`)

| Constant | Value |
|---|---|
| `RESULT_KEY_PREFIX` | `result:` |
| `PENDING_KEY_PREFIX` | `pending:` |
| `CALLBACK_KEY_PREFIX` | `callback:` |
| `RESULT_TTL` / `PENDING_TTL` / `CALLBACK_TTL` | `3600` s each |
| `RESULT_CACHE_MAX` | `1024` |

## Rate Limit Constants (`rate-limit.constants.ts`)

| Constant | Value |
|---|---|
| `RATE_LIMIT_KEY_PREFIX` | `ratelimit:` |
| `RATE_LIMIT_DEFAULT_ALGORITHM` | `sliding_window` |
| `RATE_LIMIT_DEFAULT_LIMIT` | `1000` |
| `RATE_LIMIT_DEFAULT_WINDOW_MS` | `60_000` |
| `RATE_LIMIT_CONFIG_POLL_INTERVAL_MS` | `15_000` |

## Registry / Knative Constants (`constants.ts`)

| Constant | Value |
|---|---|
| `REGISTRY_KNATIVE_GROUP` | `serving.knative.dev` |
| `REGISTRY_KNATIVE_VERSION` | `v1` |
| `REGISTRY_DEFAULT_SERVICE_PORT` | `3000` |
| `REGISTRY_PRODUCER` | `registry-service` |
| `PLATFORM_NON_CHANNEL_TOKEN` | `system` |

## Consumer Services

Services that import from `@yoizen/shared` (verified via source search):

| Service |
|---|
| api-gateway |
| ai-agent-gateway |
| auth-service |
| audit-service |
| agent-admin-service |
| agent-ai-service |
| agent-memory-service |
| agent-scheduler-service |
| channel-service |
| connector-admin |
| connector-runtime |
| proxy-service |
| registry-service |
| tenant-service |
| usage-aggregator-service |
| workflow-service |
| cache-service |
| admin-console (frontend) |

## Code Style and Conventions

- **Types and constants are the core**: most files export only types, interfaces, and constant values with no side effects.
- **Runtime modules**: several files contain real runtime logic — `AdapterClient`, `YoizenClawExecutionClient`, `DistributedCircuitBreaker`, `envelope.utils.ts` (idempotency, derivation, validation), `channel.utils.ts` (subject builders/parsers), `platform.utils.ts`, `tenant.utils.ts`, `phone.utils.ts`, `pagination.ts`, `permanent-error.ts`, `fifo-map.ts`, `adapter-auth-headers.ts`.
- **Schema DDL files**: `*-schema.ts` (SQL) and `*-mongo-schema.ts` (MongoDB index descriptors) are the single source of truth for schema applied during tenant provisioning and service startup. They intentionally omit `tenant_id` columns — the DB itself is the tenant boundary.
- **Barrel exports**: `index.ts` re-exports everything; named subpath exports exist for `constants`, `channel-constants`, `permanent-error`, `circuit-breaker`.
- **Naming**: `SCREAMING_SNAKE_CASE` for constants, `PascalCase` for interfaces and classes.
- **Versioning**: not published to npm; consumed via workspace `file:` references.
- **TypeScript strict mode**: all strict checks enabled.

## Common Tasks

### Add a new constant

1. Add to the appropriate file (`constants.ts`, `auth.constants.ts`, `channel.constants.ts`, `rate-limit.constants.ts`, etc.).
2. Confirm `index.ts` covers it (it re-exports all modules via wildcard).

### Add a new interface

1. Add to the appropriate file (`interfaces.ts`, `auth.interfaces.ts`, `workflow.interfaces.ts`, etc.) or create a new `<domain>.interfaces.ts`.
2. Confirm it is exported from `index.ts`.

### Add a per-tenant DB schema change

1. Add the DDL to the appropriate `*-schema.ts` (Postgres) or `*-mongo-schema.ts` (MongoDB) file. Use `IF NOT EXISTS` / idempotent index creation.
2. The schema is applied by `@yoizen/database` helpers (`applyMongoSchema`, `TenantConnectionManager.setSchema`) — no migration files needed.
