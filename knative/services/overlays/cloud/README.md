# Cloud overlays — Phase 1: scale-to-zero

This tree implements **Phase 1** of the cost-efficiency plan: aggressive
scale-to-zero in non-prod cloud environments. Local minikube / orbstack
overlays under `knative/services/overlays/local/` apply the **same**
scale-to-zero policy via the shared kustomize components, so cold-start
behavior is identical between local and cloud.

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
off it without polluting the local overlays. As of Phase 1 the rendered
manifest of `cloud/<env>` is byte-identical to `local/<env>`.

## Scaling matrix

| Component                                | dev / qa                              | staging                            | production     |
|------------------------------------------|---------------------------------------|------------------------------------|----------------|
| `api-gateway`                            | min=1                                 | min=1                              | min=1 (base)   |
| Knative-only services [^1]               | min=0                                 | min=0                              | base unchanged |
| Mixed HTTP+NATS Knative services [^2]    | min=1 (KPA-managed, no scale-to-zero) | min=1                              | base unchanged |
| KEDA-managed Temporal workers [^3]       | KEDA min=0, idle=0, cooldown=300s     | KEDA min=0, idle=0, cooldown=300s  | base unchanged |

[^1]: `auth-service`, `cache-service`, `tenant-service`, `scheduler-service`,
      `proxy-service`, `registry-service`, `adapter-service`,
      `admin-console`, `messaging-console`, `yoizenclaw-admin-service`.

[^2]: `audit-service`, `event-processor`, `metrics-service`,
      `webhook-service`, `workflow-api`, `channel-service`,
      `usage-aggregator-service`. Each one **embeds an internal NATS
      durable consumer** in the same pod that serves HTTP. Scaling to
      zero would freeze message processing during HTTP idle (KPA only
      wakes the pod on HTTP traffic), so they stay at `min=1` under
      vanilla Knative KPA (`class=kpa`, `metric=concurrency`,
      `target=100`). KEDA cannot drive these: a Knative Service does
      not expose a `/scale` subresource, and KEDA's HPA shim refuses
      to attach.       Splitting each one into a Knative-hosted API +
      `apps/v1.Deployment` worker (KEDA-scaled on JetStream lag) is
      tracked as a follow-up; see "What is NOT in Phase 1" below.

[^3]: `workflow-worker`, `workflow-http-worker`. **Plain `apps/v1.Deployment`
      resources**, not Knative Services — KEDA cannot scale Knative
      Services because they don't expose a `/scale` subresource. Scaler
      type: `temporal` (queries `DescribeTaskQueue` for backlog count
      every 15s). Activation: `activationTargetQueueSize: "0"` (KEDA uses
      strictly greater-than semantics, so this means "wake on backlog ≥ 1").
      Long cooldown (300s) protects in-flight activities — Temporal
      workers hold up to 100/200 concurrent activity slots and a mid-run
      SIGTERM forfeits unacked tasks until heartbeat-timeout reassignment.
      Requires KEDA ≥ 2.18 (older versions don't ship the Temporal scaler).

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

## Cold-start contract

Temporal workers are **pull-based** rather than push-based: when scaled
to zero, no worker polls the task queue, but Temporal still records the
backlog. KEDA polls Temporal's `DescribeTaskQueue` API every 15s and
wakes the deployment as soon as backlog ≥ 1. Cold-start budget on
local/dev: ≈8-15s from `StartWorkflow` to first task picked up
(KEDA poll interval + container boot + Temporal worker registration).
The e2e suite warms `api-gateway` and tolerates this with a global
90s timeout (extended to 120-240s for adapter integration tests).

Knative-only services [^1] have no consumer state; cold start =
container boot (≈300ms with Bun + KPA pre-warm). KPA opens a TCP
connection from `activator` to the new pod as soon as it is ready,
so the first request after idle blocks until that handshake completes.

Mixed HTTP+NATS services [^2] never scale to zero, so they have no
cold-start path during steady state. They behave like every other
Knative-managed deployment for HTTP requests and run their durable
consumer continuously in the same pod. The trade-off is that the
minimum bill is `7 × min=1` pods per non-prod cluster — recovering
that capacity is the goal of the consumer-split follow-up.

## DX consideration for local

`api-gateway` stays warm (`min=1`) in every environment, including
`local/dev`, so the inner loop (save → reload) is not blocked by KPA
pre-warm. Backend services scale to zero — first request after idle
will pay the cold-start tax (≈5-15s). If you need a service warm for
heavy local development (e.g., debugging `auth-service`), patch it
ad-hoc with `kubectl annotate ksvc <name> autoscaling.knative.dev/min-scale=1 --overwrite`.

## What is NOT in Phase 1

- **Splitting mixed HTTP+NATS services** into a Knative-hosted API
  + KEDA-scaled `apps/v1.Deployment` consumer. Today these 7 services
  pay `min=1` per non-prod cluster because their HTTP and NATS
  workloads share a NestJS process. The split would let the API side
  scale to zero on KPA and the consumer side scale on JetStream lag
  via KEDA, but it requires a non-trivial refactor (per-service
  `app-api.module.ts` / `app-worker.module.ts`, two entry points,
  Dockerfile changes, env-driven mode selection, e2e fixture
  updates). Tracked as Phase 1.5.
- Spot / preemptible pools (removed from plan).
- Karpenter / Cluster Autoscaler tuning.
- Hybrid Postgres pools (Phase 2).
- Observability / NATS / Redis consolidation (Phase 3).
- Consumer merging (Phase 4).
- Image / registry optimization (Phase 5).
