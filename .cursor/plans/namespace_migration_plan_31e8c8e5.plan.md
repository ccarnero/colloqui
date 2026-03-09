---
name: Namespace Migration Plan
overview: Migrate all Knative services to the `platform-services` namespace and all infrastructure (NATS, Redis, Postgres) to the `support-services` namespace, replacing the single `yoizen-arch` namespace. Cross-namespace DNS references and a duplicated Postgres secret will ensure connectivity.
todos:
  - id: namespaces
    content: Replace infrastructure/base/namespace.yaml with two namespace definitions (platform-services + support-services)
    status: completed
  - id: infra-ns
    content: "Update all infrastructure YAML files (14 files across nats/, redis/, postgres/, overlays/) to use namespace: support-services"
    status: completed
  - id: knative-ns
    content: "Update all 6 Knative service YAMLs: namespace -> platform-services, DNS env vars -> support-services, service-to-service refs -> platform-services"
    status: completed
  - id: secret-dup
    content: Create knative/services/postgres-credentials.yaml and add to kustomization.yaml
    status: completed
  - id: bootstrap
    content: Update bootstrap.sh to use two namespace variables and fix rollout/status commands
    status: completed
  - id: readme
    content: Update README.md namespace references
    status: completed
isProject: false
---

# Namespace Migration: yoizen-arch -> platform-services + support-services

## Current State

Everything lives in a single `yoizen-arch` namespace. After migration:

- `**platform-services**`: api-gateway, event-processor, cache-service, audit-service, webhook-service, metrics-service
- `**support-services**`: NATS, Redis, PostgreSQL

```mermaid
flowchart LR
  subgraph platformServices ["platform-services namespace"]
    ApiGateway["api-gateway"]
    EventProcessor["event-processor"]
    CacheService["cache-service"]
    AuditService["audit-service"]
    WebhookService["webhook-service"]
    MetricsService["metrics-service"]
  end
  subgraph supportServices ["support-services namespace"]
    NATS["NATS JetStream"]
    Redis["Redis"]
    Postgres["PostgreSQL"]
  end
  ApiGateway -->|"nats.support-services.svc"| NATS
  ApiGateway -->|"redis.support-services.svc"| Redis
  ApiGateway -->|"audit-service.platform-services.svc"| AuditService
  EventProcessor --> NATS
  EventProcessor --> Redis
  CacheService --> Redis
  AuditService --> NATS
  AuditService --> Postgres
  WebhookService --> NATS
  MetricsService --> NATS
  MetricsService --> Postgres
```



---

## 1. Replace namespace definition

**File**: [infrastructure/base/namespace.yaml](infrastructure/base/namespace.yaml)

Replace the single `yoizen-arch` Namespace with two Namespace documents:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: support-services
  labels:
    app.kubernetes.io/part-of: yoizen-arch
---
apiVersion: v1
kind: Namespace
metadata:
  name: platform-services
  labels:
    app.kubernetes.io/part-of: yoizen-arch
```

Both namespaces are created by the infrastructure kustomization (applied first via `bootstrap.sh`).

---

## 2. Update all infrastructure resources to `support-services`

Change `namespace: yoizen-arch` to `namespace: support-services` in every file under `infrastructure/`:

- [infrastructure/base/nats/configmap.yaml](infrastructure/base/nats/configmap.yaml)
- [infrastructure/base/nats/statefulset.yaml](infrastructure/base/nats/statefulset.yaml)
- [infrastructure/base/nats/service.yaml](infrastructure/base/nats/service.yaml) (2 occurrences)
- [infrastructure/base/redis/configmap.yaml](infrastructure/base/redis/configmap.yaml)
- [infrastructure/base/redis/deployment.yaml](infrastructure/base/redis/deployment.yaml)
- [infrastructure/base/redis/service.yaml](infrastructure/base/redis/service.yaml)
- [infrastructure/base/postgres/configmap.yaml](infrastructure/base/postgres/configmap.yaml)
- [infrastructure/base/postgres/statefulset.yaml](infrastructure/base/postgres/statefulset.yaml)
- [infrastructure/base/postgres/service.yaml](infrastructure/base/postgres/service.yaml) (2 occurrences)
- [infrastructure/base/postgres/secret.yaml](infrastructure/base/postgres/secret.yaml)
- [infrastructure/overlays/local/patches/nats-resources.yaml](infrastructure/overlays/local/patches/nats-resources.yaml)
- [infrastructure/overlays/local/patches/redis-resources.yaml](infrastructure/overlays/local/patches/redis-resources.yaml)
- [infrastructure/overlays/local/patches/postgres-resources.yaml](infrastructure/overlays/local/patches/postgres-resources.yaml)

---

## 3. Update all Knative services to `platform-services`

For each file in `knative/services/`:

**a) Change namespace in metadata** from `yoizen-arch` to `platform-services`:

- [knative/services/api-gateway.yaml](knative/services/api-gateway.yaml)
- [knative/services/event-processor.yaml](knative/services/event-processor.yaml)
- [knative/services/cache-service.yaml](knative/services/cache-service.yaml)
- [knative/services/audit-service.yaml](knative/services/audit-service.yaml)
- [knative/services/webhook-service.yaml](knative/services/webhook-service.yaml)
- [knative/services/metrics-service.yaml](knative/services/metrics-service.yaml)

**b) Update cross-namespace DNS env vars** -- infrastructure now in `support-services`:

- `NATS_URL`: `nats://nats.support-services.svc.cluster.local:4222`
- `REDIS_HOST`: `redis.support-services.svc.cluster.local`
- `POSTGRES_HOST`: `postgres.support-services.svc.cluster.local`

**c) Update service-to-service reference** in api-gateway:

- `AUDIT_SERVICE_URL`: `http://audit-service.platform-services.svc.cluster.local`

---

## 4. Duplicate Postgres Secret into `platform-services`

`audit-service` and `metrics-service` reference `postgres-credentials` via `secretKeyRef`. Since secrets are namespace-scoped, create a copy.

**New file**: `knative/services/postgres-credentials.yaml`

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
  namespace: platform-services
  labels:
    app.kubernetes.io/name: postgres
    app.kubernetes.io/component: database
type: Opaque
stringData:
  POSTGRES_DB: yoizen
  POSTGRES_USER: yoizen
  POSTGRES_PASSWORD: yoizen-dev-password
```

Add this resource to [knative/services/kustomization.yaml](knative/services/kustomization.yaml):

```yaml
resources:
  - postgres-credentials.yaml
  - api-gateway.yaml
  # ... etc
```

---

## 5. Update `bootstrap.sh`

**File**: [bootstrap.sh](bootstrap.sh)

- Replace `NAMESPACE="yoizen-arch"` with two variables:

```bash
  NAMESPACE_PLATFORM="platform-services"
  NAMESPACE_SUPPORT="support-services"
  

```

- In `apply_infrastructure()`: change `kubectl rollout status` `--namespace` to `$NAMESPACE_SUPPORT`
- In `print_summary()`: update printed namespace info and `kubectl` example commands to reference both namespaces

---

## 6. Update README.md

Update any `yoizen-arch` namespace references in [README.md](README.md) to reflect the new two-namespace layout.