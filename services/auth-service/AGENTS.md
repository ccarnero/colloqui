# AGENTS.md - Auth Service

## Project Overview

The Auth Service handles authentication and authorization for the platform. It issues JWT access and refresh tokens via client credentials (API clients) and user login flows, manages platform users and API clients with scoped permissions (`platform` or `tenant:<name>`), maintains a dynamic public routes registry synced to Redis, and seeds an admin user on first startup. Each instance is environment-scoped via `PLATFORM_ENVIRONMENT`.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | PostgreSQL 17 via `postgres` (postgres.js) |
| Cache | Redis via `ioredis` |
| Auth | JWT via `jose` (HS256), password hashing via `Bun.password` (argon2id) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                     # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                               # Root module imports
├── providers/
│   ├── providers.module.ts                     # @Global() POSTGRES_SQL + REDIS_CLIENT (redis via @yoizen/database)
│   └── postgres.provider.ts                    # POSTGRES_SQL token (postgres.js, max 20 connections)
└── modules/
    ├── token/
    │   ├── token.module.ts
    │   ├── token.controller.ts                 # POST /auth/token, POST /auth/login, POST /auth/refresh
    │   ├── token.service.ts                    # JWT sign/verify, client credentials, login, refresh flows
    │   └── token.dto.ts                        # ClientCredentialsDto, LoginDto, RefreshDto
    ├── users/
    │   ├── users.module.ts
    │   ├── users.controller.ts                 # POST /auth/users, GET /auth/users
    │   ├── users.service.ts                    # User CRUD, admin seeding on init
    │   └── user.dto.ts                         # CreateUserDto (email, password, role)
    ├── clients/
    │   ├── clients.module.ts
    │   ├── clients.controller.ts               # POST /auth/clients, GET /auth/clients, DELETE /auth/clients/:id
    │   ├── clients.service.ts                  # API client CRUD, argon2id secret hashing
    │   └── client.dto.ts                       # CreateClientDto (name, scope)
    ├── public-routes/
    │   ├── public-routes.module.ts
    │   ├── public-routes.controller.ts         # POST/GET/DELETE /auth/public-routes
    │   ├── public-routes.service.ts            # Public route CRUD, Redis sync
    │   └── public-route.dto.ts                 # CreatePublicRouteDto (method, path_pattern, scope)
    └── health/
        ├── health.module.ts
        └── health.controller.ts                # GET /health (Postgres + Redis)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.module.ts` | Imports ProvidersModule, TokenModule, UsersModule, ClientsModule, PublicRoutesModule, HealthModule |
| `src/providers/postgres.provider.ts` | Factory provider for `POSTGRES_SQL` (postgres.js, prepared statements) |
| `providers.module.ts` | Registers `redisProvider` from `@yoizen/database` for `REDIS_CLIENT` |
| `src/modules/token/token.service.ts` | JWT generation (HS256 via `jose`), client credentials grant, user login, token refresh |
| `src/modules/users/users.service.ts` | User CRUD with argon2id password hashing, admin seeding from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars |
| `src/modules/clients/clients.service.ts` | API client management with `yoizen_` prefixed client IDs and `ysk_` prefixed secrets |
| `src/modules/public-routes/public-routes.service.ts` | Dynamic public route management, syncs routes to Redis on every mutation |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── ProvidersModule (@Global) ─── POSTGRES_SQL, REDIS_CLIENT
├── TokenModule ─── TokenController, TokenService
├── UsersModule ─── UsersController, UsersService
├── ClientsModule ─── ClientsController, ClientsService
├── PublicRoutesModule ─── PublicRoutesController, PublicRoutesService
└── HealthModule ─── HealthController
```

### Data Flow

1. **Client credentials**: `POST /auth/token` -> validate client_id + client_secret against DB -> issue access token (no refresh)
2. **User login**: `POST /auth/login` -> verify email + password -> issue access + refresh tokens
3. **Token refresh**: `POST /auth/refresh` -> verify refresh token -> re-issue access + refresh tokens
4. **Public routes**: CRUD operations persist to PostgreSQL, then sync all routes to Redis key `public_routes:{env}`
5. **Admin seeding**: On startup, `UsersService.onModuleInit()` checks for admin user; creates one from env vars if none exists

### Token Scopes

| Scope | Description |
|-------|-------------|
| `platform` | Full platform management access |
| `tenant:<name>` | Restricted to operations for that specific tenant |

### Identity Sources

| Source | Grant Type | Token Scope |
|--------|-----------|-------------|
| Platform User (email + password) | `POST /auth/login` | `platform` |
| API Client (client_id + client_secret) | `POST /auth/token` | `platform` or `tenant:<name>` per client config |

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| PostgreSQL | TCP | Persist users, clients, public routes |
| Redis | TCP | Sync public routes to `public_routes:{env}` cache key |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `POSTGRES_SQL` | `Sql` (postgres.js) | `postgres.provider.ts` |
| `REDIS_CLIENT` | `Redis` (ioredis) | `providers.module.ts` → `redisProvider` (`@yoizen/database`) |

### Database Schema

```sql
platform_users  (id, email, password_hash, role, is_active, created_at, updated_at)
api_clients     (id, client_id, client_secret_hash, name, scope, is_active, created_at, updated_at)
public_routes   (id, method, path_pattern, scope, environment, created_at)
```

## Configuration

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
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name (dev, qa, staging, production) |
| `ADMIN_EMAIL` | *(optional)* | Admin user email for seeding |
| `ADMIN_PASSWORD` | *(optional)* | Admin user password for seeding |

### Knative

- Image: `dev.local/auth-service:local`
- Autoscaling: min 1, max 3, target concurrency 50
- Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |

There is no `test/integration/` directory in this service; use `bun test test/unit` for automated tests.

## Code Style and Conventions

- **Module layout**: feature modules under `src/modules/`, shared providers under `src/providers/`
- **DI tokens**: string-based constants (`POSTGRES_SQL`, `REDIS_CLIENT`) exported alongside factory providers
- **Global providers**: `ProvidersModule` is `@Global()` so all modules can inject Postgres/Redis without importing
- **Password hashing**: `Bun.password.hash()` with argon2id (memoryCost 19456, timeCost 2)
- **JWT**: HS256 via `jose` library, `ACCESS_TOKEN_TTL` and `REFRESH_TOKEN_TTL` from `@yoizen/shared`
- **Client IDs**: `yoizen_` + UUID (no hyphens); secrets: `ysk_` + two UUIDs (no hyphens)
- **Validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`
- **Environment scoping**: all public route operations are filtered by `PLATFORM_ENVIRONMENT`
- **Lifecycle hooks**: `OnModuleInit` for admin user seeding and JWT secret validation

## Common Tasks

### Add a new endpoint

1. Create or update a controller in the appropriate `src/modules/<feature>/` directory
2. Add a service if business logic is needed
3. Register the module in `src/app.module.ts` if new

### Run locally

```bash
bun install
bun run start:dev
```

Requires local PostgreSQL and Redis.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **PostgreSQL** | Persists users, clients, public routes |
| **Redis** | Caches public routes for consumption by API Gateway |
| **api-gateway** | Upstream proxy (all auth endpoints proxied through the gateway) |
| **`@yoizen/shared`** | Auth types, TTLs, `TENANT_HEADER`, `PUBLIC_ROUTES_CACHE_KEY_PREFIX` |
