# AGENTS.md - Tenant Service

## Project Overview

The Tenant Service provisions and manages tenant namespaces via the Kubernetes API. Each instance is environment-scoped via `PLATFORM_ENVIRONMENT`, so creating a tenant through the dev gateway creates only `<tenant>-dev-ns`. On tenant creation, a dedicated PostgreSQL StatefulSet is provisioned inside the tenant namespace with pre-configured schema (events + metrics tables), providing full data isolation per tenant.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| K8s Client | `@kubernetes/client-node` (CoreV1Api, AppsV1Api) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                     # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                               # Root module imports
├── providers/
│   ├── kubernetes.provider.ts                  # @Global() K8S_CORE_API, K8S_APPS_API tokens
│   └── postgres.provider.ts                    # TenantPostgresProvisioner (K8s-based PG provisioning)
└── modules/
    ├── tenants/
    │   ├── tenants.module.ts
    │   ├── tenants.controller.ts               # POST/GET/PATCH/DELETE /tenants, GET /tenants/:name
    │   ├── tenants.service.ts                  # Namespace CRUD, PostgreSQL provisioning orchestration
    │   └── tenant.dto.ts                       # CreateTenantDto, UpdateTenantDto (name validation)
    └── health/
        ├── health.module.ts
        └── health.controller.ts                # GET /health (K8s API connectivity)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/providers/postgres.provider.ts` | `TenantPostgresProvisioner` — creates K8s Secret, ConfigMap (postgresql.conf + init.sql), headless Service, and StatefulSet for per-tenant PostgreSQL |
| `src/providers/kubernetes.provider.ts` | Factory providers for `K8S_CORE_API` and `K8S_APPS_API` |
| `src/modules/tenants/tenants.service.ts` | Namespace CRUD with K8s labels, orchestrates PostgreSQL provisioning and readiness wait |
| `src/modules/tenants/tenant.dto.ts` | `CreateTenantDto` / `UpdateTenantDto`; tenant name validation: lowercase alphanumeric with hyphens, max 32 chars |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── KubernetesModule (@Global) ─── K8S_CORE_API, K8S_APPS_API
├── PostgresModule (@Global) ─── TenantPostgresProvisioner
├── TenantsModule ─── TenantsController, TenantsService
└── HealthModule ─── HealthController
```

### Data Flow

1. **Create tenant**: `POST /tenants { name }` -> validate name -> check for existing namespace -> create K8s namespace with labels -> provision PostgreSQL StatefulSet -> wait for ready -> return tenant detail with postgres host
2. **List tenants**: query namespaces by label `yoizen.io/managed-by=tenant-service` + current environment
3. **Get tenant**: lookup namespace by tenant name + environment labels -> return namespace status + postgres host
4. **Delete tenant**: delete namespace (cascades all resources including PostgreSQL StatefulSet)

### Tenant Namespace Structure

Each tenant namespace (`<tenant>-<env>-ns`) contains:
- K8s Secret: `postgres-credentials` (DB, user, password)
- ConfigMap: `postgres-config` (postgresql.conf + init.sql for schema)
- Headless Service: `postgres` (ClusterIP: None, port 5432)
- StatefulSet: `postgres` (1 replica, 1Gi PVC, postgres:17-alpine)

### Namespace Labels

| Label | Value |
|-------|-------|
| `app.kubernetes.io/part-of` | `yoizen-arch` |
| `yoizen.io/tenant` | `<tenant-name>` |
| `yoizen.io/environment` | `dev` / `qa` / `staging` / `production` |
| `yoizen.io/managed-by` | `tenant-service` |

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| Kubernetes Core API | HTTPS | Namespace CRUD, Secret/ConfigMap/Service creation |
| Kubernetes Apps API | HTTPS | StatefulSet creation and readiness polling |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `K8S_CORE_API` | `CoreV1Api` | `kubernetes.provider.ts` |
| `K8S_APPS_API` | `AppsV1Api` | `kubernetes.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name (scopes namespace operations) |

### Knative

- Image: `dev.local/tenant-service:local`
- Autoscaling: min 1, max 3, target concurrency 50
- Readiness probe: `GET /health` on port 3000
- RBAC: `tenant-namespace-manager` ClusterRole for namespaces, services, configmaps, secrets, PVCs, statefulsets

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires K8s cluster) |

## Code Style and Conventions

- **Environment scoping**: all namespace operations filter by `PLATFORM_ENVIRONMENT` label
- **PostgreSQL provisioning**: full StatefulSet lifecycle (Secret, ConfigMap, Service, StatefulSet) with readiness polling (2s interval, 120s timeout)
- **Cascade delete**: deleting a namespace removes all resources including the PostgreSQL StatefulSet and PVC
- **Tenant name validation**: lowercase alphanumeric with optional hyphens, cannot start/end with hyphen, max 32 chars
- **Label-based discovery**: uses Kubernetes label selectors for all namespace queries

## Common Tasks

### Run locally

```bash
bun install
bun run start:dev
```

Requires Kubernetes cluster access (in-cluster or kubeconfig).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **Kubernetes API** | Provisions namespaces and PostgreSQL StatefulSets |
| **api-gateway** | Upstream proxy (tenant endpoints proxied through the gateway) |
| **audit-service, metrics-service, scheduler-service** | Downstream consumers of the per-tenant PostgreSQL instances provisioned here |
| **`@yoizen/shared`** | `TENANT_HEADER` |
