# AGENTS.md - Tenant Service

## Project Overview

The Tenant Service provisions and manages tenant namespaces via the Kubernetes API. Each instance is environment-scoped via `PLATFORM_ENVIRONMENT`, so creating a tenant through the dev gateway creates only `<tenant>-dev-ns`. On tenant creation, `tenant-service` provisions per-tenant database infrastructure: **Postgres** (`postgres` + `postgres-usage` StatefulSets) or **Mongo** (single `mongo` StatefulSet), selected at bootstrap via `ITenantProvisioner`.

## Storage engines

Catalog + provisioning are engine-aware (`ITenantsRepository`, `TENANT_PROVISIONER`). See [DOCS/STORAGE-ENGINES.md](../../DOCS/STORAGE-ENGINES.md).

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| K8s Client | `@kubernetes/client-node` (CoreV1Api, AppsV1Api, CustomObjectsApi) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                     # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                               # Root module imports
├── providers/
│   ├── kubernetes.provider.ts                  # @Global() K8S_CORE_API, K8S_APPS_API tokens
│   └── mongo.provider.ts                    # TenantMongoProvisioner (K8s-based PG provisioning)
└── modules/
    ├── tenants/
    │   ├── tenants.module.ts
    │   ├── tenants.controller.ts               # POST/GET/PATCH/DELETE /tenants, GET /tenants/:name
    │   ├── tenants.service.ts                  # Namespace CRUD, MongoDB provisioning orchestration
    │   └── tenant.dto.ts                       # CreateTenantDto, UpdateTenantDto (name validation)
    └── health/
        ├── health.module.ts
        └── health.controller.ts                # GET /health (K8s API connectivity)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/providers/mongo.provider.ts` | `TenantMongoProvisioner` — creates K8s Secret, ConfigMap (mongod.conf + initialization JS), headless Service, and StatefulSet for per-tenant MongoDB |
| `src/providers/kubernetes.provider.ts` | Factory providers for `K8S_CORE_API` and `K8S_APPS_API` |
| `src/modules/tenants/tenants.service.ts` | Namespace CRUD with K8s labels, orchestrates MongoDB provisioning and readiness wait |
| `src/modules/tenants/tenant.dto.ts` | `CreateTenantDto` / `UpdateTenantDto`; tenant name validation: lowercase alphanumeric with hyphens, max 32 chars |

## Architecture Highlights

### Module Dependency Graph

```
AppModule
├── KubernetesModule (@Global) ─── K8S_CORE_API, K8S_APPS_API
├── MongoModule (@Global) ─── TenantMongoProvisioner
├── TenantsModule ─── TenantsController, TenantsService
└── HealthModule ─── HealthController
```

### Data Flow

1. **Create tenant**: `POST /tenants { name }` -> validate name -> check for existing namespace -> create K8s namespace with labels -> provision MongoDB (OLTP + usage) -> wait for ready -> ensure NATS ingress stream -> return tenant detail with mongo host
2. **List tenants**: query namespaces by label `yoizen.io/managed-by=tenant-service` + current environment
3. **Get tenant**: lookup namespace by tenant name + environment labels -> return namespace status + mongo host
4. **Delete tenant**: delete namespace (cascades all resources, including MongoDB StatefulSet)

### Tenant Namespace Structure

Each tenant namespace (`<tenant>-<env>-ns`) contains:
- K8s Secret: `mongo-credentials` (DB, user, password)
- ConfigMap: `mongo-config` (mongod.conf + initialization JS for schema)
- Headless Service: `mongo` (ClusterIP: None, port 27017)
- StatefulSet: `mongo` (1 replica, 1Gi PVC; image from `TENANT_MONGO_IMAGE`, default `mongo:7.0`)

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
- **MongoDB provisioning**: full StatefulSet lifecycle (Secret, ConfigMap, Service, StatefulSet) with readiness polling (2s interval, 120s timeout)
- **Cascade delete**: deleting a namespace removes all resources including the MongoDB StatefulSet and PVC
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
| **Kubernetes API** | Provisions namespaces and MongoDB StatefulSets |
| **api-gateway** | Upstream proxy (tenant endpoints proxied through the gateway) |
| **audit-service** | Downstream consumer of the per-tenant MongoDB instances provisioned here |
| **`@yoizen/shared`** | `TENANT_HEADER` |
