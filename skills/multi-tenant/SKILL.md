---
name: multi-tenant
description: >
  Multi-tenant patterns for THIS platform (platform-cluster): tenant resolution via
  `x-yoizen-tenant`, NestJS `TenantGuard` + `@TenantId()`, per-tenant-database isolation,
  and the dual Postgres/Mongo storage engine.
  Trigger: When working with multiple tenants, tenant resolution, tenant data isolation,
  or per-tenant database provisioning.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "tenant"
    - "multi-tenant"
    - "tenant resolution"
    - "tenant isolation"
    - "per-tenant database"
---

> **Normative source**: `AGENTS.md` → "Platform contracts" → Tenancy.
> This skill is advisory. Where this skill and AGENTS.md
> disagree, **AGENTS.md wins** and this file is the one that gets fixed.

## When to Use

- Adding a tenant-scoped HTTP endpoint to a NestJS service
- Resolving the tenant of an incoming request (hostname, header, query, JWT)
- Deciding where tenant-scoped data lives (per-tenant DB vs shared table)
- Working with `resolveStorageEngine()` dual Postgres/Mongo services
- Wiring webhook routes where the caller cannot send platform headers

---

## Critical Patterns

### 1. The tenancy contract

Two things carry the tenant, and only two:

1. **The `x-yoizen-tenant` header** — the constant is
   `TENANT_HEADER = "x-yoizen-tenant"` (`packages/shared/src/constants.ts`),
   exported from `@yoizen/shared` (`packages/shared/src/index.ts`). It is
   locked by a test: `packages/shared/src/__tests__/doc-locks.constants.test.ts`.
   Never hand-write the literal in service code — import the constant.
2. **A tenant-scoped JWT** — `JwtPayload.tenant_id`
   (`packages/shared/src/auth.interfaces.ts`) plus a `scope` of
   `tenant:<id>` (`services/api-gateway/src/constants.ts`,
   `services/auth-service/src/modules/token/token.service.ts`).

Runnable check:

```bash
rg -n 'TENANT_HEADER' packages/shared/src/constants.ts
cd packages/shared && bun test src/__tests__/doc-locks.constants.test.ts
```

Tenant ids are validated against `/^[a-zA-Z0-9-]{3,32}$/`
(`packages/shared/src/tenant.utils.ts`, exposed as `validateTenantId`,
`tenant.utils.ts`). `extractTenantId(headers)` does the
case-insensitive header lookup (`tenant.utils.ts`).

### 2. Tenant resolution chain (api-gateway)

The gateway resolves in a fixed order — **hostname → header → query** —
implemented in `services/api-gateway/src/utils/tenant-resolution.util.ts`:

```
Incoming request
     │
     ▼
  1. Hostname?  <env>.<tenant>.yplatform.com   (HOST_PATTERN, constants.ts)
     │ (no match)
     ▼
  2. Header?    x-yoizen-tenant: acme          (TENANT_HEADER)
     │ (absent)
     ▼
  3. Query?     ?tenant=acme
     │ (absent)
     ▼
  400 Bad Request — "Tenant context required."  (tenant.guard.ts)
```

| Source | When it applies | Shape |
|--------|-----------------|-------|
| Hostname | Browser/console traffic | `<env>.<tenant>.yplatform.com` (`services/api-gateway/src/constants.ts`) |
| Header | API clients, inter-service calls, CLI, tests | `x-yoizen-tenant: acme` |
| Query | Ad-hoc/manual calls | `?tenant=acme` |

There is **no** multi-source consistency/mismatch rule: the first source that
matches wins and the rest are never read (`tenant-resolution.util.ts`).
There is **no** fallback tenant: when no source matches, the gateway throws
`BadRequestException` (`services/api-gateway/src/guards/tenant.guard.ts`)
and the shared guard throws on a missing header
(`packages/database/src/tenant-guard.ts`). No service or package resolves
a fallback tenant from the environment — runnable check, which returns nothing:

```bash
rg -n '\bDEFAULT_TENANT\b' -g '!node_modules' services packages sdk
```

(Outside this file, the only `DEFAULT_TENANT` remaining in the repo is a shell
default for the `--tenant` flag of a reset script,
`scripts/reset/reset-tenant.sh` (`DEFAULT_TENANT`) — verify with
`rg -n '\bDEFAULT_TENANT\b' -g '!node_modules' -g '!skills' .`)

### 3. NestJS `TenantGuard` + `@TenantId()` — the only pattern

Repo style is binding here: "NestJS modules/services, class-validator DTOs,
`@TenantId()` decorator, `TenantGuard`" (`manual-loops/workflow-toggle.md`, "Repo style wins").
No service uses Express tenant middleware or the `jsonwebtoken` package; JWT
work uses **`jose`** (`services/api-gateway/src/modules/auth/jwt.service.ts`,
`services/auth-service/src/modules/token/token.service.ts`). Runnable check —
no service, package, or SDK code imports it, so this returns nothing:

```bash
rg -n 'jsonwebtoken' -g '!node_modules' services packages sdk
```

**Shared implementation** — `packages/database/src/tenant-guard.ts`, exported
from `@yoizen/database` (`packages/database/src/index.ts`). Services re-export
it rather than reimplementing:
`services/agent-admin-service/src/guards/tenant.guard.ts`,
`services/agent-admin-service/src/providers/tenant.decorator.ts`.

The guard validates the header and stores `request.tenantId`
(`packages/database/src/tenant-guard.ts`); the param decorator reads it
back (`tenant-guard.ts`).

**Real controller usage** — verbatim
`services/agent-admin-service/src/modules/memories/memories.controller.ts`
(imports) and `:26-43` (body):

```typescript
import { TenantGuard } from '../../guards/tenant.guard';
import { TenantId } from '../../providers/tenant.decorator';

@Controller('admin/memories')
@UseGuards(TenantGuard)
export class MemoriesController {
  constructor(private readonly service: MemoriesService) {}

  @Get('proposals')
  @HttpCode(HttpStatus.OK)
  async listProposals(
    @TenantId() tenantId: string,
    @Query() query: ListMemoryProposalsQueryDto,
  ): Promise<MemoryProposalListResponseDto> {
    return this.service.listProposals(
      tenantId,
      query.status,
      query.kind,
      query.limit,
    );
  }
```

**api-gateway is different**: its `TenantGuard` is a GLOBAL `APP_GUARD`
registered before `AuthGuard` (`services/api-gateway/src/app.module.ts`),
resolves from hostname/header/query, writes both `request.tenantId` and
`request.headers[TENANT_HEADER]` so downstream proxies forward the tenant
(`services/api-gateway/src/guards/tenant.guard.ts`). Routes that must not
require a tenant opt out with `@SkipTenant()`
(`services/api-gateway/src/decorators/skip-tenant.decorator.ts`).

### 4. Data isolation: the DB is the boundary

Default model (`AGENTS.md`, "Platform contracts" → Tenancy): **one database per tenant, no `tenant_id`
columns**.

- Postgres DB name `tenant_<id>`, role `tenant_<id>_app`
  (`packages/shared/src/tenant-database-tier.ts`).
- `getConnection(tenantId)` picks a per-tenant target by tier and opens/reuses
  one pool per tenant: `buildSharedTarget()` resolves the database name to
  `tenantPostgresDatabaseName(tenantId)` and the user to
  `tenantPostgresRoleName(tenantId)` unless the mode is `SingleDatabase`
  (`packages/database/src/tenant-connection-manager.ts`);
  `buildDedicatedTarget()` points at the tenant's own namespace host
  (`:454-466`); `getOrCreatePool()` keys the pool by that target and calls
  `postgres({...})` (`:501-509`). Dispatch: `getConnection()` at `:435-442`.
  The mode enum itself is `SharedTenantDatabaseMode`
  (`tenant-connection-manager.ts`). The Mongo manager reuses the same DB
  name (`packages/database/src/tenant-mongo-connection-manager.ts`).
- Reference DDL: `TENANT_AUTH_SCHEMA_SQL`
  (`packages/shared/src/tenant-auth-schema.ts`). Its header states the
  rule explicitly: "`tenant_id` is intentionally absent: these tables live in
  each tenant's Postgres" (`tenant-auth-schema.ts`).
- Consequence: uniqueness is plain, not compound — `tenant_users.email` is
  `UNIQUE` outright (`tenant-auth-schema.ts`), so the same email can exist
  in a different tenant's database. Same reasoning, worked through end to end,
  in `services/auth-service/README.md`, "Three things the code decides here".

So: **do not add a `tenant_id` column and do not build `{ tenant, ... }`
compound indexes** as a default. Get the tenant connection, then query it
without a tenant predicate.

> ⚠️ **UNDECIDED DIVERGENCE — do not resolve it yourself.**
> `registry-service` does the opposite: one shared platform database with
> `tenant_id` columns and `UNIQUE(tenant_id, name)`
> (`services/registry-service/src/providers/postgres.module.ts`; queries
> scoped by `WHERE tenant_id = …`, `src/modules/services/services.postgres.repository.ts`;
> documented in `services/registry-service/README.md`, its "shared platform database" note).
> AGENTS.md records this as "a standing, undecided divergence. Do NOT copy
> either model into a new service without a human decision" (`AGENTS.md`, "Platform contracts" → Tenancy).
> Both models exist today. When a new service needs a boundary, **stop and ask
> the human** — this skill deliberately prescribes neither.

### 5. Storage engine: Postgres and Mongo, chosen at bootstrap

Services call `resolveStorageEngine()` once in `src/config.ts`
(`packages/database/src/engine.ts`): `DB_ENGINE` wins over
`STORAGE_ENGINE`, default `postgres`, anything else throws. Both schemas of a
dual-engine service are updated in the same task — see
`DOCS/runbooks/storage-engines.md` and the per-service README `DB_ENGINE`
documentation required by `AGENTS.md`, "Platform contracts" → Storage engine.

Runnable check (which services are dual-engine):

```bash
rg -l 'resolveStorageEngine' services/*/src/config.ts
```

Mongo is therefore **not** the default and never the only target. Any pattern
written "for MongoDB" must have its Postgres counterpart in the same change.

### 6. Webhooks: tenant in the path

External providers cannot send `x-yoizen-tenant`, so webhook routes carry the
tenant as a path parameter and opt out of both auth and the tenant guard
(`services/api-gateway/src/modules/channels/webhooks.controller.ts`):

```
GET  /api/webhooks/:channel/:tenantId              (provider verification)
POST /api/webhooks/:channel/:tenantId
POST /api/webhooks/:channel/:tenantId/:instance    (per-account URL)
```

Each handler is annotated `@Public()` + `@SkipTenant()`; the tenant travels
onward from the path parameter, not from a header.

### 7. The bus already carries the tenant

The canonical envelope has a top-level `tenant` field
(`packages/shared/src/interfaces.ts`) and the subject grammar is
`evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>`
(`AGENTS.md`, "Platform contracts" → Eventing). The envelope is CloudEvents-*inspired*, not CloudEvents
compliant-by-spec (`DOCS/messaging/envelope.md` §2). Nothing needs to be added
to messages to make them tenant-aware — see the `envelope-messages` skill.

---

## Anti-patterns (these were wrong in v1 of this skill)

| Do not | Because |
|--------|---------|
| Any tenant header other than `x-yoizen-tenant` (v1 prescribed a generic tenant-id header) | The header is `x-yoizen-tenant`, imported from `TENANT_HEADER` (`packages/shared/src/constants.ts`) |
| Express `resolveTenant` middleware | The platform is NestJS; use `TenantGuard` (`manual-loops/workflow-toggle.md`, "Repo style wins") |
| `jsonwebtoken` | JWTs use `jose` (`services/api-gateway/src/modules/auth/jwt.service.ts`) |
| Adding `tenant`/`tenant_id` to documents by default | The DB is the boundary (`AGENTS.md`, "Platform contracts" → Tenancy, `packages/shared/src/tenant-auth-schema.ts`) |
| `{ tenant: 1, … }` compound indexes as the rule | Only meaningful in the shared-table exception, which is undecided (§4) |
| `DEFAULT_TENANT` fallback | No request-time fallback exists; missing tenant is a 400 (`services/api-gateway/src/guards/tenant.guard.ts`) |
| Subdomain `acme.example.io` | Hostname shape is `<env>.<tenant>.yplatform.com` (`services/api-gateway/src/constants.ts`) |

---

## Resources

- **Normative**: `AGENTS.md`, "Platform contracts" (Tenancy, Storage engine).
- **Code**: `packages/database/src/tenant-guard.ts`,
  `packages/database/src/tenant-connection-manager.ts`,
  `packages/shared/src/tenant.utils.ts`, `packages/shared/src/tenant-auth-schema.ts`,
  `services/api-gateway/src/guards/tenant.guard.ts`,
  `services/api-gateway/src/utils/tenant-resolution.util.ts`.
- **Docs**: `DOCS/runbooks/storage-engines.md`, `services/auth-service/README.md`
  (per-tenant DB model, worked example), `services/registry-service/README.md`
  (the shared-table exception).
- This skill ships **no `assets/` or `references/`**: the v1 Express /
  `jsonwebtoken` / Mongo templates and the reference index that pointed at
  `DOCS/architecture/01-multi-tenant-fundacion.md` (a file that does not exist —
  `fd multi-tenant DOCS` returns nothing) were deleted in the skills-cleanup
  loop. This SKILL.md and the source files it cites are the only truth here.
