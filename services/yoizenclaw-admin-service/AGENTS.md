# AGENTS.md - YoizenClaw Admin Service

## Project Overview

The YoizenClaw Admin Service manages the administrative configuration for conversational agents, credentials, scheduled jobs, and config files in a multi-tenant architecture. It serves as the configuration backend for the YoizenClaw runtime, publishing events via NATS JetStream when configuration changes occur.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | Per-tenant PostgreSQL via `postgres` (postgres.js) |
| Messaging | NATS JetStream (publisher only) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |
| Observability | `@yoizen/observability` (workspace: `packages/observability/`) |

## Repository Structure

```
src/
├── main.ts                                     # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                               # @Global() root module with providers and feature modules
├── providers/
│   ├── tenant-connection-manager.ts            # Per-tenant PostgreSQL pools (Map<string, Sql>)
│   └── nats.provider.ts                        # NATS_CONNECTION, JETSTREAM_MANAGER, NatsPublisher
└── modules/
    ├── agents/
    │   ├── agents.module.ts
    │   ├── agents.controller.ts                # CRUD + publish/unpublish endpoints
    │   ├── agents.service.ts                   # Business logic, NATS event publishing
    │   ├── agents.repository.ts                # SQL queries postgres.js
    │   └── agents.dto.ts                       # CreateAgentDto, UpdateAgentDto (class-validator)
    ├── credentials/
    │   ├── credentials.module.ts
    │   ├── credentials.controller.ts           # CRUD + rotate endpoints
    │   ├── credentials.service.ts              # Business logic (encryption placeholder)
    │   ├── credentials.repository.ts           # SQL queries
    │   └── credentials.dto.ts                  # CreateCredentialDto, UpdateCredentialDto
    ├── jobs/
    │   ├── jobs.module.ts
    │   ├── jobs.controller.ts                  # CRUD + enable/disable/run/trigger endpoints
    │   ├── jobs.service.ts                     # Business logic, schedule calculation
    │   ├── jobs.repository.ts                  # SQL queries
    │   └── jobs.dto.ts                         # CreateJobDto, UpdateJobDto, TriggerJobDto
    ├── config-files/
    │   ├── config-files.module.ts
    │   ├── config-files.controller.ts          # GET/PUT + deploy endpoint
    │   ├── config-files.service.ts             # Business logic, version increment
    │   ├── config-files.repository.ts          # SQL queries
    │   └── config-files.dto.ts                 # UpdateConfigFileDto, DeployConfigFilesDto
    ├── runtime/
    │   ├── runtime.module.ts
    │   ├── runtime.controller.ts               # GET /runtime/status
    │   └── runtime.service.ts                  # Runtime connection status
    └── health/
        ├── health.module.ts
        └── health.controller.ts                # GET /health

test/
├── unit/                                       # Unit tests for services, repositories
└── integration/                                # Integration tests with DB and NATS
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.module.ts` | @Global() module exporting all providers (TenantConnectionManager, NatsPublisher) |
| `src/providers/tenant-connection-manager.ts` | Lazy pool creation per tenant; connects to `postgres.{tenantId}-{env}-ns.svc.cluster.local` |
| `src/providers/nats.provider.ts` | NATS connection, JetStream manager, NatsPublisher with event methods |
| `src/modules/agents/agents.service.ts` | Agent CRUD + publish/unpublish logic with NATS events |
| `src/modules/credentials/credentials.service.ts` | Credential CRUD with placeholder encryption |
| `src/modules/jobs/jobs.service.ts` | Job CRUD + scheduling + manual trigger |
| `src/modules/config-files/config-files.service.ts` | Config file management + deploy sync |
| `src/modules/runtime/runtime.service.ts` | Runtime status and metrics |
| `src/modules/health/health.controller.ts` | Health checks for PostgreSQL connectivity |

## API Endpoints

### Agents Module (`/admin/agents`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/admin/agents` | List all agents | `x-yoizen-tenant` | - | `status`, `is_active`, `limit`, `offset` |
| GET | `/admin/agents/:id` | Get agent by ID | `x-yoizen-tenant` | - | - |
| POST | `/admin/agents` | Create new agent | `x-yoizen-tenant` | `CreateAgentDto` | - |
| PUT | `/admin/agents/:id` | Update agent | `x-yoizen-tenant` | `UpdateAgentDto` | - |
| DELETE | `/admin/agents/:id` | Delete (soft) agent | `x-yoizen-tenant` | - | - |
| POST | `/admin/agents/:id/publish` | Publish agent | `x-yoizen-tenant` | - | - |
| POST | `/admin/agents/:id/unpublish` | Unpublish agent | `x-yoizen-tenant` | - | - |

### Credentials Module (`/admin/credentials`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/admin/credentials` | List all credentials | `x-yoizen-tenant` | - | `type`, `is_active`, `limit`, `offset` |
| GET | `/admin/credentials/:id` | Get credential by ID | `x-yoizen-tenant` | - | - |
| POST | `/admin/credentials` | Create new credential | `x-yoizen-tenant` | `CreateCredentialDto` | - |
| PUT | `/admin/credentials/:id` | Update credential | `x-yoizen-tenant` | `UpdateCredentialDto` | - |
| DELETE | `/admin/credentials/:id` | Delete credential | `x-yoizen-tenant` | - | - |
| POST | `/admin/credentials/:id/rotate` | Rotate credential | `x-yoizen-tenant` | `{ value: string }` | - |

### Channels Module (`/admin/channels`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/admin/channels` | List all channels | `x-yoizen-tenant` | - | `type`, `is_active`, `limit`, `offset` |
| GET | `/admin/channels/:id` | Get channel by ID | `x-yoizen-tenant` | - | - |
| POST | `/admin/channels` | Create new channel | `x-yoizen-tenant` | `CreateChannelDto` | - |
| PUT | `/admin/channels/:id` | Update channel | `x-yoizen-tenant` | `UpdateChannelDto` | - |
| DELETE | `/admin/channels/:id` | Delete (soft) channel | `x-yoizen-tenant` | - | - |

### Jobs Module (`/admin/jobs`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/admin/jobs` | List all jobs | `x-yoizen-tenant` | - | `is_active`, `agent_id`, `limit`, `offset` |
| GET | `/admin/jobs/:id` | Get job by ID | `x-yoizen-tenant` | - | - |
| POST | `/admin/jobs` | Create new job | `x-yoizen-tenant` | `CreateJobDto` | - |
| PUT | `/admin/jobs/:id` | Update job | `x-yoizen-tenant` | `UpdateJobDto` | - |
| DELETE | `/admin/jobs/:id` | Delete job | `x-yoizen-tenant` | - | - |
| POST | `/admin/jobs/:id/enable` | Enable job | `x-yoizen-tenant` | - | - |
| POST | `/admin/jobs/:id/disable` | Disable job | `x-yoizen-tenant` | - | - |
| POST | `/admin/jobs/:id/trigger` | Trigger job manually | `x-yoizen-tenant` | `TriggerJobDto` (optional) | - |

### Config Files Module (`/admin/config-files`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/admin/config-files` | List all config files | `x-yoizen-tenant` | - | `format`, `is_active`, `limit`, `offset` |
| GET | `/admin/config-files/:id` | Get config file by ID | `x-yoizen-tenant` | - | - |
| PUT | `/admin/config-files/:id` | Update config file | `x-yoizen-tenant` | `UpdateConfigFileDto` | - |
| POST | `/admin/config-files/deploy` | Deploy config files to runtime | `x-yoizen-tenant` | `DeployConfigFilesDto` | - |

### Runtime Module (`/admin/runtime`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/admin/runtime/status` | Get runtime status | `x-yoizen-tenant` | - | - |

**Response:**
```json
{
  "configured": true,
  "connected_runtimes": ["runtime-{tenantId}-primary"],
  "last_sync_at": "2026-03-30T12:00:00Z"
}
```

### Health Module (`/health`)

| Method | Endpoint | Description | Request Headers | Request Body | Query Params |
|--------|----------|-------------|-----------------|--------------|--------------|
| GET | `/health` | Health check | - | - | - |

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-30T12:00:00Z",
  "checks": {
    "database": "up"
  }
}
```

## Database Schema

### agents

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `name` | VARCHAR(255) | NOT NULL | Agent name |
| `description` | TEXT | | Optional description |
| `system_prompt` | TEXT | NOT NULL | System prompt for LLM |
| `model_config` | JSONB | NOT NULL DEFAULT '{}' | Model configuration |
| `tools` | JSONB | DEFAULT '[]' | Available tools |
| `channels` | JSONB | DEFAULT '[]' | Associated channels |
| `status` | VARCHAR(50) | DEFAULT 'draft' | Status: draft, published, archived |
| `is_active` | BOOLEAN | DEFAULT true | Soft delete flag |
| `published_at` | TIMESTAMPTZ | | Publication timestamp |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

**Indexes:**
- `idx_agents_status ON agents(status)`
- `idx_agents_created_at ON agents(created_at DESC)`

### credentials

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `name` | VARCHAR(255) | NOT NULL | Credential name |
| `type` | VARCHAR(50) | NOT NULL CHECK (type IN ('api_key', 'oauth', 'basic', 'custom')) | Credential type |
| `value` | TEXT | NOT NULL | Credential value (⚠️ stored in plaintext) |
| `is_encrypted` | BOOLEAN | DEFAULT false | Encryption status |
| `metadata` | JSONB | DEFAULT '{}' | Additional metadata |
| `expires_at` | TIMESTAMPTZ | | Expiration date |
| `is_active` | BOOLEAN | DEFAULT true | Soft delete flag |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

### channels

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `name` | VARCHAR(255) | NOT NULL | Channel name |
| `type` | VARCHAR(50) | NOT NULL CHECK (type IN ('webchat', 'whatsapp', 'telegram', 'slack', 'custom')) | Channel type |
| `config` | JSONB | NOT NULL DEFAULT '{}' | Channel configuration |
| `webhook_url` | TEXT | | Generated webhook URL |
| `is_active` | BOOLEAN | DEFAULT true | Soft delete flag |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

**Indexes:**
- `idx_channels_type ON channels(type)`

### jobs

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `name` | VARCHAR(255) | NOT NULL | Job name |
| `agent_id` | UUID | NOT NULL REFERENCES agents(id) | Associated agent |
| `schedule` | VARCHAR(255) | NOT NULL | Cron expression |
| `payload` | JSONB | DEFAULT '{}' | Job payload |
| `is_active` | BOOLEAN | DEFAULT true | Enable/disable flag |
| `last_run` | TIMESTAMPTZ | | Last execution timestamp |
| `next_run` | TIMESTAMPTZ | | Next scheduled execution |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

**Indexes:**
- `idx_jobs_agent_id ON jobs(agent_id)`
- `idx_jobs_active ON jobs(is_active) WHERE is_active = true`

### job_executions

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `job_id` | UUID | NOT NULL REFERENCES jobs(id) | Associated job |
| `status` | VARCHAR(50) | NOT NULL | Execution status |
| `event_payload` | JSONB | DEFAULT '{}' | Trigger payload |
| `result` | JSONB | | Execution result |
| `logs` | TEXT[] | | Execution logs |
| `error_message` | TEXT | | Error message if failed |
| `retry_count` | INTEGER | DEFAULT 0 | Number of retries |
| `triggered_by` | VARCHAR(50) | | Trigger source |
| `started_at` | TIMESTAMPTZ | | Execution start |
| `finished_at` | TIMESTAMPTZ | | Execution end |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |

### config_files

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `name` | VARCHAR(255) | NOT NULL | File name |
| `path` | TEXT | NOT NULL UNIQUE | File path |
| `content` | TEXT | NOT NULL | File content |
| `format` | VARCHAR(10) | NOT NULL CHECK (format IN ('yaml', 'json')) | File format |
| `version` | INTEGER | DEFAULT 1 | Version number |
| `is_active` | BOOLEAN | DEFAULT true | Soft delete flag |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update timestamp |

## NATS Events

### Events Published

| Event | Subject | Trigger | Payload |
|-------|---------|---------|---------|
| `agent.published` | `events.agent.published` | POST /admin/agents/:id/publish | `{ agentId, name, publishedAt, status }` |
| `agent.unpublished` | `events.agent.unpublished` | POST /admin/agents/:id/unpublish | `{ agentId, name, unpublishedAt, status }` |
| `credential.rotated` | `events.credential.rotated` | PUT /admin/credentials/:id (with new value) | `{ credentialId, type, rotatedAt }` |
| `runtime.config.sync` | `events.runtime.config.sync` | POST /admin/config-files/deploy | `{ files, deletePaths, syncedAt }` |
| `runtime.jobs.sync` | `events.runtime.jobs.sync` | Bulk job sync | `{ jobs, syncedAt }` |
| `job.trigger` | `events.job.trigger` | POST /admin/jobs/:id/trigger | `{ jobId, executionId, eventPayload, triggeredAt }` |

### Event Envelope Structure

All events are wrapped in a standard envelope:

```typescript
interface EventEnvelope {
  id: string;           // UUID of the event
  type: string;         // Event type (e.g., 'agent.published')
  payload: object;      // Event-specific payload
  metadata: {
    tenantId: string;   // Tenant identifier
    source: string;     // Service that emitted the event
    receivedAt: number; // Timestamp (epoch ms)
  };
}
```

### Stream Configuration

| Property | Value | Description |
|----------|-------|-------------|
| Stream Name | `EVENTS` | NATS JetStream name |
| Retention | Limits | Message retention policy |
| Max Age | 7 days | Maximum message age |
| Max Bytes | 512 MB | Maximum stream size |
| Subjects | `events.*` | Subject pattern for all events |

## Architecture Highlights

### Module Dependency Graph

```
AppModule (@Global)
├── TenantConnectionManager (Map<string, Sql>)
├── NatsPublisher (publishes to EVENTS stream)
├── AgentsModule
│   ├── AgentsController (HTTP endpoints)
│   ├── AgentsService (business logic)
│   └── AgentsRepository (SQL queries)
├── CredentialsModule
├── JobsModule
├── ConfigFilesModule
├── RuntimeModule
└── HealthModule
```

### Data Flow

1. **Create Agent**: `POST /admin/agents` → AgentsController → AgentsService → AgentsRepository → PostgreSQL → NatsPublisher emits `agent.published` (when published)
2. **Multi-tenancy**: Each request includes `x-yoizen-tenant` header → TenantConnectionManager routes to tenant's PostgreSQL instance
3. **Events**: Configuration changes trigger NATS events for runtime sync (agent.published, credential.rotated, runtime.config.sync, job.trigger)
4. **Lazy Connection**: First request to a tenant creates connection pool; subsequent requests reuse pool
5. **Schema Initialization**: `ensureSchema()` creates tables on first tenant access

### Multi-Tenancy

- **Tenant Header**: `x-yoizen-tenant` (from `@yoizen/shared`)
- **Connection Pool**: `Map<string, Sql>` keyed by tenant ID
- **PostgreSQL Host**: `postgres.{tenantId}-{env}-ns.svc.cluster.local`
- **Database**: `yoizen` per tenant
- **Schema**: Auto-created on first access via `ensureSchema()`

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| Per-tenant PostgreSQL | TCP | Outbound | Persist agents, credentials, channels, jobs, config files |
| NATS JetStream (EVENTS) | NATS | Outbound | Publish configuration change events |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |
| `JETSTREAM_MANAGER` | `JetStreamManager` | `nats.provider.ts` |
| `JETSTREAM_CLIENT` | `JetStreamClient` | `nats.provider.ts` |
| TenantConnectionManager | Injectable class | `tenant-connection-manager.ts` |
| NatsPublisher | Injectable class | `nats.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_PORT` | `5432` | PostgreSQL port (per-tenant) |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | PostgreSQL password |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name (dev, qa, staging, production) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `WEBHOOK_BASE_URL` | `https://api.yoizen.io` | Base URL for webhook generation |

### Knative

- Image: `dev.local/yoizenclaw-admin-service:local`
- Autoscaling: min 1, max 3, target concurrency 50
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests |

## Code Style and Conventions

- **Global providers**: `AppModule` is `@Global()`, exporting `TenantConnectionManager` and `NatsPublisher`
- **Per-tenant pools**: `Map<string, Sql>` keyed by tenant ID, lazy creation on first request
- **Schema lazy init**: `ensureSchema()` runs once per tenant, creates tables and indexes
- **DTOs in same folder**: `agents.dto.ts` next to `agents.controller.ts` (no subfolders)
- **SQL crudo**: postgres.js with tagged templates (no ORM)
- **Validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`
- **NATS only publisher**: No consumers in this service (only publishes to EVENTS stream)
- **Security**: Never return credential `value` field in API responses (⚠️ TEMPORAL: stored in plaintext)
- **Lifecycle hooks**: `OnModuleDestroy` closes all connection pools

## Common Tasks

### Add a new endpoint

1. Create or update controller in `src/modules/<feature>/`
2. Add service method for business logic
3. Add repository method for SQL queries (if needed)
4. Update module in `src/app.module.ts` if new

### Run locally

```bash
bun install
bun run start:dev
```

Requires local NATS and PostgreSQL per tenant.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **NATS JetStream** | Publishes configuration change events to EVENTS stream |
| **Per-tenant PostgreSQL** | Persists agents, credentials, jobs, and config files |
| **api-gateway** | Upstream proxy (all admin endpoints proxied through gateway) |
| **tenant-service** | Provisions the per-tenant PostgreSQL instances |
| **YoizenClaw runtime** | Consumes NATS events for configuration sync |
| **`@yoizen/shared`** | Stream config, `EventEnvelope`, `TENANT_HEADER` |
| **`@yoizen/observability`** | Pino logging, OpenTelemetry tracing |

## Security Notes

⚠️ **IMPORTANT**: Credentials are currently stored in **plaintext** (`is_encrypted: false`). This is a temporary implementation for Phase 1. A follow-up change will implement proper encryption using AWS KMS or HashiCorp Vault.

- Never expose credential `value` in API responses
- All API requests require tenant header for multi-tenancy isolation
- Input validation via `class-validator` on all DTOs
- SQL injection prevention via postgres.js prepared statements

## Seed Data

The service automatically seeds default data when a new tenant's schema is initialized.

### Seed Files Location

```
data/
├── agents/
│   ├── agent-default.yaml              # Default general-purpose agent
│   └── agent-sales-assistant.yaml     # Sales assistant with tools
└── jobs.yaml                           # Default scheduled jobs
```

### Default Agents

**1. agent-default** (published)
- Basic helpful AI assistant
- Uses GPT-4o-mini
- No special tools or skills

**2. agent-sales-assistant** (draft)
- Sales qualification and demo booking
- Uses GPT-4o with full toolset:
  - `catalog`: Search product plans and pricing
  - `calendar`: Book demo meetings
  - `memory`: Store/retrieve conversation data
  - `communicate`: Send messages and handoffs

### Default Jobs

**1. job-metrics-snapshot**
- Runs every hour (interval:3600)
- Collects conversation metrics
- Associated with agent-default

**2. job-demo-notification**
- Manual trigger only
- For testing job execution from admin UI
- Associated with agent-sales-assistant

### Seed Execution

Seed runs automatically when:
1. First request arrives for a new tenant
2. `TenantConnectionManager.ensureSchema()` is called
3. Schema is created but empty

```typescript
// SeedService automatically called after schema creation
const result = await seedService.runSeed(tenantId);
// Returns: { agents: 2, jobs: 2 }
```

### Customizing Seed

To add new seed data:
1. Create agent YAML files in `data/agents/`
2. Add jobs to `data/jobs.yaml`
3. Restart service - seed runs on next tenant initialization

**Note**: Seed is idempotent. Running twice on same tenant updates existing records instead of creating duplicates.
