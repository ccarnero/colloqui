# Tenant Service

Provisions and manages tenant namespaces via the Kubernetes API. On creation, deploys a dedicated PostgreSQL StatefulSet inside the tenant namespace with pre-configured schema. Environment-scoped via `PLATFORM_ENVIRONMENT`.

## Quick Start

```bash
bun install
bun run start:dev
```

Requires: Kubernetes cluster access (in-cluster or kubeconfig).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tenants` | Create tenant namespace + PostgreSQL |
| `GET` | `/tenants` | List tenants in this environment |
| `GET` | `/tenants/:name` | Get tenant detail (namespace status, PG host) |
| `DELETE` | `/tenants/:name` | Delete tenant (cascades all resources) |
| `GET` | `/health` | Health check (K8s connectivity) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `PLATFORM_ENVIRONMENT` | `dev` | Scopes namespace operations |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for PostgreSQL provisioning flow, namespace labels, and conventions.
