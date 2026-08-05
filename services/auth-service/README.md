# Auth Service

Class: descriptive
Summary: Token issuance and identity: client-credentials and user-login flows, platform users, tenant users, API clients, scopes, and the Redis-synced public-route registry.

Authentication and authorization service for the Yoizen platform. Issues JWT access/refresh tokens via client credentials and user login flows, manages platform users, tenant users, and API clients with scoped permissions, and maintains a dynamic public routes registry synced to Redis.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: PostgreSQL, Redis, `JWT_SECRET` env var.

## Endpoints

### Token

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/token` | Public | Client credentials grant |
| `POST` | `/auth/login` | Public | User login (email + password, supports platform and tenant users) |
| `POST` | `/auth/refresh` | Public | Refresh access token |

### Platform Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/users` | Platform scope | Create platform user |
| `GET` | `/auth/users` | Platform scope | List platform users |

### Tenant Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/tenant-users` | Platform or matching tenant_admin via gateway; internal controller requires request body only | Create a tenant user |
| `GET` | `/auth/tenant-users` | Platform or matching tenant scope | List users for tenant (via `x-yoizen-tenant`) |
| `GET` | `/auth/tenant-users/:id` | Platform or matching tenant scope | Get a single tenant user |
| `PATCH` | `/auth/tenant-users/:id` | Platform scope or tenant_admin | Update role, display name, or active status |
| `DELETE` | `/auth/tenant-users/:id` | Platform scope or tenant_admin | Soft-delete (deactivate) a tenant user |

### API Clients

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/clients` | Platform scope | Create API client |
| `GET` | `/auth/clients` | Platform scope | List API clients |
| `DELETE` | `/auth/clients/:id` | Platform scope | Revoke API client |

### Tenant Roles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/tenant-roles` | Tenant from BODY, not header | Create a role in the tenant's own `tenant_roles` table. Unlike its four siblings, `create()` reads the tenant from the request body (`CreateTenantRoleDto`, `src/modules/tenant-roles/tenant-roles.controller.ts:22-30`) instead of the `x-yoizen-tenant` header |
| `GET` | `/auth/tenant-roles` | Tenant header | List roles (`tenant-roles.controller.ts:32`) |
| `GET` | `/auth/tenant-roles/:id` | Tenant header | Get one role with its permissions (`tenant-roles.controller.ts:37`) |
| `PATCH` | `/auth/tenant-roles/:id` | Tenant header | Update name/description/permissions (`tenant-roles.controller.ts:48`) |
| `DELETE` | `/auth/tenant-roles/:id` | Tenant header | Delete a role (`tenant-roles.controller.ts:61`) |

`tenant_admin` is reserved: it cannot be created (`tenant-roles.service.ts:70-74`),
renamed away from itself, or claimed by a non-system role
(`tenant-roles.service.ts:155-160`), and a system role cannot be deleted
(`tenant-roles.service.ts:198`).

### Public Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/public-routes` | Platform scope | Create public route |
| `GET` | `/auth/public-routes` | Platform scope | List public routes |
| `DELETE` | `/auth/public-routes/:id` | Platform scope | Remove public route |

Every write re-syncs the FULL route set to Redis
(`syncToRedis`, `src/modules/public-routes/public-routes.service.ts:62-89`),
writing two keys:

- `public_routes:<env>` — every route, read by api-gateway
  (`PUBLIC_ROUTES_CACHE_KEY_PREFIX`, `packages/shared/src/auth.constants.ts:3`;
  applied at `public-routes.service.ts:74-75`).
- `public_routes:<env>:<tenant>` — written only when the mutation carried a
  tenant, and filtered to routes whose scope is `platform` or that exact tenant
  (`public-routes.service.ts:77-84`).

The gateway caches these for 30 s, so a change here is not effective
immediately.

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check (Postgres + Redis) |

## Login Flow

The `POST /auth/login` endpoint supports two identity sources (`src/modules/token/token.service.ts:114-123`):

1. **Platform users** -- looked up first in the platform `platform_users` table by email (`src/modules/token/token.postgres.repository.ts:117-122`). Issues JWT with `scope: 'platform'`.
2. **Tenant users** -- looked up in the tenant's own database, joining `tenant_users` to `tenant_roles` so the role NAME travels in the token (`src/modules/token/token.postgres.repository.ts:147-154`). Issues JWT with `scope: 'tenant:<id>'` plus the role, tenant and email claims (`src/modules/token/token.service.ts:285-298`).

The optional tenant hint in the login body (`LoginDto`, `src/modules/token/token.dto.ts:36`) selects which tenant database is probed. Without it, the service probes every `provisioning_status = 'ready'` tenant database in turn (`token.postgres.repository.ts:160-217`); if the email matches in more than one tenant the endpoint returns `401 Unauthorized` asking the caller to disambiguate (`token.service.ts:261-265`).

## Password hashing

All passwords and client secrets go through one entry point, `hashSecret`
(`src/utils/password.ts:10-12`), which applies the `ARGON2_OPTIONS` constant:
Argon2id with `memoryCost: 19456` and `timeCost: 2`
(`src/utils/password.ts:1-5`). Verification uses `Bun.password.verify`
(`src/modules/token/token.service.ts:84`, `:233`, `:280`).

## Startup seeding

Two independent, idempotent seeders run on module init; both are complete no-ops
unless their env vars are set:

- **Platform admin** (`UsersService.onModuleInit` → `seedAdmin`,
  `src/modules/users/users.service.ts:25-27`, `:69-79`): needs `ADMIN_EMAIL`
  and `ADMIN_PASSWORD`; skipped entirely if ANY admin already exists (`:74-75`).
  Creates the user with role `admin` (`:77`).
- **Tenant admin** (`TenantUsersService.onModuleInit` → `seedTenantAdmin`,
  `src/modules/tenant-users/tenant-users.service.ts:67`, `:214-244`): needs
  `TENANT_ADMIN_TENANT_ID`, `TENANT_ADMIN_EMAIL` and `TENANT_ADMIN_PASSWORD`
  (`:220-222`). It first seeds the tenant's `tenant_admin` system role, then
  creates the user bound to that `role_id` (`:233-241`) — skipped if that email
  already exists in the tenant (`:224-231`).

## Token Scopes & Roles

| Scope | Description |
|-------|-------------|
| `platform` | Full platform management access |
| `tenant:<id>` | Restricted to operations for that specific tenant |

**Platform roles** live in the `platform_users.role` column. `POST /auth/users` only accepts `admin` (`UserRole` enum, `src/modules/users/user.dto.ts:9-11`); the column itself defaults to `operator` (`src/providers/postgres.module.ts:16`).

**Tenant roles are data, not an enum.** They are rows in the tenant's own `tenant_roles` table and are created per tenant via `/auth/tenant-roles`. The only reserved name is `tenant_admin` (`SYSTEM_ROLE_TENANT_ADMIN`, `packages/shared/src/auth.interfaces.ts:7`), seeded idempotently per tenant with `is_system = true` (`src/modules/tenant-roles/tenant-roles.service.ts:49-64`) and rejected as a name for user-created roles (`tenant-roles.service.ts:70-74`). A system role resolves to a wildcard permission set; every other role resolves to its explicit `tenant_role_permissions` rows (`src/modules/token/token.service.ts:323-333`, `token.postgres.repository.ts:219-230`).

## Database Schema

The service reads TWO kinds of database: one platform database and one database **per tenant**. There is no shared table holding rows for every tenant.

### Platform database

DDL: `AUTH_PLATFORM_SCHEMA_SQL` in `src/providers/postgres.module.ts:11-65`.

```sql
platform_users  (id, email UNIQUE, password_hash, role, is_active, created_at, updated_at)
api_clients     (id, client_id UNIQUE, client_secret_hash, name, scope, is_active, created_at, updated_at)
public_routes   (id, method, path_pattern, scope, environment, created_at)
tenants         (id, name UNIQUE, tier, configuration, created_at, updated_at,
                 provisioning_status, provisioning_error,
                 provisioning_started_at, provisioning_completed_at)
```

### Per-tenant database

DDL: `TENANT_AUTH_SCHEMA_SQL` in `packages/shared/src/tenant-auth-schema.ts:10-48` — the single source of truth shared by this service's `AuthTenantConnectionManagerPostgres` (`src/providers/auth-tenant-connection-manager.postgres.ts:13-21`) and tenant-service provisioning.

```sql
tenant_roles            (id, name, description, is_system, is_active,
                         created_at, updated_at, UNIQUE(name))
tenant_role_permissions (id, role_id -> tenant_roles(id) ON DELETE CASCADE,
                         resource, action, UNIQUE(role_id, resource, action))
tenant_users            (id, email, password_hash, role_id -> tenant_roles(id),
                         display_name, is_active, created_at, updated_at,
                         UNIQUE(email))
```

Three things the code decides here:

- **No `tenant` column on any of these tables.** Tenancy is the database, not a column — `AuthTenantConnectionManagerPostgres` configures `SharedTenantDatabaseMode.PerTenantDatabase` (`auth-tenant-connection-manager.postgres.ts:16-18`), and every tenant query runs against the connection returned by `ensureSchema(<tenant>)` (`src/modules/token/token.postgres.repository.ts:19-21`). The absence of that column is deliberate and documented in the schema file's own header (`packages/shared/src/tenant-auth-schema.ts:6-8`).
- **`tenant_users.email` is `UNIQUE` outright** (`tenant-auth-schema.ts:43`), not a compound key — uniqueness is per tenant database, so the same email may still exist in a different tenant's database.
- **`tenant_users` has no `role` string.** It carries `role_id`, a `NOT NULL` FK into `tenant_roles(id)` (`tenant-auth-schema.ts:38`); the role NAME is resolved by joining at query time (`token.postgres.repository.ts:147-154`).

The equivalent Mongo shape is `TENANT_AUTH_MONGO_SCHEMA`, applied by `AuthTenantConnectionManagerMongo` (`src/providers/auth-tenant-connection-manager.mongo.ts:12-20`) in the same per-tenant-database mode.

### Storage engine selection

Postgres and Mongo repositories coexist; `DB_ENGINE` picks one at bootstrap (see [DOCS/runbooks/storage-engines.md](../../DOCS/runbooks/storage-engines.md)):

- `resolveStorageEngine()` reads `DB_ENGINE`, falls back to `STORAGE_ENGINE`, then defaults to `postgres`, and throws on any other value (`packages/database/src/engine.ts:13-23`).
- `authServiceConfig.dbEngine` exposes it lazily (`src/config.ts:22-24`).
- `ProvidersModule` imports `AuthPostgresModule` or `AuthMongoModule` from that single value (`src/providers/providers.module.ts:21-50`), and each feature module picks its repository through `createRepositoryProvider({ engine: authServiceConfig.dbEngine })` (e.g. `src/modules/token/token.module.ts:16-21`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (`src/config.ts:19-21`) |
| `DB_ENGINE` | `postgres` | Storage engine: `postgres` or `mongo`; falls back to `STORAGE_ENGINE`, throws on any other value (`packages/database/src/engine.ts:13-23`) |
| `MONGO_DB` | `yoizen` | Mongo database name when `DB_ENGINE=mongo` (`src/config.ts:25-27`) |

The block below is **not** read by `src/config.ts`. It is read by the shared
`@yoizen/database` providers this service composes — `createPostgresProvider`
(wired with `PLATFORM_POSTGRES_POOL_OPTIONS` in
`src/providers/postgres.provider.ts`) and `createRedisClient`:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL host. The default is supplied by `createPostgresProvider`'s own `defaultHost = "localhost"` parameter default in `@yoizen/database` — `PLATFORM_POSTGRES_POOL_OPTIONS` sets only `max`/`connectTimeout`/`prepare`, so `defaultHost` falls back, and the factory passes `process.env.POSTGRES_HOST ?? defaultHost` to postgres.js as a literal string |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | PostgreSQL database |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `POSTGRES_PASSWORD` | **required — no default** | Read with `requireEnv("POSTGRES_PASSWORD")`, which THROWS `"POSTGRES_PASSWORD environment variable is required"` when unset or empty. (`yoizen-dev-password` is the value the dev overlay's `postgres-credentials` Secret supplies — it is not a code default.) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_CLUSTER_MODE` | *(off)* | Cluster client only on the literal `"true"` |

Back to this service's own surface:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *(required)* | HS256 signing key. `authServiceConfig.jwtSecret` returns `undefined` when unset — the failure surfaces at signing time, not at boot |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name (`src/config.ts:28-30`) |
| `ADMIN_EMAIL` | *(optional)* | Platform-admin seed email (`src/config.ts:34-36`) |
| `ADMIN_PASSWORD` | *(optional)* | Platform-admin seed password (`src/config.ts:37-39`) |
| `TENANT_ADMIN_TENANT_ID` | *(optional)* | Tenant to seed a `tenant_admin` into (`src/config.ts:40-42`) |
| `TENANT_ADMIN_EMAIL` | *(optional)* | Tenant-admin seed email (`src/config.ts:43-45`) |
| `TENANT_ADMIN_PASSWORD` | *(optional)* | Tenant-admin seed password (`src/config.ts:46-48`) |
| `TENANT_ADMIN_DISPLAY_NAME` | *(optional)* | Tenant-admin display name (`src/config.ts:49-51`) |

## Testing

```bash
cd services/auth-service
bun run test:unit
```

Only `test/unit/` exists; `test:integration` matches no directory today.

## Deploy

Knative Service, min 1 / max 3, concurrency target 50, image
`dev.local/auth-service:local`
(`knative/services/base/auth-service.yaml:14-16`, `:21`).

```bash
./rebuild-redeploy.sh auth-service dev
```
