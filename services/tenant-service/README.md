# Tenant Service

Provisions and manages tenant namespaces via the Kubernetes API. Tenant creation is asynchronous: `POST /tenants` returns `202 Accepted`, writes a pending platform row, and publishes a JetStream provisioning request. Environment-scoped via `PLATFORM_ENVIRONMENT`.

PostgreSQL provisioning depends on the tenant tier:

- `shared` (default): creates a logical database/role on the shared CNPG cluster, then creates tenant-namespace credentials plus a `postgres` ExternalName Service pointing at the shared host.
- `dedicated`: creates tenant-namespace PostgreSQL resources, including a dedicated StatefulSet.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires: Kubernetes cluster access (in-cluster or kubeconfig).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tenants` | Create tenant row and enqueue namespace + database provisioning (`202 Accepted`) |
| `GET` | `/tenants` | List tenants in this environment |
| `GET` | `/tenants/:name` | Get tenant detail (namespace status, PG host) |
| `DELETE` | `/tenants/:name` | Delete tenant (cascades all resources) |
| `GET` | `/health` | Health check (K8s connectivity) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `PLATFORM_ENVIRONMENT` | `dev` | Scopes namespace operations |
| `STORAGE_ENGINE` / `DB_ENGINE` | `postgres` | Selects PostgreSQL or Mongo provider |
| `SHARED_POSTGRES_HOST` | `postgres-shared-rw.support-services-dev.svc.cluster.local` | Shared-tier PostgreSQL host |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for PostgreSQL provisioning flow, namespace labels, and conventions.
