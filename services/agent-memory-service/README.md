# Agent Memory Service

Per-tenant long-term memory for agents. Agents propose memories through a tool
endpoint; humans review and approve them through an admin endpoint; approved
memories are retrievable by scope, kind, session or full-text search. Every
lifecycle transition is published as a NATS event.

Postgres only — this service does **not** call `resolveStorageEngine()`, so
there is no `DB_ENGINE` switch: `ProvidersModule` binds the Postgres connection
manager unconditionally (`src/providers/providers.module.ts:12-25`).

## Quick Start

```bash
bun install
bun run --cwd services/agent-memory-service start:dev
```

Requires: per-tenant Postgres, and NATS for the publish path.

## Domain model

Three enums drive everything (`src/modules/memory/domain/enums.ts`):

| Enum | Values |
|---|---|
| `MemoryScope` | `SESSION`, `USER`, `TENANT` (`:1-5`) |
| `MemoryKind` | `PREFERENCE`, `FACT`, `NOTICE`, `INCIDENT`, `PROMO` (`:7-13`) |
| `MemoryStatus` | `PROPOSED`, `ACTIVE`, `REJECTED`, `ARCHIVED` (`:15-20`) |

**Approval is scope-driven** (`resolveInitialStatus`,
`src/modules/memory/services/memory.service.ts:59-70`): a `TENANT`-scoped memory
starts as `PROPOSED` and needs a human; `SESSION`/`USER` memories start `ACTIVE`
immediately.

**Deduplication is kind-driven** (`MERGE_STRATEGY_BY_KIND`,
`memory.service.ts:15-21`): `PREFERENCE`/`FACT`/`NOTICE` use `REPLACE` —
proposing again with the same `topicKey` and scope updates the existing row and
bumps `metadata.revisionCount` instead of inserting
(`memory.service.ts:136-165`). `INCIDENT`/`PROMO` use `KEEP_BOTH` and always
insert.

## HTTP contracts

Both controllers are guarded by `TenantGuard`, and the tenant comes from the
`@TenantId()` decorator (`@yoizen/database`).

### Agent tool surface — `/tools`

`src/modules/memory/controllers/agent-tools.controller.ts:17-61`

| Method | Path | Notes |
|---|---|---|
| `POST` | `/tools/propose-memory` | `ProposeMemoryDto`; responds `201` (`:22-23`). Called WITHOUT a publisher, so this path does not emit `memory_proposed` (`:28-38`) |
| `GET` | `/tools/memories` | `MemoryQueryDto` filters (`:41-47`) |
| `GET` | `/tools/memories/:id/timeline` | Session/user timeline; only `sessionId`, `userId`, `limit`, `offset` are forwarded (`:49-61`) |

### Admin surface — `/admin/memories`

`src/modules/memory/controllers/admin-memories.controller.ts:23-97`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/memories` | List with `MemoryQueryDto` (`:31-37`) |
| `GET` | `/admin/memories/proposals` | Same list forced to `status = PROPOSED` (`:39-48`); declared before `:id` so it is not shadowed |
| `GET` | `/admin/memories/:id` | (`:50-53`) |
| `POST` | `/admin/memories` | `201`; passes the publisher, so this path DOES emit `memory_proposed` (`:55-72`) |
| `PATCH` | `/admin/memories/:id` | `UpdateMemoryDto` (`:74-81`) |
| `PATCH` | `/admin/memories/:id/approve` | (`:83-86`) |
| `PATCH` | `/admin/memories/:id/reject` | (`:88-91`) |
| `DELETE` | `/admin/memories/:id` | `204 No Content` (`:93-97`) |

### Health

`GET /health` returns `{ status, timestamp, checks: { database } }` and answers
**503** with the same body when the first tenant pool fails to probe
(`src/modules/health/health.controller.ts:15-38`). No tenant header required.

## NATS published

Subjects are built from `AGENT_MEMORY_SUBJECT_PREFIX =
"evt.{tenant}.agent-memory-service.agent-memory.platform.internal"`
(`packages/shared/src/constants.ts:119-127` — moved out of this service on
2026-07-31 by envelope-drift T08, so every internal producer's subject
constants now live together), with `{tenant}` substituted by
`buildPlatformSubject` (`src/providers/nats.provider.ts:322`).

The envelope body reports `domain: AGENT_MEMORY_DOMAIN` (`agent-memory`) —
the same value as the subject's domain token. It previously carried
agent-admin's `PLATFORM_DOMAIN` (`automation`), contradicting its own subject.

| Subject | Publisher | Constant |
|---|---|---|
| `.memory_proposed.v1` | `publishMemoryProposed` (`nats.provider.ts:371-397`) | `AGENT_MEMORY_PROPOSED` (`packages/shared/src/constants.ts:124`) |
| `.memory_published.v1` | `publishMemoryApproved` (`nats.provider.ts:399-423`) | `AGENT_MEMORY_PUBLISHED` (`packages/shared/src/constants.ts:125`) |
| `.memory_rejected.v1` | `publishMemoryRejected` (`nats.provider.ts:425-448`) | `AGENT_MEMORY_REJECTED` (`packages/shared/src/constants.ts:126`) |
| `.memory_expired.v1` | `publishMemoryExpired` (`nats.provider.ts:450-472`) | `AGENT_MEMORY_EXPIRED` (`packages/shared/src/constants.ts:127`) |

`memory_proposed`'s envelope id is persisted into `metadata.proposedEventId` and
becomes the causation anchor for the later `memory_published` /
`memory_rejected` events (`memory.service.ts:72-77`). A publish failure leaves
the memory unchanged — the chain anchor is best-effort, never a write barrier
(`memory.service.ts:76-77`).

This service consumes nothing — there are no durable consumers in `src/`.

## Storage

One database per tenant (`SharedTenantDatabaseMode.PerTenantDatabase`,
`src/providers/tenant-connection-manager.postgres.ts:13-15`). A single table,
declared in `src/schema/memory-schema.sql`:

```sql
memories (id, tenant_id, user_id, session_id, project, scope, kind, status,
          title, content, metadata JSONB, topic_key, expires_at,
          created_at, updated_at, search_vector tsvector GENERATED)
```

with `CHECK` constraints on `scope` (`:7`), `kind` (`:8`) and `status` (`:10`),
and eight indexes (`:24-31`) including a GIN index on `search_vector`.

`search_vector` is a STORED generated column combining `title` (weight A) and
`content` (weight B) (`memory-schema.sql:18-21`).

### Schema initializer and its two idempotent migrations

`initAgentMemoryTenantSchema` (`src/providers/schema-initializer.ts:20-87`) runs
the DDL inside one transaction and then self-heals older tenants:

1. **Status constraint** — if the existing `memories_status_check` definition
   does not mention `ARCHIVED`, it drops the constraint, rewrites
   `PUBLISHED → ACTIVE` and `EXPIRED → ARCHIVED`, then re-adds the 4-value
   constraint (`:34-56`). The drop happens FIRST so the data updates are not
   rejected by the old CHECK.
2. **FTS language** — a STORED generated column cannot be altered in place, so
   when `search_vector`'s expression does not reference the configured language
   the column and its index are dropped and re-created (`:58-84`).

The language is injected by textual substitution of `__FTS_LANGUAGE__`
(`schema-initializer.ts:11-18`), which is why it is validated against
`/^[a-z_]+$/` in BOTH the config getter and `buildDdl` — the value reaches
`sql.unsafe()`, so the regex is the injection guard, not a style check
(`src/config.ts:7`, `:16-24`; `schema-initializer.ts:12-16`).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`src/config.ts:10-12`) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL (`src/config.ts:13-15`) |
| `MEMORY_FTS_LANGUAGE` | `spanish` | Postgres text-search configuration for `search_vector`. Lowercased and trimmed; a value not matching `/^[a-z_]+$/` throws at startup (`src/config.ts:16-24`). Changing it triggers migration 2 above on the next tenant schema init |

There is no `DB_ENGINE` here — see the note at the top.

## Testing

The suites need `test/preload-env.ts`, so run them through the package scripts,
not bare `bun test` (`package.json:9-12`):

```bash
cd services/agent-memory-service
bun run test:unit
bun run test:integration
bun run test:e2e
```

## Deploy

Knative Service, min 1 / max 3, concurrency target 50
(`knative/services/base/agent-memory-service.yaml:15-17`), image
`dev.local/agent-memory-service:local` (`:22`).

```bash
./rebuild-redeploy.sh agent-memory-service dev
```
