# Infrastructure and Deployment

Class: descriptive
Summary: How the single-node developer cluster is put together: Knative vs plain Deployments, the Kustomize base/overlay layout, and what was removed (KEDA, cloud overlays, Temporal HA).

> **Developer mode:** This document describes the current single-node developer
> configuration. Multi-environment (qa/staging/production), cloud overlays, KEDA
> autoscaling, Temporal 4-role HA, and Redis cluster mode were removed from the
> active configuration. See the notes below for what changed and what was cut.

This document explains how infrastructure services support the platform and how workloads are deployed and scaled.

## Support Services

Support services are shared in `support-services-dev` and back all platform workloads.

| Service | Primary role | Platform usage |
|---|---|---|
| NATS JetStream | Durable event backbone | Internal async messaging on `INGRESS-<tenant>` and DLQ streams |
| Redis | Shared low-latency state/cache | L2 cache, execution status store, public-routes sync cache |
| PostgreSQL | Persistent relational storage | Shared platform/usage/Temporal clusters run on **CloudNativePG** (`infrastructure/base/postgres/postgres-*-cluster.yaml`, `apiVersion: postgresql.cnpg.io`). `dedicated`-tier tenants do **not**: `tenant-service` creates a plain Kubernetes StatefulSet + PVC per tenant from `TENANT_POSTGRES_IMAGE` (`postgres.provider.ts` / `postgres-usage.provider.ts`), `shared`-tier tenants get a logical DB inside the CNPG shared cluster |
| Temporal | Durable orchestration engine | Workflow execution and activity queue dispatch |

### Redis

Developer mode runs a **standalone** Redis StatefulSet (`REDIS_CLUSTER_MODE=false`). The previous Redis Cluster (3-node) was collapsed to a single node for simplicity.

### Redis Roles (explicit)

Redis serves three distinct roles across the platform:

1. **L2 cache for connector-backed HTTP resolution**
   - Used by `AdapterClient` (consumed by `connector-runtime`) with stale-while-revalidate behavior; cache is keyed per tenant + connector id.
2. **Execution state store for YoizenClaw runtime gateway path**
   - Stores pending/running/completed/failed execution status so playground and runtime API reads can poll quickly.
3. **Auth/gateway route synchronization cache**
   - Stores dynamic public route data consumed by gateway auth checks.

### Temporal

Developer mode runs a **single `temporalio/auto-setup` Deployment** named `temporal` (labels: `app.kubernetes.io/name=temporal`, `temporal.io/role=frontend`). All four internal Temporal roles (frontend, history, matching, worker) run in one process. The `temporal` Service serves `:7233`.

The 4-role HA split (separate `temporal-frontend`, `-history`, `-matching`, `-worker` Deployments) was an experiment used during stress testing but is no longer the active configuration. `runbooks/temporal-ha-migration.md` describes that one-time migration for historical context.

Developer mode also uses a single `postgres-temporal` CNPG cluster for both workflow state and visibility (both `POSTGRES_SEEDS` and `VISIBILITY_POSTGRES_SEEDS` point to `postgres-temporal-rw`). The separate `postgres-temporal-visibility` cluster described in `runbooks/temporal-visibility-split.md` is not active in developer mode.

## Deployment Models

| Model | Used by | Why |
|---|---|---|
| Knative Service | HTTP-facing APIs (`api-gateway`, `auth-service`, `registry-service`, etc.) | Request-driven autoscaling and revision support |
| Plain Deployment (fixed replicas) | Queue/worker workloads (`connector-runtime`, workflow workers, consumer workers) | All workers run at min-scale=max-scale=1 in developer mode |

> **KEDA removed:** KEDA ScaledObjects were deleted from the base manifests.
> All worker Deployments use fixed `replicas: 1`. The scale-to-zero Kustomize
> components that once lived under `knative/services/overlays/_components/` were
> deleted too (commit `2c77968b`, "back to dev mode for k8s") — nothing in the
> repo composes them and the directory no longer exists.

## Kustomize Structure

The platform uses Kustomize for manifests and environment overlays.

- Infra base: `infrastructure/base/`
- Infra overlays: `infrastructure/overlays/local/dev`, `infrastructure/overlays/orbstack/dev`
- Service base: `knative/services/base/`
- Service overlays: `knative/services/overlays/local/dev` (postgres or mongo variant)

```mermaid
flowchart TD
    infraBase[infrastructure/base] --> infraLocal[infrastructure/overlays/local/dev]
    infraBase --> infraOrb[infrastructure/overlays/orbstack/dev]

    svcBase[knative/services/base] --> svcLocal[knative/services/overlays/local/dev]
```

> Note: `knative/services/overlays/cloud/` and multi-env overlays (qa/staging/production)
> were deleted, and so was the whole `knative/services/overlays/_components/` tree
> (its last surviving file, a README describing the removed scale-to-zero
> components, was deleted by the docs-truth-audit T10 ruling D6). No
> `kustomization.yaml` in the repo declares `components:`.

## Add a New Service (Checklist)

- Add base manifest in `knative/services/base/` (Knative Service or Deployment).
- Add image/env patches in `knative/services/overlays/local/dev/`.
- Add health/proxy wiring in gateway if externally accessible through platform API.
- Update docs (`DOCS/architecture/overview.md`) with role and dependencies.

## References

- `infrastructure/base/`
- `infrastructure/overlays/`
