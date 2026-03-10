# Auth Service

Authentication and authorization service for the Yoizen platform. Issues JWT access/refresh tokens via client credentials and user login flows, manages platform users and API clients with scoped permissions, and maintains a dynamic public routes registry synced to Redis.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: PostgreSQL, Redis, `JWT_SECRET` env var.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/token` | Client credentials grant |
| `POST` | `/auth/login` | User login (email + password) |
| `POST` | `/auth/refresh` | Refresh access token |
| `POST` | `/auth/users` | Create platform user |
| `GET` | `/auth/users` | List platform users |
| `POST` | `/auth/clients` | Create API client |
| `GET` | `/auth/clients` | List API clients |
| `DELETE` | `/auth/clients/:id` | Revoke API client |
| `POST` | `/auth/public-routes` | Create public route |
| `GET` | `/auth/public-routes` | List public routes |
| `DELETE` | `/auth/public-routes/:id` | Remove public route |
| `GET` | `/health` | Health check |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `REDIS_HOST` | `localhost` | Redis host |
| `JWT_SECRET` | *(required)* | HS256 signing key |
| `ADMIN_EMAIL` | *(optional)* | Seed admin user |
| `ADMIN_PASSWORD` | *(optional)* | Seed admin password |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for detailed architecture, token flows, database schema, and conventions.
