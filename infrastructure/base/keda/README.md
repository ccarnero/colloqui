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
  --version 2.16.1 \
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

Knative Services by default use KPA (`kpa.autoscaling.knative.dev`).
Consumer services need the HPA class so KEDA can own their replica
count:

```yaml
metadata:
  annotations:
    autoscaling.knative.dev/class: hpa.autoscaling.knative.dev
    autoscaling.knative.dev/min-scale: "1"
    autoscaling.knative.dev/max-scale: "20"
```

The ScaledObject targets the Knative `Service` object; KEDA translates
this to an HPA against the underlying Deployment that Knative Serving
manages. The `min-scale` / `max-scale` Knative annotations act as hard
bounds; KEDA never overrides them.

## Multi-consumer services

Some services host more than one durable (e.g. `channel-service` owns
both `channel-egress` and `auto-reply`; `audit-service` owns both
`gateway-audit` and `channel-audit`). The pattern is: one ScaledObject
per **service** with **multiple triggers** — KEDA scales the service to
the `max()` of all trigger decisions. This avoids multiple ScaledObjects
fighting over the same workload.
