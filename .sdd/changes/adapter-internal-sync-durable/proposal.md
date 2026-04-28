# Proposal: Make adapter-service internal-sync durable and scale-to-zero–safe

## Intent

Hosted service creation does not materialize the connector mirror when `adapter-service` is scaled to zero in non-prod overlays. `registry-service` publishes service lifecycle events over **Core NATS** (`nc.publish`), and `adapter-service` consumes them via a **Core NATS queue subscription** (`nc.subscribe`, queue group `adapter-internal-sync`) — there is no JetStream stream-ensure on the publish path and no durable consumer on the receive path. With Knative `min-scale: "0"` (per `knative/services/overlays/_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml`) and **no KEDA scaler** for `adapter-service`, every `service.upserted` / `service.deleted` event published while the adapter is at 0 replicas is silently lost. Today the only recovery path is the offline `services/adapter-service/src/scripts/backfill-internal-mirrors.ts`, which is a manual, out-of-band patch — not a guarantee.

This change makes the `registry-service → adapter-service` flow **durable, replayable, and scale-to-zero–safe** by replacing the Core-NATS hop with a JetStream pull consumer model and introducing a KEDA-driven worker deployment that wakes on backlog.

## Scope

### In Scope
- Migrate `registry-service` publisher from `nc.publish` to `js.publish`, ensuring the per-tenant `INGRESS-<TENANT>` stream exists on the publish hot path.
- Promote `ensureTenantIngressStream` to `@yoizen/database` if not already shared, and consume it from `registry-service`.
- Rewrite `adapter-service` `InternalSyncService` to use `MultiTenantConsumerManager` + `NatsDurableConsumer` with durable `adapter-internal-sync` and per-tenant filter `evt.<tenant>.registry-service.platform.service.system.*.v1`.
- Split `adapter-service` into `adapter-service-api` (Knative Service, HTTP CRUD) and `adapter-service-worker` (`apps/v1.Deployment` running consumers) using `bootstrapSplitService` from `@yoizen/observability` and the standard `worker-health-server`.
- Add `knative/services/base/scaledobjects/adapter-service-worker.yaml` (Prometheus trigger aggregating `jetstream_consumer_num_pending + num_ack_pending{consumer_name="adapter-internal-sync"}`) and register it in `kustomization.yaml`.
- Adjust scale-to-zero overlays: rename the `adapter-service` block to `adapter-service-api` in `knative/services/overlays/_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml`, and patch `adapter-service-worker-scaler` to `minReplicaCount: 0` / `idleReplicaCount: 0` in `keda-scale-to-zero.yaml`.
- Wire observability hooks: `createNatsConsumerMetrics`, `/readyz` snapshot via `NatsConsumerRunner`.
- Tests: publisher (JetStream publish + ensure-stream cache), consumer (durable lifecycle, redelivery, idempotency contract against `upsertMirror`), worker bootstrap.

### Out of Scope
- Reworking `services/adapter-service/src/scripts/backfill-internal-mirrors.ts` — kept as a one-shot recovery tool.
- Changing the wire envelope or CloudEvents type / 8-token subject convention `evt.<tenant>.<emitter>.<domain>.<entity>.<source>.<verb>.<version>`.
- Replacing the `INGRESS-<TENANT>` per-tenant stream model (no aggregate `INGRESS-REGISTRY`, no JetStream `mirror`/`sources`).
- Migrating other Core-NATS subscribers in the repo to JetStream (out of scope here; tracked separately if needed).
- Production-overlay topology changes — handled in a follow-up rollout PR after non-prod soak.
- Re-architecting `adapter-service` HTTP API surface — only the bootstrap split changes.

## Approach

Adopt **Option B** from the exploration (matrix total **54**, highest of A/B/C/D): per-tenant durable consumers via `MultiTenantConsumerManager` reusing the existing `INGRESS-<TENANT>` streams, with the canonical `*-api` / `*-worker` Knative split and a Prometheus-backed KEDA `ScaledObject` on the worker.

Concretely:

1. **Publisher (`services/registry-service`)**: switch `service-events.publisher.ts` from `conn.publish` to `js.publish(subject, bytes, { headers, msgID })`. Inject `JETSTREAM_MANAGER` and call the shared `ensureTenantIngressStream(jsm, tenantId)` (idempotent, cached per pod) immediately before publish. Update `services/registry-service/src/providers/nats.provider.ts` to surface JetStream tokens. Keep the existing `REGISTRY_EMIT_ADAPTER_SYNC` feature flag for safe rollout.
2. **Consumer (`services/adapter-service`)**: replace `nc.subscribe` in `internal-sync.service.ts` with a `MultiTenantConsumerManager` configured as `{ streamPattern: /^INGRESS-/, durableName: "adapter-internal-sync", filterSubject: "evt.*.registry-service.platform.service.system.*.v1", ensureOnly: !isWorkerMode() }`. The handler keeps the existing `handleUpserted` / `handleDeleted` paths verbatim — `AdaptersRepository.upsertMirror` and `deleteMirrorByServiceName` are already idempotent, so at-least-once delivery is safe. Reference shape: `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:42-98`.
3. **Topology split**: `services/adapter-service/src/main.ts` adopts `bootstrapSplitService`. `knative/services/base/adapter-service.yaml` is renamed to `adapter-service-api.yaml`; a new `adapter-service-worker.yaml` mirrors `services/audit-service-worker.yaml`. This split is mandatory because **KEDA cannot scale Knative Services** (`infrastructure/base/keda/README.md:67-93`).
4. **Autoscaling**: new `knative/services/base/scaledobjects/adapter-service-worker.yaml` follows `event-processor-worker.yaml` / `audit-service-worker.yaml` (Prometheus query summing `num_pending + num_ack_pending` across tenants, `activationThreshold: "0"`). The `*-api` pods run the manager in `ensureOnly: true` mode so the metric series exist on every tenant stream even with zero workers — solving the cold-start chicken-and-egg.
5. **Rollout**: feature-flag-gated. Deploy publisher (`js.publish` + ensure-stream) first → run `backfill-internal-mirrors.ts` once for drift → deploy worker with `DeliverPolicy.New` → flip `REGISTRY_EMIT_ADAPTER_SYNC=true`.

### Alternatives Considered

| Approach | Summary | Why Rejected |
|----------|---------|-------------|
| A — Cross-tenant aggregate stream `INGRESS-REGISTRY` filtering `evt.*.registry-service.platform.service.system.*.v1` | One stream, one durable, one ScaledObject | JetStream rejects subject overlap with existing `INGRESS-<TENANT>` streams (`nats-server#2144`, `#7120`); would require redesigning the canonical `evt.<tenant>.>` namespace — huge blast radius. Matrix total: **30**. |
| C — Option B + auxiliary aggregate stream via JetStream `sources` | Per-tenant durables for persistence + a derived aggregate to simplify scaling | `sources` must be reconciled on every new tenant (moving target); adds storage cost and an eventual-consistency lag dimension; no precedent in repo. Matrix total: **38**. |
| D — Aggregate-only via `sources` (no per-tenant durables on `INGRESS-<TENANT>`) | Single durable on a sources-backed `INGRESS-REGISTRY` | Same source-reconciliation operational tax as C; doesn't simplify KEDA materially over B (still Prometheus); weakens tenant isolation. Matrix total: **35**. |

## Effort Estimation

- **Size**: M (leaning to L)
- **Estimated files**: 4–6 new (Knative manifests, ScaledObject, worker bootstrap), 8–12 modified (services, modules, providers, overlays, tests, possibly `@yoizen/database`), 0 deleted (the legacy `adapter-service.yaml` is renamed, not removed). Total touched: **~12–18**.
- **Complexity drivers**:
  - Cross-cutting: 2 services + shared `@yoizen/database` + Knative topology + KEDA + 2 overlays.
  - Topology change (Knative split) requires correct readiness wiring through `bootstrapSplitService` and `worker-health-server`.
  - Multi-tenant durable lifecycle and `ensureOnly` semantics on the API tier need careful module wiring.
  - Rollout ordering matters (publisher must precede consumer to avoid empty-replay surprises).
- **Suggested SDD depth**: **Full pipeline** (proposal → spec → design → tasks → apply → verify). The change spans the messaging contract, two services, the K8s topology and the autoscaling layer; specs need explicit guarantees for ordering, idempotency and replay, and design needs a sequence diagram for the cold-start path.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `services/registry-service/src/modules/services/service-events.publisher.ts` | Modified | Switch from `nc.publish` to `js.publish`; call `ensureTenantIngressStream` per publish; preserve `REGISTRY_EMIT_ADAPTER_SYNC` flag and `Nats-Msg-Id` dedup. |
| `services/registry-service/src/providers/nats.provider.ts` | Modified | Expose `JETSTREAM` and `JETSTREAM_MANAGER` tokens (currently empty `streams: []` pure-producer). |
| `services/registry-service/src/modules/services/services.module.ts` | Modified | Wire JetStream publisher provider. |
| `services/adapter-service/src/modules/internal-sync/internal-sync.service.ts` | Modified | Replace `nc.subscribe` with `MultiTenantConsumerManager` + durable `adapter-internal-sync`; reuse `handleUpserted` / `handleDeleted`. |
| `services/adapter-service/src/modules/internal-sync/internal-sync.module.ts` | Modified | Inject `MultiTenantConsumerManager`, `JETSTREAM_MANAGER`, metrics; gate consumer wiring on `isWorkerMode()`. |
| `services/adapter-service/src/main.ts` + `app.module.ts` | Modified | Adopt `bootstrapSplitService` from `@yoizen/observability`; expose `worker-health-server` in worker mode. |
| `services/adapter-service/AGENTS.md` | Modified | Document split topology and durable contract. |
| `packages/database/src/index.ts` (and a new shared module if needed) | Modified | Promote `ensureTenantIngressStream` from per-service copies to a single export. |
| `knative/services/base/adapter-service.yaml` | Renamed | Rename to `adapter-service-api.yaml`; trim env to API mode. |
| `knative/services/base/adapter-service-worker.yaml` | New | `apps/v1.Deployment` mirroring `audit-service-worker.yaml` (`SERVICE_MODE=worker`). |
| `knative/services/base/kustomization.yaml` | Modified | Replace `adapter-service.yaml` with `adapter-service-api.yaml` + `adapter-service-worker.yaml`. |
| `knative/services/base/scaledobjects/adapter-service-worker.yaml` | New | Prometheus trigger aggregating `num_pending + num_ack_pending{consumer_name="adapter-internal-sync"}`, `activationThreshold: "0"`. |
| `knative/services/base/scaledobjects/kustomization.yaml` | Modified | Add the new ScaledObject to `resources`. |
| `knative/services/overlays/_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml` | Modified | Rename `adapter-service` patch target to `adapter-service-api`. |
| `knative/services/overlays/_components/scale-to-zero-non-prod/keda-scale-to-zero.yaml` | Modified | Patch `adapter-service-worker-scaler` to `minReplicaCount: 0` / `idleReplicaCount: 0`. |
| `services/registry-service/test/**` | Modified/New | Unit tests for JetStream publish + ensure-stream cache. |
| `services/adapter-service/test/**` | Modified/New | Unit tests for durable lifecycle, redelivery, ack semantics, idempotency contract. |
| `services/adapter-service/src/scripts/backfill-internal-mirrors.ts` | Unchanged | Retained as one-shot recovery; not the steady-state path. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Replay storm on first deploy if `DeliverPolicy.All` is used on a populated `INGRESS-<TENANT>` stream | Med | Use `DeliverPolicy.New` on first deploy; run `backfill-internal-mirrors.ts` once to catch drift; document in `design.md`. |
| Rollout ordering bug — consumer durable created before publisher emits to the stream | Med | Strict deploy order: publisher (registry) → backfill once → worker (adapter) → flip `REGISTRY_EMIT_ADAPTER_SYNC=true`. Feature flag gates publisher behavior. |
| KEDA cold-start latency (~30–60s: poll interval + container boot) delays mirror updates | Med | Acceptable per existing audit/event-processor SLOs; tune `pollingInterval: 15` if needed (matches `event-processor-worker.yaml`). |
| Knative split readiness probe drift (worker pods need an HTTP server for `/readyz`) | Low | Reuse `bootstrapSplitService` + `worker-health-server` from `@yoizen/observability` (proven by audit/event-processor/webhook/workflow). |
| JetStream subject-overlap regression if a future change adds an aggregate stream | Low | Keep the recommendation in the architecture docs; add a lint/CI assertion that `streams.add` payloads do not collide with `evt.<tenant>.>`. |
| `ensureTenantIngressStream` adds a JSAPI roundtrip per cold publisher pod per tenant | Low | Existing implementations cache via `Set<streamName>`; cost amortised after first call (`services/api-gateway/src/providers/nats.provider.ts:25-52`). |
| `ensureOnly: true` on `adapter-service-api` could create durables that never drain if worker never scales up | Low | Prometheus trigger has `activationThreshold: "0"`; backlog itself triggers KEDA scale-up from 0. |

## Rollback Plan

1. **Immediate revert** (no redeploy needed): set `REGISTRY_EMIT_ADAPTER_SYNC=false` on `registry-service`. Publisher returns to no-op behavior; no events flow. The `adapter-service-api` Knative Service remains fully functional for HTTP CRUD throughout — rollback does NOT impact tenants' ability to manage adapters via the API.
2. **Stop the worker**: scale `adapter-service-worker` Deployment to `replicas: 0` (or pause the `ScaledObject` via `kubectl annotate scaledobject adapter-service-worker-scaler autoscaling.keda.sh/paused=true`). No consumer attempts pulls.
3. **Drop the durable** if needed (clean slate before retry): `nats consumer rm INGRESS-<TENANT> adapter-internal-sync` per affected tenant.
4. **Manifest revert**: revert the Knative split commit — restore the prior `knative/services/base/adapter-service.yaml`, remove `adapter-service-worker.yaml` and the new ScaledObject, restore the overlay block names. The previous monolithic Knative Service comes back unchanged.
5. **Recovery path**: if any drift accumulated during the failed rollout, run `bun run scripts/backfill-internal-mirrors.ts` to reconcile mirrors from the registry source-of-truth.

## Dependencies

- `@yoizen/database`: `MultiTenantConsumerManager`, `NatsDurableConsumer`, `NatsConsumerRunner`, `ensureTenantIngressStream` (promotion may be required if not yet exported).
- `@yoizen/observability`: `bootstrapSplitService`, `worker-health-server`, `createNatsConsumerMetrics`, `resolveServiceName`.
- KEDA installed in the cluster (already present per `infrastructure/base/keda/`).
- Prometheus scraping JetStream `consumer_num_pending` / `consumer_num_ack_pending` metrics (already in place — used by `event-processor-worker`, `audit-service-worker`, `webhook-service-worker`).
- Existing per-tenant `INGRESS-<TENANT>` streams (already provisioned lazily by `api-gateway` / `channel-service` / `event-processor`).
- Feature flag `REGISTRY_EMIT_ADAPTER_SYNC` (already exists in `registry-service`).
- No external/third-party dependency upgrades required.

## Success Criteria

- [ ] Creating a registered service while `adapter-service-worker` is at **0 replicas** results in the connector mirror being materialized within **≤90s p95** after KEDA wakes the worker (no manual `backfill-internal-mirrors.ts` required).
- [ ] Zero lost `service.upserted` / `service.deleted` events under a controlled chaos test (`adapter-service-worker` killed mid-publish window): all events appear in the mirror after worker recovery.
- [ ] JetStream consumer `adapter-internal-sync` reports `num_ack_pending == 0` within a **5-minute drain window** post-publish across all active tenants (verified via Prometheus query).
- [ ] Test coverage **≥80%** on the new/modified publisher and consumer modules (`services/registry-service/src/modules/services/service-events.publisher.ts`, `services/adapter-service/src/modules/internal-sync/internal-sync.service.ts`).
- [ ] All existing unit tests pass; `biome check` passes; build green for `registry-service` and `adapter-service` (both modes).
- [ ] `adapter-service-api` Knative Service continues to serve HTTP CRUD with the same readiness contract (smoke test against `/readyz` and a representative endpoint).
- [ ] `adapter-service-worker` Deployment exposes `/readyz` returning 200 only when the durable consumer reports `healthy` (per `NatsConsumerRunner` snapshot).
- [ ] KEDA `ScaledObject` `adapter-service-worker-scaler` reports `Active` state when backlog ≥ activation threshold and scales back to `0` when drained, observable in cluster events for ≥3 consecutive scale cycles.
- [ ] Rollback drill executed in non-prod: flipping `REGISTRY_EMIT_ADAPTER_SYNC=false` and scaling the worker to 0 restores pre-change behavior with no errors in either service's logs.
