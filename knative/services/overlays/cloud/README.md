# Cloud overlays — Phase 1 + Phase 1.5: scale-to-zero everywhere

This tree implements **Phase 1** (scale-to-zero for stateless services)
and **Phase 1.5** (split api ↔ worker for the 7 mixed HTTP+NATS services)
of the cost-efficiency plan. Local minikube / orbstack overlays under
`knative/services/overlays/local/` apply the **same** scale-to-zero
policy via shared kustomize components, so cold-start behavior is
identical between local and cloud.

## Layout

```
overlays/
├── _components/                       # shared kustomize Components
│   ├── scale-to-zero-non-prod/        # used by dev + qa
│   └── scale-to-zero-staging/         # used by staging (cooldown=300s)
├── local/
│   ├── dev/                           # composes scale-to-zero-non-prod
│   ├── qa/                            # composes scale-to-zero-non-prod
│   ├── staging/                       # composes scale-to-zero-staging
│   └── production/                    # base, no patches
└── cloud/
    ├── kustomization.yaml             # aggregator (build all envs at once)
    ├── dev/                           # = local/dev (re-applies same component)
    ├── qa/                            # = local/qa
    ├── staging/                       # = local/staging
    └── production/                    # = local/production
```

`cloud/<env>` exists as a separate root so future cloud-only patches
(e.g. cloud-managed Postgres connection strings in Phase 2) can hang
off it without polluting the local overlays.

## Phase 1.5: split api ↔ worker (single image, dual mode)

Seven services that previously embedded an HTTP router and one or more
NATS JetStream durable consumers in the same NestJS process were split:

| Logical service          | API pod (Knative Service, `min=0` non-prod) | Worker pod (Plain `apps/v1.Deployment`, KEDA) |
|--------------------------|---------------------------------------------|------------------------------------------------|
| `audit-service`          | `audit-service-api`                          | `audit-service-worker`                         |
| `channel-service`        | `channel-service-api`                        | `channel-service-worker`                       |
| `event-processor`        | `event-processor-api`                        | `event-processor-worker`                       |
| `metrics-service`        | `metrics-service-api`                        | `metrics-service-worker`                       |
| `usage-aggregator`       | `usage-aggregator-api`                       | `usage-aggregator-worker`                      |
| `webhook-service`        | `webhook-service-api`                        | `webhook-service-worker`                       |
| `workflow-service`       | `workflow-service-api`                       | `workflow-service-worker`                      |

Both pods share **the same Docker image**; the container differentiates
roles through `process.env.SERVICE_MODE` (`api` or `worker`):

- `bootstrapSplitService()` (in `@yoizen/observability`) selects the
  bootstrap path: `bootstrapFastifyApp` for `api`, `bootstrapWorkerApp`
  (Nest standalone context) for `worker`.
- Each NATS consumer's `onModuleInit` is guarded with
  `if (!isWorkerMode()) return;` so the API pod stays free of
  consumer-side I/O.
- `OTEL_SERVICE_NAME=<base>-<mode>` keeps Prometheus / Tempo / Loki
  partitioned per role.

KEDA targets the worker Deployments via `prometheus` triggers that
aggregate `jetstream_consumer_num_pending` +
`jetstream_consumer_num_ack_pending` per consumer name (canonical
durables: `audit-events`, `channel-egress`, `auto-reply`,
`event-processor`, `metrics`, `agg-INGRESS`, `agg-DLQ`,
`webhook-dispatcher`, `workflow-triggers`). Polling 30s,
`cooldownPeriod=180s`, `idleReplicaCount=0`. Non-prod overlays drop
`minReplicaCount` to 0 too.

## Scaling matrix

| Component                                | dev / qa                              | staging                            | production     |
|------------------------------------------|---------------------------------------|------------------------------------|----------------|
| `api-gateway`                            | min=1                                 | min=1                              | min=1 (base)   |
| Stateless HTTP services [^1]             | min=0                                 | min=0                              | base unchanged |
| `*-api` (Phase 1.5 split) [^2]           | min=0                                 | min=0                              | base unchanged |
| `*-worker` (Phase 1.5 split) [^3]        | KEDA min=0, idle=0, cooldown=180s     | KEDA min=0, idle=0, cooldown=300s  | base unchanged |
| KEDA-managed Temporal workers [^4]       | KEDA min=0, idle=0, cooldown=300s     | KEDA min=0, idle=0, cooldown=300s  | base unchanged |

[^1]: `auth-service`, `cache-service`, `tenant-service`, `scheduler-service`,
      `proxy-service`, `registry-service`, `adapter-service`,
      `admin-console`, `messaging-console`, `yoizenclaw-admin-service`.
      Cold-start ≈300ms (Bun) + KPA pre-warm.

[^2]: `audit-service-api`, `channel-service-api`, `event-processor-api`,
      `metrics-service-api`, `usage-aggregator-api`,
      `webhook-service-api`, `workflow-service-api`. Pure HTTP — no
      NATS consumers run in this pod (guarded by `isWorkerMode()`).
      Safe to scale to zero on KPA concurrency.

[^3]: `audit-service-worker`, `channel-service-worker`,
      `event-processor-worker`, `metrics-service-worker`,
      `usage-aggregator-worker`, `webhook-service-worker`,
      `workflow-service-worker`. **Plain `apps/v1.Deployment`** — KEDA
      cannot scale Knative Services because they don't expose a
      `/scale` subresource, and KEDA's HPA shim refuses to attach.
      Trigger: `prometheus` aggregating
      `jetstream_consumer_num_pending` + `_num_ack_pending` per
      durable. Activation threshold `0` so KEDA wakes on backlog ≥ 1.

[^4]: `workflow-worker`, `http-adapter`. Same Plain Deployment
      shape as the Phase 1.5 workers but driven by the `temporal`
      scaler (queries `DescribeTaskQueue` for backlog count every 15s).
      Activation: `activationTargetQueueSize: "0"` (KEDA uses strictly
      greater-than semantics, so this means "wake on backlog ≥ 1").
      Long cooldown (300s) protects in-flight activities. Requires
      KEDA ≥ 2.18 (older versions don't ship the Temporal scaler).

## Build / diff

```bash
kustomize build knative/services/overlays/local/dev
kustomize build knative/services/overlays/local/qa
kustomize build knative/services/overlays/local/staging
kustomize build knative/services/overlays/local/production

kustomize build knative/services/overlays/cloud/dev
kustomize build knative/services/overlays/cloud/qa
kustomize build knative/services/overlays/cloud/staging
kustomize build knative/services/overlays/cloud/production
```

All eight builds emit clean YAML (validated end-to-end in CI).

## Cold-start contract

Three flavors of pod, three different latency profiles:

1. **Stateless HTTP (`*-api` Phase 1.5 + the 10 single-pod KSVCs)** —
   KPA opens a TCP connection from `activator` to the new pod as soon
   as it is ready. First request after idle blocks until that handshake
   completes. Budget on cloud non-prod: 5-15s incl. image pull.

2. **NATS-driven workers (`*-worker` Phase 1.5)** — KEDA polls
   Prometheus every 30s. When backlog ≥ 1, the deployment scales to 1.
   First message can wait up to ≈30s + container boot ≈10s ≈ 40s p95.
   Acceptable because the durable persists pending+unacked counts
   server-side; nothing is lost.

3. **Temporal workers** — same shape as (2) but the scaler is
   `temporal` and pollInterval is 15s. Cold-start budget ≈8-15s.

The e2e suite warms `api-gateway` (preload `tests/e2e/warmup.ts` drives
the gateway aggregator to `status: ok`) and tolerates these with a
global 90s timeout (extended to 120-240s for adapter / workflow
integration tests).

## DX consideration for local

`api-gateway` stays warm (`min=1`) in every environment, including
`local/dev`, so the inner loop (save → reload) is not blocked by KPA
pre-warm. Every other service scales to zero — first request after idle
will pay the cold-start tax. If you need a service warm for heavy local
development (e.g., debugging `audit-service-api`), patch it ad-hoc with:

```bash
kubectl annotate ksvc audit-service-api \
  autoscaling.knative.dev/min-scale=1 --overwrite \
  -n platform-services-dev
```

## What is NOT in Phase 1 / 1.5

- **Hybrid Postgres pools** — tracked as Phase 2.
- **Observability / NATS / Redis consolidation** — tracked as Phase 3.
- **Consumer merging** (e.g., a single `consumer-runtime` pod that
  hosts `audit-writer` + `metrics-writer` + `usage-writer`) — tracked
  as Phase 4. Sensible only after measuring the real cost of the new
  `*-worker` deployments under steady-state idle.
- **Image / registry optimization** (distroless, buildx remote cache,
  ECR/GAR/ACR) — tracked as Phase 5.
- Spot / preemptible pools, Karpenter, Cluster Autoscaler tuning —
  removed from the plan.
