# Agent Admin Service

The configuration backend for the platform's conversational agents. Owns agent
definitions and versions, scheduled jobs, config files, skills, MCP servers,
system variables, knowledge bases (RAG) and structured knowledge bases (SKB),
all per tenant. Publishes NATS events so the runtime picks up changes, and
consumes two of its own events to run the long ingestion pipelines.

## Quick Start

```bash
bun install
bun run --cwd services/agent-admin-service start:dev
```

Requires: NATS, Redis, and the per-tenant store for the active engine.

## api / worker split

One image, two roles, selected by `SERVICE_MODE` (`src/main.ts:13-20`,
`bootstrapSplitService`). The two ingestion workers refuse to start unless
`SERVICE_MODE === "worker"` — note this is a literal env check, NOT the
`isWorkerMode()` helper other services use
(`src/modules/knowledge-bases/ingestion-worker.service.ts:76-78`,
`src/modules/structured-kb/skb-ingestion-worker.service.ts:84-86`).

## HTTP contracts

All `/admin/*` routes take the tenant header `x-yoizen-tenant`. Modules
registered in `src/app.module.ts:21-37`.

| Base path | Routes | Controller |
|---|---|---|
| `/admin/agents` | `GET /`, `GET /memory-proposals`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/publish`, `POST /:id/unpublish`, `POST /:id/revert`, `GET /:id/versions`, `POST /:id/versions/:versionId/rollback`, `DELETE /:id/versions/:versionId`, `PATCH /:id/tools`, `PATCH /:id/mcp-servers`, `PATCH /:id/mcp-tools`, `PATCH /:id/tool-descriptions`, `POST /memory-proposals/:id/approve`, `POST /memory-proposals/:id/reject` | `src/modules/agents/agents.controller.ts:38-269` |
| `/admin/jobs` | `GET /`, `GET /executions`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/enable`, `POST /:id/disable`, `POST /:id/run`, `POST /:id/trigger` | `src/modules/jobs/jobs.controller.ts:27-170` |
| `/admin/config-files` | `GET /`, `GET /file` (by `path` query), `PUT /` (create-or-update, bumps version), `POST /deploy` | `src/modules/config-files/config-files.controller.ts:23-83` |
| `/admin/knowledge-bases` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | `src/modules/knowledge-bases/knowledge-bases.controller.ts:21-60` |
| `/admin/knowledge-bases/:kbId/documents` | `GET /`, `GET /:id`, `GET /:id/chunks`, `PUT /:docId/chunks/:chunkId`, `POST /upload`, `POST /upload-file`, `POST /:id/reingest`, `DELETE /:id` | `src/modules/knowledge-bases/documents.controller.ts:24-168` |
| `/admin/structured-kb/containers` | `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/files` | `src/modules/structured-kb/containers.controller.ts:35-96` |
| `/admin/structured-kb` | `POST /containers/:id/query` | `src/modules/structured-kb/structured-kb.controller.ts:9-20` |
| `/admin/mcp-servers` | `GET /`, `POST /usage-events`, `GET /:id`, `GET /:id/tools`, `GET /:id/usage`, `POST /:id/test`, `POST /`, `PATCH /:id`, `DELETE /:id` | `src/modules/mcp-servers/mcp-servers.controller.ts:31-146` — `POST /:id/test` is declared BEFORE `GET /:id` on purpose, to avoid route shadowing (`:104-108`) |
| `/admin/skills` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | `src/modules/skills/skills.controller.ts:18-60` |
| `/admin/system-variables` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` | `src/modules/system-variables/system-variables.controller.ts:18-54` |
| `/admin/memories` | `GET /proposals`, `POST /proposals/:id/approve`, `POST /proposals/:id/reject` | `src/modules/memories/memories.controller.ts:26-64` |
| `/admin/adapters` | `GET /`, `GET /:adapterId` — read-only proxy to connector-admin | `src/modules/adapters/adapters.controller.ts:7-23` |
| `/admin/templates` | `GET /` — served from `data/templates.yaml` (`src/config.ts:56-58`) | `src/modules/templates/templates.controller.ts:5-14` |
| `/admin/runtime` | `GET /status` | `src/modules/runtime/runtime.controller.ts:15-27` |
| `/health` | `GET /health` | `src/modules/health/health.controller.ts:30-53` |

`GET /health` returns `IPlatformHealthResponse` — `{ status, timestamp, checks:
{ database } }` — and answers **503** with the same body when the first tenant
pool fails to probe (`health.controller.ts:38-52`). It takes no tenant header by
design, so Knative can probe it before routing.

## NATS contracts

### Published

Subjects are built from `AGENT_ADMIN_SUBJECT_PREFIX =
"evt.{tenant}.agent-admin-service.automation.platform.internal"`
(`packages/shared/src/constants.ts:119-120`), with `{tenant}` substituted by
`buildPlatformSubject` (`constants.ts:146-151`, called at
`src/providers/nats.provider.ts:355`).

| Subject suffix | Publisher method | Constant |
|---|---|---|
| `.agent_published.v1` | `publishAgentPublished` (`nats.provider.ts:404-442`) | `constants.ts:129` |
| `.agent_unpublished.v1` | `publishAgentUnpublished` (`nats.provider.ts:444-468`) | `constants.ts:130` |
| `.config_sync.v1` | `publishRuntimeConfigSync` (`nats.provider.ts:470-494`) | `constants.ts:122` |
| `.job_trigger.v1` | `publishJobTrigger` (`nats.provider.ts:496-524`) | `constants.ts:124` |
| `.document_ingestion.v1` | `publishDocumentIngestion` (`nats.provider.ts:526-555`) | `constants.ts:132` |
| `.skb_file_ingestion.v1` | `publishSkbFileIngestion` (`nats.provider.ts:564-593`) | `constants.ts:133` |
| `.skill_changed.v1` | `publishSkillChanged` (`nats.provider.ts:595-620`) | declared locally at `nats.provider.ts:70` — the only one of the seven NOT in `@yoizen/shared` |

The NATS connection is lazy: it is established on the first publish so the HTTP
server starts even when NATS is down (`nats.provider.ts:88-91`).

### Consumed

Two durable consumers, both reconciling tenant streams matching `/^INGRESS-/`
via `MultiTenantConsumerManager`, both cross-tenant by subject filter (the
stream itself is the tenant boundary):

| Durable | Filter subject | `ackWaitMs` |
|---|---|---|
| `ingestion-worker` (`ingestion-worker.service.ts:28`) | `evt.*.agent-admin-service.automation.platform.internal.document_ingestion.v1` (`:38-39`) | `300000` — 5 min, large docs (`:90`) |
| `skb-ingestion-worker` (`skb-ingestion-worker.service.ts:30`) | `evt.*.agent-admin-service.automation.platform.internal.skb_file_ingestion.v1` (`:38-39`) | `300000` — 5 min, large files (`:97`) |

So the service is a publisher **and** a consumer: the admin API publishes an
ingestion event, the worker pod consumes it and does the slow embedding/parsing
work off the request path.

## Storage

`DB_ENGINE` selects Postgres or Mongo; `ProvidersModule` binds one connection
manager class from that single value (`src/providers/providers.module.ts:24-58`).
Tenancy is the database, not a column: the Postgres manager runs in
`SharedTenantDatabaseMode.PerTenantDatabase`
(`src/providers/tenant-connection-manager.postgres.ts:14-17`).

Schema is created lazily per tenant by `initAgentAdminTenantSchema`
(`src/providers/schema-initializer.ts`, wired at
`tenant-connection-manager.postgres.ts:17`). Tables it declares:

| Group | Tables (line in `schema-initializer.ts`) |
|---|---|
| Agents | `agents` (`:144`), `agent_versions` (`:415`) |
| Jobs | `jobs` (`:179`), `job_executions` (`:195`) |
| Config | `config_files` (`:210`), `system_variables` (`:261`), `credentials` (`:166`) |
| Skills / MCP | `skills` (`:222`), `mcp_servers` (`:240`), `mcp_call_events` (`:460`) |
| Knowledge bases | `knowledge_bases` (`:278`), `documents` (`:294`), `document_chunks` (`:316`), `document_chunks_embedding` (`:331`, `vector(1536)`) |
| Structured KB | `skb_containers` (`:6`), `skb_files` (`:26`), `skb_schemas` (`:49`), `skb_rows` (`:65`), `skb_query_history` (`:115`) |

Note the SKB and knowledge-base tables carry an explicit `tenant_id` column
(e.g. `schema-initializer.ts:8`, `:382`) even though they already live in a
per-tenant database — belt-and-braces, not a shared-table design.

## Environment Variables

Everything in `src/config.ts` plus the LLM/embedding fallbacks.

| Variable | Default | Description |
|---|---|---|
| `SERVICE_MODE` | *(unset → api behaviour)* | Only `worker` starts the two ingestion consumers (`ingestion-worker.service.ts:76`, `skb-ingestion-worker.service.ts:84`) |
| `PORT` | `3000` | HTTP port (`src/config.ts:22-24`) |
| `DB_ENGINE` | `postgres` | Storage engine: `postgres` or `mongo`; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`, read at `src/config.ts:25-27`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name, feeds in-cluster service URLs (`src/config.ts:28-30`) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL (`src/config.ts:53-55`) |
| `CONNECTOR_ADMIN_URL` | `http://connector-admin-api:3000` | connector-admin base URL for the adapters proxy. `ADAPTER_SERVICE_URL` is still read as a fallback but is legacy — `CONNECTOR_ADMIN_URL` wins (`src/config.ts:34-40`) |
| `VALIDATE_ADAPTER_REFS` | `true` | Any value other than the literal `"false"` keeps validation ON (`src/config.ts:31-33`) |
| `AGENT_MEMORY_SERVICE_URL` | `platformServiceUrl("agent-memory-service", env)` | agent-memory-service base URL (`src/config.ts:41-46`) |
| `AGENT_MEMORY_SERVICE_TIMEOUT_MS` | `8000` | Timeout for memory-service calls (`src/config.ts:47-52`) |
| `PLATFORM_CHAT_REQUEST_TIMEOUT_MS` | `30000` | Chat request timeout (`src/config.ts:59-64`) |
| `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` | *(off)* | Feature flag; enabled ONLY on the literal string `"true"` (`src/config.ts:65-67`) |
| `MCP_INTERNAL_SCOPE_ENABLED` | *(off)* | Admin opt-in that lets an MCP server register with `scope: "internal"`, relaxing the SSRF guard's localhost/RFC1918 checks. Enabled ONLY on `"true"` (`src/config.ts:68-76`) |
| `OPENAI_API_KEY` | *(none)* | Deployment-wide fallback used when a knowledge base / SKB container has no provider connector configured; document ingestion throws without it (`src/modules/knowledge-bases/documents.service.ts:510-515`, `src/modules/structured-kb/skb-llm.config.ts:84-85`) |
| `OPENAI_BASE_URL` | *(none)* | Base URL paired with the key fallback (`skb-llm.config.ts:39-40`) |
| `SKB_LLM_PROVIDER` | `openai` | Provider for SKB schema analysis / NL→SQL (`skb-llm.config.ts:17-19`) |
| `SKB_LLM_MODEL_ID` | `gpt-4o` | Model for the same (`skb-llm.config.ts:20-23`) |

Credential resolution order for SKB/KB LLM calls: the container's
`provider_config` connector first, then the env fallback; a connector failure
degrades to the env fallback with a warning rather than failing the request
(`skb-llm.config.ts:36-42`).

## Testing

The suites need `test/preload-env.ts`, so run them through the package scripts,
not bare `bun test` (`package.json:9-12`):

```bash
cd services/agent-admin-service
bun run test:unit
bun run test:integration
bun run test:e2e
```

## Deploy

| Resource | Kind | Scale |
|---|---|---|
| `agent-admin-service` | Knative Service (`knative/services/base/agent-admin-service.yaml`) | min 1 / max 3, concurrency target 50 (`:15-17`) |
| `agent-admin-service-worker` | Deployment (`knative/services/base/agent-admin-service-worker.yaml`) | fixed `replicas: 1` (`:24`), same image (`:42`) |

```bash
./rebuild-redeploy.sh agent-admin-service dev
```
