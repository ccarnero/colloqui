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

> **Normative source**: `AGENTS.md` → "Platform contracts" → Tenancy
> (`AGENTS.md:72-76`). This skill is advisory. Where this skill and AGENTS.md
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
   `TENANT_HEADER = "x-yoizen-tenant"` (`packages/shared/src/constants.ts:25`),
   exported from `@yoizen/shared` (`packages/shared/src/index.ts:213`). It is
   locked by a test: `packages/shared/src/__tests__/doc-locks.constants.test.ts:45-46`.
   Never hand-write the literal in service code — import the constant.
2. **A tenant-scoped JWT** — `JwtPayload.tenant_id`
   (`packages/shared/src/auth.interfaces.ts:9-20`) plus a `scope` of
   `tenant:<id>` (`services/api-gateway/src/constants.ts:8`,
   `services/auth-service/src/modules/token/token.service.ts:285`).

Runnable check:

```bash
rg -n 'TENANT_HEADER' packages/shared/src/constants.ts
cd packages/shared && bun test src/__tests__/doc-locks.constants.test.ts
```

Tenant ids are validated against `/^[a-zA-Z0-9-]{3,32}$/`
(`packages/shared/src/tenant.utils.ts:3`, exposed as `validateTenantId`,
`tenant.utils.ts:15-17`). `extractTenantId(headers)` does the
case-insensitive header lookup (`tenant.utils.ts:5-13`).

### 2. Tenant resolution chain (api-gateway)

The gateway resolves in a fixed order — **hostname → header → query** —
implemented in `services/api-gateway/src/utils/tenant-resolution.util.ts:8-26`:

```
Incoming request
     │
     ▼
  1. Hostname?  <env>.<tenant>.yplatform.com   (HOST_PATTERN, constants.ts:2)
     │ (no match)
     ▼
  2. Header?    x-yoizen-tenant: acme          (TENANT_HEADER)
     │ (absent)
     ▼
  3. Query?     ?tenant=acme
     │ (absent)
     ▼
  400 Bad Request — "Tenant context required."  (tenant.guard.ts:39-43)
```

| Source | When it applies | Shape |
|--------|-----------------|-------|
| Hostname | Browser/console traffic | `<env>.<tenant>.yplatform.com` (`services/api-gateway/src/constants.ts:2`) |
| Header | API clients, inter-service calls, CLI, tests | `x-yoizen-tenant: acme` |
| Query | Ad-hoc/manual calls | `?tenant=acme` |

There is **no** multi-source consistency/mismatch rule: the first source that
matches wins and the rest are never read (`tenant-resolution.util.ts:12-25`).
There is **no** fallback tenant: when no source matches, the gateway throws
`BadRequestException` (`services/api-gateway/src/guards/tenant.guard.ts:39-43`)
and the shared guard throws on a missing header
(`packages/database/src/tenant-guard.ts:29-33`). No service or package resolves
a fallback tenant from the environment — runnable check, which returns nothing:

```bash
rg -n '\bDEFAULT_TENANT\b' -g '!node_modules' services packages sdk
```

(Outside this file, the only `DEFAULT_TENANT` remaining in the repo is a shell
default for the `--tenant` flag of a reset script,
`scripts/reset/reset-tenant.sh:57` — verify with
`rg -n '\bDEFAULT_TENANT\b' -g '!node_modules' -g '!skills' .`)

### 3. NestJS `TenantGuard` + `@TenantId()` — the only pattern

Repo style is binding here: "NestJS modules/services, class-validator DTOs,
`@TenantId()` decorator, `TenantGuard`" (`manual-loops/workflow-toggle.md:29-30`).
No service uses Express tenant middleware or the `jsonwebtoken` package; JWT
work uses **`jose`** (`services/api-gateway/src/modules/auth/jwt.service.ts:7`,
`services/auth-service/src/modules/token/token.service.ts:8`). Runnable check —
no service, package, or SDK code imports it, so this returns nothing:

```bash
rg -n 'jsonwebtoken' -g '!node_modules' services packages sdk
```

**Shared implementation** — `packages/database/src/tenant-guard.ts`, exported
from `@yoizen/database` (`packages/database/src/index.ts:102`). Services re-export
it rather than reimplementing:
`services/agent-admin-service/src/guards/tenant.guard.ts:1`,
`services/agent-admin-service/src/providers/tenant.decorator.ts:1`.

The guard validates the header and stores `request.tenantId`
(`packages/database/src/tenant-guard.ts:24-45`); the param decorator reads it
back (`tenant-guard.ts:58-63`).

**Real controller usage** — verbatim
`services/agent-admin-service/src/modules/memories/memories.controller.ts:13-14`
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
registered before `AuthGuard` (`services/api-gateway/src/app.module.ts:54-61`),
resolves from hostname/header/query, writes both `request.tenantId` and
`request.headers[TENANT_HEADER]` so downstream proxies forward the tenant
(`services/api-gateway/src/guards/tenant.guard.ts:20-50`). Routes that must not
require a tenant opt out with `@SkipTenant()`
(`services/api-gateway/src/decorators/skip-tenant.decorator.ts:3-4`).

### 4. Data isolation: the DB is the boundary

Default model (AGENTS.md:72-76): **one database per tenant, no `tenant_id`
columns**.

- Postgres DB name `tenant_<id>`, role `tenant_<id>_app`
  (`packages/shared/src/tenant-database-tier.ts:19-25`).
- `getConnection(tenantId)` picks a per-tenant target by tier and opens/reuses
  one pool per tenant: `buildSharedTarget()` resolves the database name to
  `tenantPostgresDatabaseName(tenantId)` and the user to
  `tenantPostgresRoleName(tenantId)` unless the mode is `SingleDatabase`
  (`packages/database/src/tenant-connection-manager.ts:469-478`);
  `buildDedicatedTarget()` points at the tenant's own namespace host
  (`:454-466`); `getOrCreatePool()` keys the pool by that target and calls
  `postgres({...})` (`:501-509`). Dispatch: `getConnection()` at `:435-442`.
  The mode enum itself is `SharedTenantDatabaseMode`
  (`tenant-connection-manager.ts:14-17`). The Mongo manager reuses the same DB
  name (`packages/database/src/tenant-mongo-connection-manager.ts:400`).
- Reference DDL: `TENANT_AUTH_SCHEMA_SQL`
  (`packages/shared/src/tenant-auth-schema.ts:10-48`). Its header states the
  rule explicitly: "`tenant_id` is intentionally absent: these tables live in
  each tenant's Postgres" (`tenant-auth-schema.ts:6-8`).
- Consequence: uniqueness is plain, not compound — `tenant_users.email` is
  `UNIQUE` outright (`tenant-auth-schema.ts:43`), so the same email can exist
  in a different tenant's database. Same reasoning, worked through end to end,
  in `services/auth-service/README.md:169-171`.

So: **do not add a `tenant_id` column and do not build `{ tenant, ... }`
compound indexes** as a default. Get the tenant connection, then query it
without a tenant predicate.

> ⚠️ **UNDECIDED DIVERGENCE — do not resolve it yourself.**
> `registry-service` does the opposite: one shared platform database with
> `tenant_id` columns and `UNIQUE(tenant_id, name)`
> (`services/registry-service/src/providers/postgres.module.ts:13,26`; queries
> scoped by `WHERE tenant_id = …`, `src/modules/services/services.postgres.repository.ts:22,56`;
> documented in `services/registry-service/README.md:8-9`).
> AGENTS.md records this as "a standing, undecided divergence. Do NOT copy
> either model into a new service without a human decision" (`AGENTS.md:74-76`).
> Both models exist today. When a new service needs a boundary, **stop and ask
> the human** — this skill deliberately prescribes neither.

### 5. Storage engine: Postgres and Mongo, chosen at bootstrap

Services call `resolveStorageEngine()` once in `src/config.ts`
(`packages/database/src/engine.ts:13-23`): `DB_ENGINE` wins over
`STORAGE_ENGINE`, default `postgres`, anything else throws. Both schemas of a
dual-engine service are updated in the same task — see
`DOCS/runbooks/storage-engines.md` and the per-service README `DB_ENGINE`
documentation required by `AGENTS.md:77-79`.

Runnable check (which services are dual-engine):

```bash
rg -l 'resolveStorageEngine' services/*/src/config.ts
```

Mongo is therefore **not** the default and never the only target. Any pattern
written "for MongoDB" must have its Postgres counterpart in the same change.

### 6. Webhooks: tenant in the path

External providers cannot send `x-yoizen-tenant`, so webhook routes carry the
tenant as a path parameter and opt out of both auth and the tenant guard
(`services/api-gateway/src/modules/channels/webhooks.controller.ts:28,35-37,50-52,69-71`):

```
GET  /api/webhooks/:channel/:tenantId              (provider verification)
POST /api/webhooks/:channel/:tenantId
POST /api/webhooks/:channel/:tenantId/:instance    (per-account URL)
```

Each handler is annotated `@Public()` + `@SkipTenant()`; the tenant travels
onward from the path parameter, not from a header.

### 7. The bus already carries the tenant

The canonical envelope has a top-level `tenant` field
(`packages/shared/src/interfaces.ts:39`) and the subject grammar is
`evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>`
(`AGENTS.md:64-65`). The envelope is CloudEvents-*inspired*, not CloudEvents
compliant-by-spec (`DOCS/messaging/envelope.md:32`). Nothing needs to be added
to messages to make them tenant-aware — see the `envelope-messages` skill.

---

## Anti-patterns (these were wrong in v1 of this skill)

| Do not | Because |
|--------|---------|
| Any tenant header other than `x-yoizen-tenant` (v1 prescribed a generic tenant-id header) | The header is `x-yoizen-tenant`, imported from `TENANT_HEADER` (`packages/shared/src/constants.ts:25`) |
| Express `resolveTenant` middleware | The platform is NestJS; use `TenantGuard` (`manual-loops/workflow-toggle.md:29-30`) |
| `jsonwebtoken` | JWTs use `jose` (`services/api-gateway/src/modules/auth/jwt.service.ts:7`) |
| Adding `tenant`/`tenant_id` to documents by default | The DB is the boundary (`AGENTS.md:72-74`, `packages/shared/src/tenant-auth-schema.ts:6-8`) |
| `{ tenant: 1, … }` compound indexes as the rule | Only meaningful in the shared-table exception, which is undecided (§4) |
| `DEFAULT_TENANT` fallback | No request-time fallback exists; missing tenant is a 400 (`services/api-gateway/src/guards/tenant.guard.ts:39-43`) |
| Subdomain `acme.example.io` | Hostname shape is `<env>.<tenant>.yplatform.com` (`services/api-gateway/src/constants.ts:2`) |

---

## Resources

- **Normative**: `AGENTS.md:60-83` (Platform contracts — Tenancy, Storage engine).
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
