# Delta Specification: yoizenclaw-deployment

## ADDED Requirements

### REQ-YZC-DEP-001: Helm chart for YoizenClaw runtime

**Priority**: P0 (Critical)

The system MUST provide a Helm chart for deploying YoizenClaw runtime as a Knative Service with per-tenant isolation.

**Chart structure**:
```
charts/yoizenclaw-runtime/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── knative-service.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   └── _helpers.tpl
```

**Required configurations**:
- Container image and tag
- Tenant ID (passed as env var `TENANT_ID`)
- PostgreSQL connection string (per-tenant)
- NATS URL and credentials (scoped to tenant's NATS Account)
- Resource limits/requests
- Health check probes

#### Scenario: Helm install for tenant

- GIVEN tenant "acme" needs a runtime
- WHEN `helm install yoizenclaw-acme charts/yoizenclaw-runtime --set tenantId=acme`
- THEN a Knative Service MUST be created
- AND the service MUST have environment variable `TENANT_ID=acme`
- AND the service MUST connect to `postgres.acme-dev-ns.svc.cluster.local`
- AND the service MUST use NATS credentials scoped to the "acme" NATS Account

#### Scenario: Knative Service autoscaling

- GIVEN the YoizenClaw runtime is deployed
- WHEN there is no traffic for 60 seconds
- THEN Knative MUST scale the service to 0 pods
- AND when traffic arrives, it MUST scale back to 1+ pods

### REQ-YZC-DEP-002: Container image build pipeline

**Priority**: P1 (High)

The system MUST provide a Dockerfile and CI pipeline for building the YoizenClaw runtime container image.

**Image requirements**:
- Based on `python:3.11-slim`
- Include all dependencies from `pyproject.toml`
- Optimized layer caching
- Multi-stage build for smaller image size
- Non-root user execution

#### Scenario: Docker build

- GIVEN the source code in `services/yoizenclaw-runtime/`
- WHEN `docker build -t yoizenclaw-runtime:v1.0.0 .` is executed
- THEN the image MUST include all Python dependencies
- AND the entrypoint MUST start the FastAPI server

### REQ-YZC-DEP-003: Kubernetes RBAC for runtime

**Priority**: P1 (High)

The system MUST define RBAC permissions required for the YoizenClaw runtime to operate within a tenant namespace.

**Required permissions**:
- Read ConfigMaps (for config files)
- Read Secrets (for credentials)
- None (runtime is consumer-only, no K8s API writes needed)

#### Scenario: Runtime starts with minimal permissions

- GIVEN the runtime is deployed in tenant namespace
- WHEN it starts up
- THEN it MUST NOT require cluster-admin permissions
- AND it MUST only access resources within its own namespace

## MODIFIED Requirements

### REQ-YZC-DEP-004: Tenant Service extension for YoizenClaw + NATS provisioning (wdocs/01,04,05)

**Priority**: P0 (Critical)

The system SHALL extend Tenant Service to provision the full YoizenClaw infrastructure stack when creating a tenant, including NATS Account, Stream, Object Store, and ACLs per wdocs/01-service-bus.md, wdocs/04-claim-check.md, and wdocs/05-seguridad.md.

**Extension to `tenants.service.ts`**:
- Add method `provisionYoizenClaw(tenantId: string, tier: string)` that:
  1. Creates NATS Account for tenant (wdocs/05)
  2. Creates JetStream `INGRESS-{tenant}` with tier-based limits (wdocs/01)
  3. Creates Object Store bucket `PAYLOAD-{tenant}` with TTL aligned to stream (wdocs/04)
  4. Creates ACLs: publish from admin/ingress, subscribe from yoizenclaw-runtime, cross-tenant denied (wdocs/05)
  5. Deploys Knative Service via Helm
  6. Stores runtime metadata in tenant record

**Stream limits by tier** (per wdocs/01):
- free: 1GB, 7 day retention
- pro: 5GB, 14 day retention
- enterprise: 20GB, 30 day retention

#### Scenario: Tenant creation with YoizenClaw

- GIVEN a request to create tenant "acme" with tier "pro"
- WHEN `provisionYoizenClaw("acme", "pro")` is called
- THEN the Tenant Service MUST:
  1. Create NATS Account "acme" with restrictive ACLs
  2. Create stream `INGRESS-acme` (5GB, 14 day retention)
  3. Create Object Store bucket `PAYLOAD-acme` (TTL 14 days)
  4. Create namespace `acme-dev-ns`
  5. Provision PostgreSQL StatefulSet
  6. Create YoizenClaw Knative Service with NATS Account credentials
  7. Return all endpoints in response

#### Scenario: Cross-tenant NATS isolation

- GIVEN tenants "acme" and "globex" both have YoizenClaw runtimes
- WHEN the acme runtime attempts to publish to `evt.globex.yoizenclaw.config_sync.v1`
- THEN the NATS Account ACL MUST reject the publish
- AND the runtime MUST log an ACL violation error

## Non-Functional Requirements

### NFR-DEP-001: Image size optimization

**Category**: Performance
**Priority**: P2 (Medium)

The container image SHOULD be optimized for fast startup and small size.

- **Metric**: Image size
- **Target**: < 500MB compressed
- **Measurement**: `docker images` output

### NFR-DEP-002: Cold start time

**Category**: Performance
**Priority**: P1 (High)

The runtime MUST start quickly when scaled from 0 (Knative cold start).

- **Metric**: Time from pod creation to ready
- **Target**: < 10 seconds for first health check success
- **Measurement**: Knative revision status timestamps

### NFR-DEP-003: Resource limits

**Category**: Reliability
**Priority**: P1 (High)

Each YoizenClaw runtime instance MUST have resource limits to prevent resource exhaustion.

- **Metric**: CPU and memory usage
- **Target**:
  - CPU limit: 1 core
  - Memory limit: 512Mi
  - Request: 250m CPU, 256Mi memory
- **Measurement**: Kubernetes resource quotas
