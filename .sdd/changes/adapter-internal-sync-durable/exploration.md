# Exploration: adapter-internal-sync-durable

> Make the `registry-service → adapter-service` internal-sync flow durable
> and scale-to-zero–safe by replacing the Core-NATS subscription with a
> JetStream pull consumer + KEDA-driven `*-worker` deployment.

## Current State

`registry-service` publishes service lifecycle events via Core NATS:

- Publisher uses `conn.publish(...)` (no JetStream `js.publish`) to subject
  `evt.<tenant>.registry-service.platform.service.system.<upserted|deleted>.v1`
  (`services/registry-service/src/modules/services/service-events.publisher.ts:88-148`).
- The `nats.provider` for registry-service is intentionally a "pure
  producer" and does NOT call `ensureTenantIngressStream`
  (`services/registry-service/src/providers/nats.provider.ts:15-22`).

`adapter-service` consumes the same wildcard via Core NATS `nc.subscribe`,
not JetStream:

- `INTERNAL_SYNC_SUBJECT_PATTERN = "evt.*.registry-service.platform.service.system.*.v1"`
  with queue group `adapter-internal-sync`
  (`services/adapter-service/src/modules/internal-sync/internal-sync.service.ts:36-75`).
- No durable consumer, no replay, no DLQ.

Both services are Knative Services scaled to zero in non-prod overlays:

- `knative/services/base/registry-service.yaml:1-18` (kind: Service).
- `knative/services/base/adapter-service.yaml:1-16` (kind: Service).
- `knative/services/overlays/_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml:88-110`
  pins `min-scale: "0"` on both.
- `knative/services/base/scaledobjects/kustomization.yaml` does NOT list
  any `adapter-service` ScaledObject, and adapter-service has no `*-worker`
  Deployment counterpart.

Idempotency of the sink is already established: `AdaptersRepository.upsertMirror`
performs a `SELECT … LIMIT 1` then either `UPDATE` or `INSERT`, guarding by
`managed_by` (`services/adapter-service/src/modules/adapters/adapters.repository.ts:251-305`).
`deleteMirrorByServiceName` is also idempotent (no-op when absent).
=> **Redelivery is safe** under at-least-once semantics.

Per-tenant `INGRESS-<TENANT>` streams already exist (subjects `evt.<tenant>.>`)
created lazily by `api-gateway`/`channel-service`/`event-processor` via
`ensureTenantIngressStream` (e.g., `services/api-gateway/src/providers/nats.provider.ts:25-52`,
`services/channel-service/src/providers/nats.provider.ts:35-74`,
`services/event-processor/src/providers/nats.provider.ts:42-59`). When such a
stream is already provisioned by another emitter, **a Core publish from
`registry-service` IS captured by JetStream** (the stream binds the subject
filter at the broker level). When it is not yet provisioned, the event is
lost — exactly the gap the offline `backfill-internal-mirrors.ts` exists to
patch.

Failure mode under scale-to-zero: when `adapter-service` has zero replicas
at publish time AND the `INGRESS-<TENANT>` stream is missing OR does not
get drained later (because the only consumer is a Core subscription),
the event never reaches the mirror. There is no KEDA scaler today —
`adapter-service` has no signal to wake from zero on registry events.

### Affected Areas

- `services/registry-service/src/modules/services/service-events.publisher.ts:81-166`
  — switch from Core publish to JetStream-aware publish; ensure target
  stream exists before publish.
- `services/registry-service/src/providers/nats.provider.ts:1-35`
  — add stream-ensure logic (currently empty `streams: []`).
- `services/adapter-service/src/modules/internal-sync/internal-sync.service.ts:36-83`
  — replace `nc.subscribe` with JetStream durable pull consumer.
- `services/adapter-service/src/modules/internal-sync/internal-sync.module.ts:1-16`
  — wire `MultiTenantConsumerManager` (or a single-stream variant) and
  inject `JETSTREAM_MANAGER` / `JETSTREAM_PUBLISHER`.
- `services/adapter-service/src/main.ts` (and `app.module.ts`)
  — adopt the split `*-api`/`*-worker` bootstrap (`bootstrapSplitService`),
  guard consumer wiring with `isWorkerMode()`.
- `knative/services/base/adapter-service.yaml` → split into
  `adapter-service-api.yaml` (Knative Service) + `adapter-service-worker.yaml`
  (apps/v1.Deployment, mirrored on `services/audit-service-worker.yaml`).
- `knative/services/base/scaledobjects/adapter-service-worker.yaml` (NEW)
  + `kustomization.yaml` (resources update).
- `knative/services/overlays/_components/scale-to-zero-non-prod/keda-scale-to-zero.yaml`
  — patch new ScaledObject `minReplicaCount: 0` / `idleReplicaCount: 0`.
- `knative/services/overlays/_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml`
  — `adapter-service-api` `min-scale: "0"` (replace today's
  `adapter-service` block).
- `services/adapter-service/AGENTS.md` and the offline backfill script
  (kept as a recovery tool, not the steady-state path).

### Key Technical Constraints (evidence-backed)

1. **`NatsConsumerRunner` is the canonical durable harness**
   (`packages/database/src/nats-consumer-runner.ts:131-489`): explicit ack
   policy (server-side: `AckPolicy.Explicit`, `DeliverPolicy.All`,
   `ReplayPolicy.Instant` with default `ack_wait=60s` and bounded `backoff`
   in `packages/database/src/nats-durable-consumer.ts:171-189`), supervised
   reattach loop, Permanent → `term()` + DLQ hook, healthy-state snapshot
   for `/readyz`. New consumers SHOULD use this (or
   `MultiTenantConsumerManager`) instead of bespoke loops — see
   `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:42-98`
   as the reference shape for a tenant-stream durable.

2. **JetStream forbids subject overlap across streams.** Confirmed by
   `nats-server` issues `#2144` and `#7120`: "Streams are not allowed to
   listen to the same subjects as other streams" (`mirror`/`source` are
   the supported escape hatch). With `INGRESS-<TENANT>` already filtering
   `evt.<tenant>.>`, a hypothetical `INGRESS-REGISTRY` filtering
   `evt.*.registry-service.platform.service.system.*.v1` overlaps on
   every tenant subject. JetStream WILL reject `streams.add` for it.

3. **KEDA cannot scale Knative Services.** From `infrastructure/base/keda/README.md:67-93`:
   `serving.knative.dev/v1.Service` does not expose `/scale`; the platform
   pattern is to split each event-driven service into `*-api` (Knative)
   + `*-worker` (`apps/v1.Deployment`) with a single `ScaledObject` on the
   worker. This is mandatory for any KEDA path on `adapter-service`.

4. **KEDA scaler choice.** Repo convention is `prometheus` triggers reading
   `jetstream_consumer_num_pending + num_ack_pending{consumer_name="<durable>"}`,
   NOT the native `nats-jetstream` scaler. Rationale (per the KEDA README):
   one durable per tenant stream → unbounded ScaledObject cardinality with
   the native scaler. Examples: `audit-service-worker.yaml`. Any new
   ScaledObject SHOULD follow this aggregation pattern; activation from
   zero already works through Prometheus `activationThreshold: "0"`.

5. **`registry-service` is a Knative Service** scaled to zero
   (min-scale=0). Stream creation logic baked into the publisher path
   still works because the publish itself wakes the pod, but ensure-on-
   boot from a non-existent replica is impossible. `ensureTenantIngressStream`
   from `@yoizen/database` (or its current per-service copies) is the
   correct, idempotent on-publish hook. Centralising it into a shared
   `ensureTenantIngressStream` exported from `@yoizen/database` is a
   sub-task.

## Approaches

### Option A — Cross-tenant aggregate stream `INGRESS-REGISTRY`

Create a single JetStream stream filtering
`evt.*.registry-service.platform.service.system.*.v1`. One durable
`adapter-internal-sync` on it; one ScaledObject; no per-tenant fan-out.

- **Blocker**: subject overlap with every existing `INGRESS-<tenant>` —
  JetStream rejects creation (`subjects overlap with an existing stream`,
  err 10065). Confirmed by `nats-server#2144` and `#7120`. Would force
  carving registry events out of `evt.<tenant>.>` (subject-namespace
  surgery) or deleting tenant streams — not viable.
- Pros: simplest consumer wiring, single ScaledObject.
- Cons: requires changing the canonical 8-token subject for registry
  events OR redesigning the tenant-stream subject filter (huge blast
  radius across api-gateway, channel-service, event-processor, audit,
  workflow-service, webhook). Conflicts with `wdocs 02 §3` envelope
  contract.
- Effort: **L–XL** (touches every emitter/consumer of `evt.*` subjects).

### Option B — Reuse per-tenant `INGRESS-<TENANT>` streams + multi-tenant durable

Use the existing tenant streams as-is. Bind one durable consumer per
tenant via `MultiTenantConsumerManager` (the same harness that powers
`workflow-triggers`, `channel-egress`, `audit-events`, etc.). Subject
filter on each durable: `evt.<tenant>.registry-service.platform.service.system.*.v1`
(or use a shared `filterSubject` `evt.*.registry-service.platform.service.system.*.v1`
since each durable is already scoped to a single tenant stream).
`registry-service` pre-publish ensures `INGRESS-<tenant>` exists via
shared `ensureTenantIngressStream` (existing copies live in api-gateway /
channel-service / event-processor — promote one to `@yoizen/database`).

- **Aligns 1:1 with the canonical platform pattern** (every other durable
  in the repo follows this shape — `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:72-92`,
  `services/audit-service/src/modules/audit/audit.service.ts`,
  `services/channel-service/src/modules/egress/send-command-consumer.service.ts`).
- KEDA: one ScaledObject targeting `adapter-service-worker` with a
  Prometheus trigger aggregating across all per-tenant
  `adapter-internal-sync` durables (sum of `num_pending + num_ack_pending`).
  Pattern proven by `event-processor-worker.yaml` and `audit-service-worker.yaml`.
- Wake-from-zero: `*-api` pods run `ensureOnly: true` on every reconcile
  tick (`MultiTenantConsumerManager.ensureOnly = true`,
  `packages/database/src/multi-tenant-consumer-manager.ts:82-96, 274-277`)
  so Prometheus has the metric series even when the worker is at 0
  replicas — KEDA can scale up from cold.
- Replay/redelivery: `DeliverPolicy.All` + `max_deliver=DEFAULT_MAX_DELIVER`
  + bounded backoff already implemented; `upsertMirror` is idempotent.
- Pros: zero subject-namespace changes, reuses every primitive already
  shipped, identical ops/observability story to seven other services.
- Cons: registry-service must call `ensureTenantIngressStream` per publish
  (one extra JSAPI roundtrip on first call per tenant — cached after);
  durable count grows with tenant count (bounded by tenant count, same
  as every other durable).
- Effort: **M**.

### Option C — Hybrid (Option B + auxiliary aggregate via `sources`)

Same as Option B for persistence, plus a derived stream
`INGRESS-REGISTRY-AGG` using JetStream `sources` to mirror registry
subjects from each `INGRESS-<TENANT>` (sources don't subscribe to
subjects — they replicate from existing streams, sidestepping the
overlap rule per `nats-server#2144` thread).

- Pros: single durable / single ScaledObject on the aggregate stream.
- Cons: sources reconciliation is complex with hot tenant onboarding
  (must add a new source on every new tenant — a moving target). Tenant
  isolation is partially weakened (one shared aggregate stream). Adds
  storage cost (events stored twice). Operationally novel for this
  platform; no precedent. Worse: sources are eventually-consistent — adds
  another lag dimension before the mirror upsert.
- Effort: **L** (and ongoing operational cost on every new tenant).

### Option D — Source-based aggregation only

Like the user-suggested Option D: leave `INGRESS-<TENANT>` for tenant
data, create `INGRESS-REGISTRY` via `sources` only (no direct subjects).
Adapter consumes only the aggregate.

- Pros: single durable.
- Cons: same operational challenge as Option C — sources list grows
  monotonically with tenants and must be reconciled on tenant
  provisioning; eventual consistency between source and aggregate adds
  lag the platform doesn't otherwise have for `evt.*`. No precedent in
  the codebase. Doesn't simplify KEDA materially over Option B (still
  Prometheus trigger).
- Effort: **L**.

## Decision Matrix

Scoring rule: favorable = 3 × weight, neutral = 2 × weight, unfavorable = 1 × weight.

| Criteria (Weight) | A (cross-tenant subject) | B (per-tenant durables, MTC) | C (B + sources hybrid) | D (sources only) |
|---|---|---|---|---|
| JetStream subject-overlap risk (3) | Unfavorable → 3 | Favorable → 9 | Favorable → 9 | Favorable → 9 |
| Alignment with existing patterns (3) | Unfavorable → 3 | Favorable → 9 | Neutral → 6 | Unfavorable → 3 |
| Operational simplicity (3) | Neutral → 6 (if it worked) | Favorable → 9 | Unfavorable → 3 | Unfavorable → 3 |
| Scale-to-zero compatibility (KEDA) (3) | Favorable → 9 | Favorable → 9 | Favorable → 9 | Favorable → 9 |
| Multi-tenant correctness / isolation (2) | Neutral → 4 | Favorable → 6 | Neutral → 4 | Neutral → 4 |
| Blast radius / migration cost (2) | Unfavorable → 2 | Favorable → 6 | Neutral → 4 | Neutral → 4 |
| Observability story (1) | Neutral → 2 | Favorable → 3 | Neutral → 2 | Neutral → 2 |
| Implementation complexity (1) | Unfavorable → 1 | Favorable → 3 | Unfavorable → 1 | Unfavorable → 1 |
| **Total** | **30** | **54** | **38** | **35** |

## Recommendation

**Adopt Option B — per-tenant durable consumers via `MultiTenantConsumerManager`,
plus the `*-api` / `*-worker` split with a Prometheus-backed KEDA `ScaledObject`.**

Rationale:

- **Highest matrix score (54)** and the only option that does not require
  re-shaping the canonical `evt.<tenant>.>` subject namespace or
  introducing a JetStream construct (`sources`) the platform has never
  used.
- It composes three primitives that already exist and are well-exercised
  in production:
  1. `ensureTenantIngressStream` (proven by api-gateway/channel-service/event-processor).
  2. `MultiTenantConsumerManager` + `NatsConsumerRunner` (proven by seven
     other durable consumers).
  3. `*-api` / `*-worker` Knative Service + KEDA Deployment split (proven
     by audit/event-processor/webhook/workflow/usage-aggregator).
- Idempotency of `AdaptersRepository.upsertMirror` and
  `deleteMirrorByServiceName` makes at-least-once delivery safe today,
  without code changes to the sink layer.
- Scale-to-zero works correctly because `*-api` runs the manager in
  `ensureOnly: true` mode (does NOT consume) so the Prometheus
  `jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"}`
  series is populated on every tenant stream even with zero workers —
  breaking the cold-start chicken-and-egg problem
  (`packages/database/src/multi-tenant-consumer-manager.ts:82-96, 240-256`).

### Concrete shape (recommended, for downstream sdd-design)

1. **registry-service publisher** → switch from `nc.publish` to
   JetStream-aware publish:
   - Inject `JETSTREAM` (`JetStreamClient`) and `JETSTREAM_MANAGER`.
   - Call `ensureTenantIngressStream(jsm, tenantId)` (promoted to
     `@yoizen/database`) immediately before publish.
   - Use `js.publish(subject, bytes, { headers, msgID: idempotencykey })`
     to get JetStream-native dedup (`Nats-Msg-Id` is already set, but
     `msgID` makes the dedup explicit — see
     `packages/database/src/multi-tenant-consumer-manager.ts:347-358`).
   - Keep the `REGISTRY_EMIT_ADAPTER_SYNC` feature flag for safe rollout.

2. **adapter-service consumer** → replace `nc.subscribe` with:
   ```ts
   const config: IMultiTenantConsumerConfig = {
     streamPattern: /^INGRESS-/,
     durableName: "adapter-internal-sync",
     filterSubject: "evt.*.registry-service.platform.service.system.*.v1",
     description: "registry-service → adapter mirror",
     metrics: createNatsConsumerMetrics(resolveServiceName("adapter-service")),
     runnerOptions: { concurrency: 4 }, // upsertMirror is DB-bound
     ensureOnly: !isWorkerMode(),
   };
   ```
   Inside the handler, parse the envelope and call the existing
   `handleUpserted` / `handleDeleted` paths verbatim — sink logic does
   not change.

3. **Knative split**: clone `services/audit-service-worker.yaml` →
   `adapter-service-worker.yaml` (`SERVICE_MODE=worker`), rename
   existing `adapter-service.yaml` to `adapter-service-api.yaml`
   (or keep current name; convention is `-api`).

4. **KEDA**: add `knative/services/base/scaledobjects/adapter-service-worker.yaml`
   modeled on `event-processor-worker.yaml`, trigger:
   ```yaml
   query: |
     sum(jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"})
     +
     sum(jetstream_consumer_num_ack_pending{consumer_name="adapter-internal-sync"})
   threshold: "100"
   activationThreshold: "0"
   ```
   Append to `kustomization.yaml` resources list.

5. **Overlays**: in `keda-scale-to-zero.yaml` patch
   `adapter-service-worker-scaler` to `minReplicaCount: 0`,
   `idleReplicaCount: 0`. In `knative-scale-to-zero.yaml` rename the
   `adapter-service` block to `adapter-service-api`.

6. **Backfill script** (`backfill-internal-mirrors.ts`) is retained as
   the one-shot disaster-recovery tool but is no longer the primary
   reconciliation path.

### Key Risks & Mitigations

- **Risk**: durable created on a stream that already has lots of
  unrelated history → `DeliverPolicy.All` would replay every event.
  - *Mitigation*: filter subject is narrow (`registry-service.platform.service.system.*`),
    historical volume on that filter is tiny (one row per `service.upsert`
    per tenant). If we want to cap, set `deliver_policy: New` on first
    deploy, then run the offline backfill once. Document the choice in
    `design.md`.
- **Risk**: `registry-service` Knative Service may be at 0 replicas at
  publish time, but a request triggers it → `ensureTenantIngressStream`
  must be on the publish hot path (idempotent, cached).
  - *Mitigation*: existing implementations cache via
    `Set<streamName>` (`services/api-gateway/src/providers/nats.provider.ts:25-52`);
    cost is amortised to a single JSAPI ping per pod cold-start per
    tenant.
- **Risk**: subject filter overlap between durables is fine (consumers
  on the same stream can share filter prefixes), but the filter must
  also be unique per consumer-name → confirmed: `MultiTenantConsumerManager`
  uses ONE durable name across many streams, never two on the same
  stream — no filter overlap.
- **Risk**: scale-up cold-start latency (KEDA poll 30s + container boot)
  delays mirror updates by ~30–60s. Acceptable per existing
  audit-service SLO. If tighter SLO required, set `pollingInterval: 15`
  like `event-processor-worker.yaml`.
- **Risk**: Knative split changes the readiness probe surface — worker
  pods need the minimal HTTP server from
  `packages/observability/src/worker-health-server.ts`. Already a known
  pattern (`bootstrap-split-service.ts`).

## Complexity Estimate

- **Scope**: M
- **Files affected**: ~12–16 (3 services, 4–6 manifests, 1 shared package
  promotion, 2 overlays, 1 module wiring, plus tests).
- **Risk level**: Medium (new durable, Knative topology change, but every
  primitive is in-tree and battle-tested).
- **Suggested SDD depth**: **Full pipeline (proposal → spec → design →
  tasks → apply → verify)**. The change spans three services, the
  Kubernetes topology, and the canonical messaging contract — deserves
  formal specs (especially for ordering/idempotency guarantees) and a
  design doc with a sequence diagram for the end-to-end flow including
  worker cold-start.

## Risks (consolidated)

- Stream subject overlap (mitigated by Option B).
- Replay storm on first deploy if `DeliverPolicy.All` is used on a
  populated stream (mitigated by `New` + offline backfill).
- KEDA cold-start latency (mitigated by Prometheus trigger pattern
  already used elsewhere).
- Worker readiness probe drift (mitigated by reusing
  `bootstrapSplitService` + `worker-health-server`).
- Rollout coupling: the publisher MUST start ensuring the stream BEFORE
  the consumer durable is created, or the durable's `DeliverPolicy.All`
  starts from a stream that is missing recent events (mitigated by
  rollout order: deploy registry change → run backfill → deploy
  adapter-service-worker → flip feature flag).

## Ready for Proposal

Yes. Recommended next step: `/sdd:propose adapter-internal-sync-durable`
to capture intent, scope, rollback plan and effort, then continue with
`/sdd:spec` and `/sdd:design` (full pipeline).
