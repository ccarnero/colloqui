# Auth Service

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
| `POST` | `/auth/tenant-users` | Platform scope | Create a tenant user |
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

### Public Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/public-routes` | Platform scope | Create public route |
| `GET` | `/auth/public-routes` | Platform scope | List public routes |
| `DELETE` | `/auth/public-routes/:id` | Platform scope | Remove public route |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check (Postgres + Redis) |

## Login Flow

The `POST /auth/login` endpoint supports two identity sources:

1. **Platform users** -- looked up first in `platform_users` by email. Issues JWT with `scope: 'platform'`.
2. **Tenant users** -- looked up in `tenant_users` by email (optionally scoped by `tenant_id` in the request body). Issues JWT with `scope: 'tenant:<id>'`, `role`, `tenant_id`, and `email` embedded in the payload.

If an email exists in multiple tenants and no `tenant_id` is provided, the endpoint returns an error asking the caller to disambiguate.

## Token Scopes & Roles

| Scope | Description |
|-------|-------------|
| `platform` | Full platform management access |
| `tenant:<id>` | Restricted to operations for that specific tenant |

| Role | Scope | Description |
|------|-------|-------------|
| `admin` | Platform | Full platform admin |
| `operator` | Platform | Limited platform operations |
| `tenant_admin` | Tenant | Full access to tenant resources, can manage tenant users |
| `tenant_editor` | Tenant | Edit tenant resources (workflows, adapters, etc.) |
| `tenant_viewer` | Tenant | Read-only access to tenant resources |

## Database Schema

```sql
platform_users  (id, email, password_hash, role, is_active, created_at, updated_at)
tenant_users    (id, tenant_id, email, password_hash, role, display_name, is_active, created_at, updated_at)
api_clients     (id, client_id, client_secret_hash, name, scope, is_active, created_at, updated_at)
public_routes   (id, method, path_pattern, scope, environment, created_at)
```

The `tenant_users` table has a `UNIQUE(tenant_id, email)` constraint -- the same email can exist across different tenants but must be unique within a tenant.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | PostgreSQL database |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | PostgreSQL password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | *(required)* | HS256 signing key |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name |
| `ADMIN_EMAIL` | *(optional)* | Seed admin user email |
| `ADMIN_PASSWORD` | *(optional)* | Seed admin user password |

## Testing

```bash
bun test              # All tests
bun test test/unit    # Unit tests
bun test test/integration  # Integration tests
```

## Architecture

See [AGENTS.md](AGENTS.md) for detailed architecture, module dependency graphs, token flows, and conventions.
