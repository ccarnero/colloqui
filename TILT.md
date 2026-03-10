# Local Development with Tilt

Tilt provides a fast inner-loop development experience for the Yoizen platform. It builds service images inside Minikube, deploys infrastructure and Knative services, and live-syncs source code changes into running containers — no manual rebuild or redeploy required.

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|-----------------|---------|
| [minikube](https://minikube.sigs.k8s.io/docs/start/) | 1.32 | Local Kubernetes cluster |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | 1.28 | Cluster management |
| [Docker](https://docs.docker.com/get-docker/) | 24+ | Minikube driver + image builds |
| [Tilt](https://docs.tilt.dev/install.html) | 0.33+ | Local development orchestrator |
| [Bun](https://bun.sh/) | 1.3 | JS/TS runtime (for running services locally) |

## Getting Started

### 1. Bootstrap the cluster (first time only)

Just run this once:

```bash
minikube start -p yoizen-arch
```

This will create a minikube cluster with yoizen-arch profile attached.

### 2. Start Tilt

```bash
tilt up
```

Tilt will:

1. **Verify Knative** — check if the Knative CRDs exist and install them if missing
2. **Patch Knative config** — configure `dev.local` registry skip and sslip.io DNS
3. **Create namespaces** — `support-services-dev` and `platform-services-dev`
4. **Deploy infrastructure** — NATS, Redis, PostgreSQL, Temporal via kustomize
5. **Deploy platform services** — all Knative services via kustomize
6. **Build images** — each service image is built with a dev Dockerfile that uses `bun --watch`
7. **Set up live sync** — file changes are synced directly into running containers

Open the Tilt UI at **http://localhost:10350** to monitor all resources.

### 3. Start the Minikube tunnel (separate terminal)

Kourier requires a LoadBalancer IP. In a second terminal:

```bash
minikube tunnel -p yoizen-arch
```

Keep this running while you develop. Services are accessible at `http://<service>.platform-services-dev.<MINIKUBE_IP>.sslip.io`.

## How It Works

### Environment

Tilt targets the `dev` environment by default. Override with:

```bash
TILT_ENV=qa tilt up
```

This changes the target namespaces to `support-services-qa` / `platform-services-qa` and uses the corresponding kustomize overlay.

### Image Builds

Every service gets a dev-optimized Docker image built from an inline Dockerfile:

- **Standard services** (api-gateway, auth-service, etc.) use `oven/bun:1.3-alpine` with `bun run --watch` for automatic restart on file changes
- **workflow-service** and **workflow-http-worker** use `oven/bun:1.3-debian` (Temporal requires glibc) and run a compiled build step

Images are tagged under the `dev.local/` prefix, which Knative is configured to skip tag-to-digest resolution for.

### Live Update (Hot Reload)

The standard services support live update — Tilt syncs changed files directly into the running container without rebuilding the image:

| Change | Behavior |
|--------|----------|
| Edit a file in `services/<svc>/src/` | Synced into the container; `bun --watch` restarts automatically |
| Edit a file in `packages/shared/src/` | Synced into the container; `bun --watch` restarts automatically |
| Edit `services/<svc>/package.json` | **Full image rebuild** (triggers `bun install`) |

The workflow services always do a full image rebuild since they require a compilation step.

### Resource Dependencies

Tilt enforces startup order to prevent services from crashing on missing infrastructure:

```
postgres ──────────┐
                   ├──> temporal ──> workflow-api, workflow-worker, workflow-http-worker
nats ──────────────┤
                   ├──> api-gateway, event-processor, audit-service, webhook-service, metrics-service
redis ─────────────┤
                   ├──> api-gateway, auth-service, cache-service, event-processor
                   │
postgres ──────────┴──> auth-service, audit-service, metrics-service, registry-service, scheduler-service
```

### Port Forwards

| Service | Local Port | Container Port |
|---------|-----------|----------------|
| api-gateway | `localhost:3000` | 3000 |

The API Gateway is the only service with a port forward since it acts as the single entry point.

## Common Workflows

### Developing a single service

Edit files under `services/<service-name>/src/`. Tilt detects the change, syncs it into the container, and `bun --watch` restarts the process. Check the Tilt UI or logs for errors:

```bash
tilt logs -f <service-name>
```

### Adding a new dependency

After modifying `package.json`, Tilt triggers a full image rebuild for that service. No manual intervention needed.

### Viewing logs

```bash
# All services
tilt logs -f

# Specific service
tilt logs -f api-gateway

# Infrastructure
tilt logs -f nats
tilt logs -f postgres
```

Or use the Tilt UI at http://localhost:10350 for a visual log viewer.

### Restarting a single service

From the Tilt UI, click the restart button on the resource. Or via CLI:

```bash
tilt trigger <service-name>
```

### Checking service health

```bash
# Knative services
kubectl get ksvc -n platform-services-dev

# Pods
kubectl get pods -n platform-services-dev
kubectl get pods -n support-services-dev

# Detailed service status
kubectl describe ksvc api-gateway -n platform-services-dev
```

### Running E2E tests against Tilt

With Tilt running and the tunnel active:

```bash
cd tests/e2e
bun install
API_GATEWAY_URL=http://localhost:3000 bun test
```

## Services

| Service | Image | Type | Description |
|---------|-------|------|-------------|
| api-gateway | `dev.local/api-gateway` | Standard | HTTP entry point, JWT auth, dynamic routing |
| auth-service | `dev.local/auth-service` | Standard | JWT tokens, user/client management |
| audit-service | `dev.local/audit-service` | Standard | NATS consumer, per-tenant event persistence |
| cache-service | `dev.local/cache-service` | Standard | L1/L2 cache API |
| event-processor | `dev.local/event-processor` | Standard | NATS consumer, enrichment pipeline |
| metrics-service | `dev.local/metrics-service` | Standard | NATS consumer, per-tenant metrics |
| registry-service | `dev.local/registry-service` | Standard | Service registry, canary deployments |
| scheduler-service | `dev.local/scheduler-service` | Standard | Cron/interval/one-time job scheduling |
| tenant-service | `dev.local/tenant-service` | Standard | Namespace + PostgreSQL provisioning |
| webhook-service | `dev.local/webhook-service` | Standard | HTTP callback delivery with retry |
| workflow-service | `dev.local/workflow-service` | Compiled | Temporal workflow API + worker |
| workflow-http-worker | `dev.local/workflow-http-worker` | Compiled | Temporal HTTP activity worker |

**Standard** services use `bun --watch` with live sync. **Compiled** services run `bun run build` and require a full image rebuild on change.

## Troubleshooting

### Knative services stuck in `Unknown` or `ContainerCreating`

Infrastructure may not be ready. Check pod status:

```bash
kubectl get pods -n support-services-dev
```

Wait for NATS, Redis, PostgreSQL, and Temporal to be `Running` before the platform services can start. Tilt manages this via `resource_deps`, but first-time cold starts can be slow.

### Image pull errors (`ErrImageNeverPull`)

Make sure your Docker context points to Minikube's daemon:

```bash
eval $(minikube docker-env -p yoizen-arch)
```

Tilt handles this automatically, but if you see pull errors after a Minikube restart, run `tilt down && tilt up`.

### Port 3000 already in use

Another process is using port 3000. Kill it or change the port forward in the Tiltfile.

### Live sync not working

If file changes are not reflected in the running service:

1. Check the Tilt UI for sync errors
2. Verify the file is under `services/<svc>/src/` or `packages/shared/src/`
3. Changes to `package.json` intentionally trigger a full rebuild (not a sync)

### Out of memory / pods evicted

The Minikube profile is configured for 16GB RAM. If pods are evicted, check resource usage:

```bash
kubectl top pods --all-namespaces
minikube ssh -p yoizen-arch -- free -h
```

Consider running only the `dev` environment or increasing Minikube memory.

### Tilt is slow to start

The first run builds all images from scratch. Subsequent runs use Docker layer caching and are significantly faster. If `tilt up` hangs, check that the Minikube profile is running:

```bash
minikube status -p yoizen-arch
```

## Stopping

```bash
# Stop Tilt (keeps resources running in the cluster)
# Press Ctrl+C in the Tilt terminal

# Tear down all Tilt-managed resources
tilt down

# Stop Minikube entirely
minikube stop -p yoizen-arch
```
