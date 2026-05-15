# KEDA — Kubernetes Event-driven Autoscaler

KEDA scales the Knative consumer services based on JetStream consumer
lag rather than HTTP concurrency (which is effectively always 0 on the
worker services). Installed once per cluster; ScaledObjects are owned
by each service under `knative/services/base/scaledobjects/`.

## Install (Helm)

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace \
  --version 2.18.3 \
  --set prometheus.metricServer.enabled=true \
  --set prometheus.operator.enabled=true
```

CRDs (`ScaledObject`, `TriggerAuthentication`, …) are bundled with the
chart. After install, verify:

```bash
kubectl get pods -n keda
kubectl get crd | grep keda
```

## Why Prometheus (not the native NATS JetStream scaler)?

The plan's target architecture is **one durable consumer per
*(stream, durableName)*** — i.e. one durable per tenant stream
(`INGRESS-<tenant>`) sharing the same durable name across tenants.
The built-in `nats-jetstream` scaler requires an exact stream name,
which means we'd need a ScaledObject per tenant × per consumer —
unbounded cardinality.

The Prometheus scaler aggregates across tenants in one expression:

```
sum(jetstream_consumer_num_pending{consumer_name="channel-egress"})
```

That's O(1) ScaledObjects per consumer-group regardless of the number
of tenants. The trade-off (polling latency) is acceptable because:

- KEDA polls Prometheus every 30 s by default (configurable)
- The JetStream NATS exporter already scrapes every 15 s
- Worst-case reactive lag is ~45 s, which is the same ballpark as
  `nats-jetstream` scaler polling anyway.

## Relationship with Knative Serving

### Consumer services (HTTP / event-driven)

Knative Services by default use KPA (`kpa.autoscaling.knative.dev`).
Consumer services that want HPA-style scaling set the HPA class and
scaling bounds:

```yaml
metadata:
  annotations:
    autoscaling.knative.dev/class: hpa.autoscaling.knative.dev
    autoscaling.knative.dev/min-scale: "1"
    autoscaling.knative.dev/max-scale: "20"
```

> **Caveat:** the `serving.knative.dev/v1.Service` resource does NOT
> expose the `/scale` subresource (the Knative `PodAutoscaler` /
> `Deployment` it spawns does). When KEDA's ScaledObject points at a
> Knative Service it logs `Target resource doesn't expose /scale
> subresource` and the trigger never fires. The `class=hpa` Knative
> annotation still spawns a CPU-based HPA on the underlying Deployment,
> which IS what scales those services today — the JetStream / Prometheus
> triggers in `scaledobjects/*.yaml` are currently decorative for the
> Knative-targeted ScaledObjects (audit / metrics / webhook /
> event-processor / channel / workflow-api / usage-aggregator). Tracked
> as a follow-up: convert those triggers to target the underlying
> Deployment by name, OR migrate the consumers to plain Deployments
> like the Temporal workers (next section).

### Temporal workers (pull-based, no inbound HTTP)

`workflow-worker` and `connector-runtime` are plain
`apps/v1.Deployment` resources, NOT Knative Services. KPA's
HTTP-driven scale-from-zero is irrelevant to a Temporal worker (gRPC
long-poll, no incoming HTTP). KEDA's `temporal` scaler (added in
KEDA 2.17) drives their replicas based on `workflow-orchestrator` /
`connector-runtime` task-queue depth — see
`knative/services/base/scaledobjects/workflow-worker.yaml` and
`knative/services/base/scaledobjects/connector-runtime.yaml`
for the trigger spec. Because the target is a plain Deployment,
`/scale` is exposed natively and KEDA scales them directly (no HPA
ownership transfer dance needed).

KEDA must be 2.17 or higher for the Temporal scaler to be available
(`KEDAScalerFailed: no scaler found for type: temporal` on older
versions). The `bootstrap-*.sh` scripts pin `KEDA_VERSION="2.18.3"`.

## Multi-consumer services

Some services host more than one durable (e.g. `channel-service` owns
both `channel-egress` and `auto-reply`; `audit-service` owns both
`gateway-audit` and `channel-audit`). The pattern is: one ScaledObject
per **service** with **multiple triggers** — KEDA scales the service to
the `max()` of all trigger decisions. This avoids multiple ScaledObjects
fighting over the same workload.

## Reference example: `adapter-service-worker`

Owns the `adapter-internal-sync` durable per tenant on each
`INGRESS-<TENANT>` stream. The worker is a plain `apps/v1.Deployment`,
so KEDA scales it directly via `/scale` (no Knative-HPA dance):

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: adapter-service-worker-scaler
spec:
  scaleTargetRef:
    kind: Deployment
    name: adapter-service-worker
  pollingInterval: 30
  cooldownPeriod: 120
  idleReplicaCount: 0
  minReplicaCount: 1
  maxReplicaCount: 3
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.support-services-dev.svc.cluster.local:9090
        metricName: adapter_internal_sync_backlog
        threshold: "100"
        activationThreshold: "0"
        query: |
          sum(jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"}) +
          sum(jetstream_consumer_num_ack_pending{consumer_name="adapter-internal-sync"})
```

### Cold-start interlock — `ensureOnly` on the api workload

`adapter-service` ships as **two workloads** with the same image:
`adapter-service-api` (Knative Service, `SERVICE_MODE=api`) and
`adapter-service-worker` (`apps/v1.Deployment`, `SERVICE_MODE=worker`).
The api pod constructs a `MultiTenantConsumerManager` with
`ensureOnly: !isWorkerMode()` — it **registers** the durable on every
reachable `INGRESS-<TENANT>` stream but never pulls messages. This
guarantees the JetStream `num_pending` metric is observable to
Prometheus even when the worker Deployment is at 0 replicas, breaking
the otherwise-classic cold-start chicken-and-egg (no consumer →
no metric → no scale-up trigger). The worker pod, when it eventually
runs with `ensureOnly: false`, drains the backlog with concurrency 4.

The `activationThreshold: "0"` means any non-zero backlog activates the
worker; `idleReplicaCount: 0` (overlay-patched in non-prod) lets it
scale all the way to zero. Cold-start budget is `~pollingInterval +
worker boot` ≈ 60–90s p95 (matches the audit-service-worker SLO).

> Cross-references:
> `knative/services/base/scaledobjects/adapter-service-worker.yaml`,
> `.sdd/changes/adapter-internal-sync-durable/specs/adapter-service-autoscaling.md`.
