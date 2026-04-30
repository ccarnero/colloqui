# Delta Specification: adapter-service-autoscaling

## Purpose

Autoscaling behavior of the `adapter-service-worker` workload introduced
by the topology split. The worker MUST scale on backlog of the
`adapter-internal-sync` durable across all per-tenant ingress streams,
including scale-to-zero in non-prod overlays. This avoids paying for
idle capacity while still guaranteeing eventual mirror materialization
when registry events are emitted.

## ADDED Requirements

### REQ-ASA-001: KEDA-driven autoscaling of the worker workload

**Priority**: P0 (Critical)

The system MUST autoscale `adapter-service-worker` via a KEDA
`ScaledObject` that targets the worker workload (and only the worker —
not the api). The scaler MUST be the sole authority for replica count of
the worker in non-prod overlays.

#### Scenario: ScaledObject targets only the worker

- GIVEN both api and worker workloads are deployed
- WHEN the cluster reconciles autoscaling
- THEN the `ScaledObject` MUST reference the worker workload only
- AND no `ScaledObject` MUST target the api workload

#### Scenario: Manual replica overrides are reasserted

- GIVEN an operator manually scales the worker outside of KEDA
- WHEN KEDA next reconciles
- THEN the replica count MUST be brought back into the
  `[minReplicaCount, maxReplicaCount]` range computed from the metric
- AND the override MUST not persist across the next reconcile tick

#### Scenario: Scaler config invalid (error)

- GIVEN a malformed `ScaledObject` (missing trigger, invalid query, etc.)
- WHEN it is applied to the cluster
- THEN KEDA MUST refuse to scale the worker (status not `Active`)
- AND the misconfiguration MUST be observable via cluster events
- AND the worker workload's prior replica count MUST remain unchanged
  while the config is invalid (no implicit scale-down)

### REQ-ASA-002: Backlog signal aggregated across tenants via Prometheus

**Priority**: P0 (Critical)

The scaler MUST use Prometheus as the backlog signal source, aggregating
the `adapter-internal-sync` durable's pending and ack-pending counts
across all per-tenant streams into a single scalar:

```
sum(jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"})
+
sum(jetstream_consumer_num_ack_pending{consumer_name="adapter-internal-sync"})
```

This avoids unbounded `ScaledObject` cardinality (one durable per tenant
× N tenants) and matches the platform's existing pattern for
multi-tenant durables.

#### Scenario: Backlog grows on a single tenant

- GIVEN tenants `acme` and `globex` both have durables
- WHEN registry publishes a burst of events for `acme` only
- THEN `num_pending` for `acme`'s durable rises
- AND the aggregated query value rises accordingly
- AND the scaler MUST see the elevated metric and react

#### Scenario: Backlog grows on multiple tenants

- GIVEN multiple tenants accumulate backlog simultaneously
- WHEN the scaler polls Prometheus
- THEN the metric MUST be the **sum** across all tenants (not the max,
  not per-tenant)
- AND scale-up decisions MUST reflect total platform-wide backlog

#### Scenario: Prometheus unavailable (error)

- GIVEN Prometheus is unreachable from the KEDA operator
- WHEN the scaler polls
- THEN the scaler MUST treat the poll as a failure (not as zero backlog)
- AND it MUST NOT scale the worker down to 0 solely because of the
  failed poll
- AND the failure MUST be observable in cluster events

#### Scenario: Query returns NaN / no data (error)

- GIVEN Prometheus is up but the query has no series (e.g. no durable
  has ever been bound yet)
- WHEN the scaler polls
- THEN the scaler MUST handle the empty result deterministically (treat
  as zero backlog OR honor activation threshold), not as a faulted state
- AND no spurious scale event MUST occur

### REQ-ASA-003: Scale-to-zero with activation from cold

**Priority**: P0 (Critical)

The system MUST allow the worker to scale to **0** replicas when there
is no backlog, and MUST be able to scale back **up from 0** when backlog
appears, without requiring any always-on adapter-service-worker pod.

`minReplicaCount` MUST be `0`. The activation threshold MUST be `0`
(any nonzero backlog activates the workload).

#### Scenario: Steady idle → scale to 0

- GIVEN no tenant durable has any pending or ack-pending messages for a
  sustained interval
- WHEN the scaler reconciles
- THEN the worker MUST be scaled to 0 replicas
- AND the api workload MUST be unaffected

#### Scenario: Cold-start activation

- GIVEN the worker is at 0 replicas
- WHEN any tenant durable accumulates ≥1 pending message
- THEN the scaler MUST scale the worker up from 0
- AND processing MUST begin once the new replica passes `/readyz`

#### Scenario: Backlog metric requires durable to exist while at 0 replicas

- GIVEN the worker is at 0 replicas
- AND no pod is currently bound to tenant durables
- WHEN registry publishes a new event for a tenant
- THEN the durable's `num_pending` series MUST still be observable to
  Prometheus (so the scaler can react)
- AND the scale-up MUST follow per the activation scenario above

### REQ-ASA-004: Bounded maximum replicas

**Priority**: P1 (High)

`maxReplicaCount` MUST be set to a finite, sensible value (e.g. 3 in
non-prod) so a runaway backlog cannot overwhelm downstream resources
(mirror DB, broker fetch concurrency). The exact value MUST be
configurable per overlay.

#### Scenario: Sustained large backlog

- GIVEN backlog vastly exceeds `maxReplicaCount × threshold`
- WHEN the scaler reconciles
- THEN the worker MUST scale up to `maxReplicaCount`, not beyond
- AND the cluster MUST NOT exhaust resources due to unbounded scaling

#### Scenario: Per-overlay max override

- GIVEN a non-prod overlay sets `maxReplicaCount=3` and a hypothetical
  prod overlay sets a different value
- WHEN each overlay is applied
- THEN each cluster MUST honor its overlay's `maxReplicaCount`

### REQ-ASA-005: Drain-safe scale-down via cooldown

**Priority**: P0 (Critical)

The scaler MUST give the worker enough time to drain in-flight messages
before scaling replicas down. `cooldownPeriod` MUST be set so that
scale-down does not occur the moment backlog hits zero — instead, the
worker MUST stay alive for at least `cooldownPeriod` after the metric
reports zero, so any redelivery or late delivery is handled hot rather
than provoking another cold start.

#### Scenario: Cooldown after backlog drains

- GIVEN the metric just transitioned from nonzero to zero
- WHEN the scaler reconciles
- THEN the worker MUST remain at ≥1 replica for at least the configured
  `cooldownPeriod`
- AND if any new backlog appears within that window, no cold start MUST
  be required

#### Scenario: Cooldown elapses with no new backlog

- GIVEN the cooldown period elapses with backlog still at zero
- WHEN the scaler reconciles
- THEN the worker MUST be scaled to 0 replicas (per REQ-ASA-003)

#### Scenario: In-flight messages outlive cooldown (error edge)

- GIVEN cooldown is shorter than the worst-case message processing time
- WHEN the scaler attempts to scale down
- THEN the worker's graceful-shutdown contract (REQ-AST/ASIS) MUST drain
  or `nak` in-flight messages
- AND no message MUST be silently lost or silently ack'd
- AND operators MUST be able to observe the event via metrics

### REQ-ASA-006: Polling interval bounds reaction latency

**Priority**: P1 (High)

`pollingInterval` MUST be set so that the scaler reacts to new backlog
within a bounded latency budget (e.g. ~30s default), and MUST be
configurable per overlay so tighter SLOs can be supported elsewhere on
the platform.

#### Scenario: Default polling interval

- GIVEN the default overlay configuration
- WHEN backlog appears at time `t`
- THEN the scaler MUST observe and react no later than
  `t + pollingInterval`

#### Scenario: Overlay tightens polling

- GIVEN an overlay sets a tighter `pollingInterval`
- WHEN it is applied
- THEN the scaler MUST honor the overlay value, not the base value

## Non-Functional Requirements

### NFR-ASA-001: Cold-start latency budget

**Category**: Performance
**Priority**: P1 (High)

The system MUST scale up from 0 replicas and process the first message
within a bounded latency budget after the triggering publish.

- **Metric**: time from `service.upserted.v1` publish-ack to the
  corresponding mirror row being visible to readers, measured with the
  worker starting at 0 replicas
- **Target**: ≤ 90s p95 (cold start)
- **Measurement**: end-to-end timestamps, captured during the
  cold-start chaos drill referenced in the proposal Success Criteria

### NFR-ASA-002: Scale-down latency after drain

**Category**: Performance
**Priority**: P2 (Medium)

The system SHOULD return to 0 replicas promptly after backlog reaches
zero, to honor the scale-to-zero economic goal.

- **Metric**: time from "metric reports zero" to "worker at 0 replicas"
- **Target**: ≤ 5 minutes p95 (covering cooldown + KEDA poll cycles)
- **Measurement**: cluster event timeline correlated with Prometheus
  series

### NFR-ASA-003: Autoscaler observability

**Category**: Observability
**Priority**: P2 (Medium)

The autoscaling decisions MUST be observable to operators.

- **Metric**: `ScaledObject` status (`Active`/`Inactive`), current
  metric value, current replica count, last scale event timestamp
- **Target**: all four signals MUST be discoverable via standard
  cluster tooling without needing to read KEDA operator logs
- **Measurement**: smoke check against the cluster after deploy

## Cross-Cutting Non-Functional Requirements

These NFRs apply to the change as a whole and complement the
domain-specific NFRs above.

### NFR-XC-001: Reliability — zero loss under chaos

**Category**: Reliability
**Priority**: P0 (Critical)

Under a controlled chaos test where the worker is killed during the
publish window, **zero** `service.upserted.v1` events MUST be lost.
This is achieved by the combination of at-least-once delivery
(`adapter-service-internal-sync`) and idempotent sink writes.

- **Metric**: count of mirror rows after recovery vs count of
  successfully published events
- **Target**: 100% match
- **Measurement**: chaos drill in non-prod with deterministic publish
  set, asserting equality post-recovery

### NFR-XC-002: Performance — end-to-end mirror latency

**Category**: Performance
**Priority**: P1 (High)

End-to-end latency from `POST /registry/services` to the mirror row in
`http_adapters` MUST stay within budget.

- **Metric**: wall-clock time from API response to mirror row visible
- **Target**: ≤ 5s p95 when the worker is hot, ≤ 90s p95 when the
  worker is cold
- **Measurement**: end-to-end latency probe in the staging environment

### NFR-XC-003: Observability — per-durable telemetry

**Category**: Observability
**Priority**: P0 (Critical)

Each per-tenant durable MUST emit telemetry sufficient to operate the
flow per tenant.

- **Metric**: message count, ack rate, redeliver count, processing
  duration histogram, in-flight count — labeled by tenant and durable
- **Target**: every delivery accounted for in exactly one outcome
  bucket; redeliveries observable; per-tenant slicing available
- **Measurement**: Prometheus + dashboards aligned with the existing
  multi-tenant durable observability story (audit, event-processor,
  webhook, workflow)
