# Tasks: Make adapter-service internal-sync durable and scale-to-zero–safe

**Total Effort**: 43 tasks — 23×`[XS]` + 14×`[S]` + 6×`[M]` (≈ 32 task-units; `XS=0.5 / S=1 / M=2`)
**Critical Path**: Phase 1 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
**TDD**: disabled (no `rules.apply.tdd` in `.sdd/config.yaml`; standard `*.spec.ts` co-located with implementation per repo convention)
**Parallel branches**: Phase 2 runs parallel to Phase 3 (different services). Phase 8 docs run parallel to Phase 6+7 once their inputs are stable.

## Phase 1: Foundation — shared `ensureTenantIngressStream`

- [ ] 1.1 Lift `ensureTenantIngressStream(jsm, tenantId)` into `packages/database/src/nats-provider.ts` (preserve in-memory `Set<streamName>` cache; export idempotent helper) `[S]` → REQ-RSE-002
- [ ] 1.2 Re-export `ensureTenantIngressStream` from `packages/database/src/index.ts` `[XS]` → REQ-RSE-002
- [ ] ⊕ 1.3 Migrate `services/api-gateway/src/providers/nats.provider.ts` to `import { ensureTenantIngressStream } from "@yoizen/database"` and delete the local copy `[XS]`
- [ ] ⊕ 1.4 Migrate `services/channel-service/src/providers/nats.provider.ts` to the shared helper and delete the local copy `[XS]`
- [ ] ⊕ 1.5 Migrate `services/event-processor/src/providers/nats.provider.ts` to the shared helper and delete the local copy `[XS]`
- [ ] 1.6 Add `packages/database/test/unit/nats-provider.spec.ts` covering: ensure-on-miss → `streams.add` invoked; ensure-on-hit → no broker call; broker reject → propagated `[S]` → REQ-RSE-002

## Phase 2: Publisher — `registry-service` JetStream emission (parallel to Phase 3)

- [ ] 2.1 In `services/registry-service/src/providers/nats.provider.ts` expose `JETSTREAM` (`JetStreamClient`) and `JETSTREAM_MANAGER` (`JetStreamManager`) tokens; keep `streams: []` (registry does not own a stream — ensure runs per publish) `[S]` → REQ-RSE-001
- [ ] 2.2 Wire `jetStreamProvider` + `jetStreamManagerProvider` into `services/registry-service/src/modules/services/services.module.ts` so `ServiceEventsPublisher` resolves the new tokens `[XS]` → REQ-RSE-001
- [ ] ⊕ 2.3 Create `services/registry-service/src/modules/services/service-events.metrics.ts` with OTel counters `registry_publish_attempts`, `_successes`, `_failures{reason}`, `ensure_stream_calls{result=hit|miss}` `[S]` → NFR-RSE-001
- [ ] 2.4 Rewrite `services/registry-service/src/modules/services/service-events.publisher.ts`: inject `JETSTREAM` + `JETSTREAM_MANAGER`; replace `conn.publish` + `flush()` with `js.publish(subject, bytes, { headers, msgID: idempotencykey })`; call `ensureTenantIngressStream(jsm, tenantId)` first; bounded retry (3 attempts, exp backoff capped 2s); short-circuit when `REGISTRY_EMIT_ADAPTER_SYNC=false` (no broker contact); drop with `reason=missing_tenant` metric on absent `tenantId`; never throw to caller (post-commit, best-effort) `[M]` → REQ-RSE-001, REQ-RSE-002, REQ-RSE-003, REQ-RSE-004, REQ-RSE-005, NFR-RSE-002
- [ ] 2.5 Add unit tests in `services/registry-service/test/unit/service-events.publisher.spec.ts` covering:
    - flag off → zero broker calls (REQ-RSE-004)
    - flag on + ensure cache miss → `streams.add` then `js.publish` ordered (REQ-RSE-001/002)
    - flag on + ensure cache hit → `js.publish` only, no `streams.add` (REQ-RSE-002)
    - `js.publish` rejects (broker timeout) → bounded retry then `_failures{reason=ack_timeout}` increment + structured log; HTTP path unaffected (REQ-RSE-001 ack-timeout, REQ-RSE-003)
    - missing `tenantId` → no publish, `_failures{reason=missing_tenant}` increment (REQ-RSE-005)
    - DB rollback path → publisher never invoked (REQ-RSE-003 rollback) `[M]`

## Phase 3: Consumer — `adapter-service` durable JetStream consumer (parallel to Phase 2)

- [ ] 3.1 In `services/adapter-service/src/providers/nats.provider.ts` add `JETSTREAM_MANAGER` + `JETSTREAM` providers (mirror `services/workflow-service/src/providers/providers.module.ts`); keep existing `NATS_CONNECTION` for legacy paths `[S]` → REQ-ASIS-001
- [ ] ⊕ 3.2 Update `services/adapter-service/src/modules/internal-sync/internal-sync.metrics.ts` to source the runner metrics via `createNatsConsumerMetrics(resolveServiceName("adapter-service"))` and pass them through `IMultiTenantConsumerConfig.metrics` `[XS]` → NFR-ASIS-001, NFR-XC-003
- [ ] 3.3 Rewrite `services/adapter-service/src/modules/internal-sync/internal-sync.service.ts`:
    - construct `MultiTenantConsumerManager(jsm, js, config, handler, logger)` in `onModuleInit`; call `start()`; `stop()` in `onModuleDestroy`
    - `config = { streamPattern: /^INGRESS-/, durableName: "adapter-internal-sync", filterSubject: "evt.*.registry-service.platform.service.system.*.v1", description, metrics, runnerOptions: { concurrency: 4 }, ensureOnly: !isWorkerMode() }`
    - handler: parse envelope → throw `PermanentError` on parse error / unknown CloudEvents `type` / `payload.tenantId !== subjectTenant` (cross-tenant attempt)
    - reuse `handleUpserted` / `handleDeleted` verbatim against `AdaptersRepository`
    - propagate transient errors (runner naks)
    - emit OTel span via `startNatsConsumerSpan(msg.subject, …)` `[M]` → REQ-ASIS-001, REQ-ASIS-003, REQ-ASIS-004, REQ-ASIS-005, REQ-ASIS-006
- [ ] 3.4 Update `services/adapter-service/src/modules/internal-sync/internal-sync.module.ts` to inject `JETSTREAM_MANAGER` + `JETSTREAM`; the `MultiTenantConsumerManager` is constructed inside `InternalSyncService` regardless of mode — `ensureOnly` flag gates whether it consumes `[XS]` → REQ-AST-002
- [ ] 3.5 Add unit tests in `services/adapter-service/test/unit/internal-sync.service.spec.ts` covering:
    - manager constructed with `ensureOnly: true` when `SERVICE_MODE=api`, `false` when `SERVICE_MODE=worker` (REQ-AST-002, REQ-ASIS-001)
    - same `service.upserted.v1` redelivered twice → handler issues two `upsertMirror` calls and the mock repository converges to one row (REQ-ASIS-002)
    - `service.deleted.v1` redelivered after delete → handler is no-op + ack (REQ-ASIS-002)
    - subject `evt.acme.…` with payload `tenantId=globex` → `PermanentError` thrown, `cross_tenant_attempt` metric incremented (REQ-ASIS-006)
    - malformed envelope → `PermanentError` with `reason=parse_error` (REQ-ASIS-003)
    - unknown CloudEvents `type` → `PermanentError` with `reason=unknown_type` (REQ-ASIS-003)
    - transient `Error` from `upsertMirror` → propagated (runner naks) (REQ-ASIS-003)
    - `MultiTenantConsumerManager` reconcile picks up new `INGRESS-newco` stream without restart (REQ-ASIS-005) `[M]`

## Phase 4: Topology split — `adapter-service` api/worker bootstrap

- [ ] 4.1 Replace `bootstrapFastifyApp` with `bootstrapSplitService({ baseServiceName: "adapter-service", module: AppModule, port: adapterServiceConfig.port, apiOptions: { withValidationPipe: true } })` in `services/adapter-service/src/main.ts` (mirror `services/audit-service/src/main.ts`); refuse to start on missing/unknown `SERVICE_MODE` `[S]` → REQ-AST-001, REQ-AST-002, REQ-AST-006, REQ-AST-007
- [ ] 4.2 Update `services/adapter-service/src/modules/health/health.controller.ts` (and `health.service.ts`) for mode-aware probes:
    - `/healthz` always 200 while process up (REQ-AST-003 liveness)
    - worker `/readyz`: 200 only when `JetStreamManager` connected AND `getNatsTenantPostgresHealthStatus` reports DB green for ≥1 active tenant pool AND `MultiTenantConsumerManager.getRunner(stream).isHealthy()` is true for ≥1 stream; otherwise 503 with machine-readable failing-gate marker (REQ-AST-004, REQ-AST-007)
    - api `/readyz`: 200 when process + DB healthy, **independent** of NATS / durables (REQ-AST-005)
    - both modes: `/readyz` returns 503 once SIGTERM received (REQ-AST-003 graceful shutdown) `[M]`
- [ ] 4.3 Update `services/adapter-service/src/modules/health/health.module.ts` to inject the consumer manager + tenant connection manager handles, gated by `isWorkerMode()` `[XS]` → REQ-AST-002
- [ ] 4.4 Add unit tests in `services/adapter-service/test/unit/health.controller.spec.ts` covering:
    - worker `/readyz` 503 when NATS disconnected (REQ-AST-004 NATS gate)
    - worker `/readyz` 503 when DB ping fails (REQ-AST-004 DB gate)
    - worker `/readyz` 503 when no runner reports `isHealthy()` (REQ-AST-004 durable gate)
    - worker `/readyz` 200 when all three gates green
    - api `/readyz` 200 with NATS down (REQ-AST-005)
    - api `/readyz` 200 with worker at 0 replicas elsewhere (REQ-AST-005)
    - both modes return 503 after SIGTERM (REQ-AST-003) `[S]`

## Phase 5: Manifests — Knative + KEDA topology

- [ ] ⊕ 5.1 Create `knative/services/base/adapter-service-api.yaml` (`serving.knative.dev/v1.Service`) cloned from current `adapter-service.yaml` with `SERVICE_MODE=api`, `OTEL_SERVICE_NAME=adapter-service-api`, `min-scale: "1"`, `max-scale: "3"`; mirror `audit-service-api.yaml` `[S]` → REQ-AST-001, REQ-AST-006, NFR-AST-001
- [ ] ⊕ 5.2 Create `knative/services/base/adapter-service-worker.yaml` (`apps/v1.Deployment`) with `SERVICE_MODE=worker`, `OTEL_SERVICE_NAME=adapter-service-worker`, `replicas: 1`, `terminationGracePeriodSeconds: 30`, `readinessProbe: /readyz`, `livenessProbe: /healthz`; mirror `audit-service-worker.yaml` `[S]` → REQ-AST-002, REQ-AST-003, REQ-AST-006, REQ-ASIS-004, NFR-AST-001
- [ ] 5.3 Delete legacy `knative/services/base/adapter-service.yaml` `[XS]` → REQ-AST-001
- [ ] 5.4 Update `knative/services/base/kustomization.yaml` `resources` list: remove `adapter-service.yaml`, add `adapter-service-api.yaml` + `adapter-service-worker.yaml` `[XS]`
- [ ] 5.5 Create `knative/services/base/scaledobjects/adapter-service-worker.yaml` targeting the worker `Deployment` with: `pollingInterval: 30`, `cooldownPeriod: 120`, `idleReplicaCount: 0`, `minReplicaCount: 1`, `maxReplicaCount: 3`, Prometheus trigger `query: sum(jetstream_consumer_num_pending{consumer_name="adapter-internal-sync"}) + sum(jetstream_consumer_num_ack_pending{consumer_name="adapter-internal-sync"})`, `threshold: "100"`, `activationThreshold: "0"`; mirror `event-processor-worker.yaml` `[S]` → REQ-ASA-001, REQ-ASA-002, REQ-ASA-003, REQ-ASA-004, REQ-ASA-005, REQ-ASA-006, NFR-ASA-002
- [ ] 5.6 Update `knative/services/base/scaledobjects/kustomization.yaml` to append `adapter-service-worker.yaml` to `resources` `[XS]` → REQ-ASA-001
- [ ] ⊕ 5.7 Patch `knative/services/overlays/_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml`: rename the existing `adapter-service` patch target to `adapter-service-api` (keep `min-scale: "0"`) `[XS]` → REQ-AST-001, REQ-ASA-003
- [ ] ⊕ 5.8 Patch `knative/services/overlays/_components/scale-to-zero-non-prod/keda-scale-to-zero.yaml` to add an `adapter-service-worker-scaler` block with `minReplicaCount: 0` / `idleReplicaCount: 0` `[XS]` → REQ-ASA-003

## Phase 6: Tests — integration + E2E

- [ ] ⊕ 6.1 Integration test: NATS testcontainer (`nats:2.10`) + JetStream — assert durable lifecycle for `adapter-internal-sync` across two synthetic tenant streams (`INGRESS-acme`, `INGRESS-globex`); publish 100 events, assert all 100 acked; redeliver scenario by simulating handler error first attempt → ack second attempt `[M]` → REQ-ASIS-001, REQ-ASIS-002, REQ-ASIS-003
- [ ] ⊕ 6.2 Integration test: NATS testcontainer + per-tenant Postgres testcontainer (`pg:16`) for `upsertMirror`; publish 100 events across 3 tenants, kill the worker mid-publish, restart, assert mirror row count == published event count (zero loss) `[M]` → REQ-ASIS-002, REQ-ASIS-006, NFR-ASIS-002, NFR-XC-001
- [ ] ⊕ 6.3 Integration test: SIGTERM with N in-flight messages — assert all messages either ack'd within grace OR nak'd before exit; no silent drops; `shutdown_naked_inflight` metric increments only when grace exceeded `[S]` → REQ-ASIS-004
- [ ] 6.4 E2E test in `tests/e2e/`: spin up local-dev overlay (KEDA + Prometheus), seed two tenant ingress streams, register a service via `POST /registry/services` while `adapter-service-worker` is at 0 replicas; assert KEDA scales worker 0→1 within `pollingInterval + cooldown` window; assert mirror row appears within ≤90s p95; flip `REGISTRY_EMIT_ADAPTER_SYNC=false` and assert publisher silence (no broker activity) `[M]` → REQ-ASA-003, NFR-ASA-001, NFR-ASIS-003, NFR-XC-002

## Phase 7: Rollout — operational gates (executed manually during `sdd-apply`)

- [ ] 7.1 [GATE] Phase 1 deploy: apply manifests with `adapter-service-worker` at `replicas: 1` (default), `REGISTRY_EMIT_ADAPTER_SYNC=false` everywhere; verify `kubectl get scaledobject adapter-service-worker-scaler` reports `Active: false` and worker `/readyz` is 503 (no durables yet) → 200 once first tenant durable binds `[XS]`
- [ ] 7.2 [GATE] Phase 2 deploy: roll registry-service with publisher migrated, flag still `false`; verify zero entries in `registry_publish_attempts_total` and registry HTTP latency unchanged `[XS]` → REQ-RSE-004
- [ ] 7.3 [GATE] Phase 3 backfill: run `bun run scripts/backfill-internal-mirrors.ts` once with the full `BACKFILL_TENANT_IDS`; verify mirror row count matches registry `registered_services` count per tenant `[XS]`
- [ ] 7.4 [GATE] Phase 4 flag flip: set `REGISTRY_EMIT_ADAPTER_SYNC=true` in non-prod overlay only; verify next `POST /registry/services` produces a `service.upserted.v1` PubAck (stream sequence visible) and the mirror row appears `[XS]` → REQ-RSE-004
- [ ] 7.5 [GATE] Phase 5 monitoring checklist (≥24h soak): assert `ScaledObject.status` toggles `Active`↔`Inactive` cleanly across ≥3 cycles; `num_ack_pending` returns to 0 within 5min p95 of any backlog burst; KEDA cold-start drill produces mirror row in ≤90s p95; rollback drill (flip flag false + scale worker 0) leaves api `/readyz` green `[S]` → NFR-ASA-002, NFR-ASA-003, NFR-XC-001, NFR-XC-002

## Phase 8: Documentation

- [ ] ⊕ 8.1 Update `services/adapter-service/AGENTS.md`: document split topology (`api` vs `worker`), `SERVICE_MODE` semantics, durable contract (`adapter-internal-sync`, filter, ack policy), `/readyz` gates per role, rollback procedure (flag flip + worker scale 0) `[S]` → docs (REQ-AST-001…007, REQ-ASIS-001/003)
- [ ] ⊕ 8.2 Mirror Phase-8.1 changes into `services/adapter-service/CLAUDE.md` (same content, project rules tone) `[XS]`
- [ ] ⊕ 8.3 Update `services/registry-service/AGENTS.md`: document JetStream publish path, `ensureTenantIngressStream` precondition, `REGISTRY_EMIT_ADAPTER_SYNC` flag, post-commit best-effort semantics, retry & metrics surface `[XS]` → docs (REQ-RSE-001…005)
- [ ] ⊕ 8.4 Mirror Phase-8.3 changes into `services/registry-service/CLAUDE.md` `[XS]`
- [ ] ⊕ 8.5 Update `infrastructure/base/keda/README.md` with an `adapter-service-worker` example entry (Prometheus query, threshold, activation, cold-start note) `[XS]` → REQ-ASA-001, NFR-XC-003
- [ ] ⊕ 8.6 Document promoted `ensureTenantIngressStream` in `packages/database/README.md` (or the package's existing docstring/JSDoc): contract, idempotency, cache lifetime, error classes `[XS]` → REQ-RSE-002

---

## Summary Table

| Phase | Tasks | Parallelizable | Effort | Focus |
|-------|-------|----------------|--------|-------|
| Phase 1 | 6 | 3 (1.3/1.4/1.5) | 2×`[S]`+4×`[XS]` | Foundation: shared `ensureTenantIngressStream` |
| Phase 2 | 5 | 1 (2.3 alongside 2.1/2.2) | 2×`[M]`+2×`[S]`+1×`[XS]` | Publisher: `registry-service` JetStream emission |
| Phase 3 | 5 | 1 (3.2 alongside 3.1) | 2×`[M]`+1×`[S]`+2×`[XS]` | Consumer: durable `adapter-internal-sync` + handler |
| Phase 4 | 4 | 0 | 1×`[M]`+2×`[S]`+1×`[XS]` | Topology split: `bootstrapSplitService` + mode-aware health |
| Phase 5 | 8 | 4 (5.1/5.2 + 5.7/5.8) | 3×`[S]`+5×`[XS]` | Manifests: Knative `*-api`/`*-worker` + KEDA `ScaledObject` + overlays |
| Phase 6 | 4 | 3 (6.1/6.2/6.3) | 3×`[M]`+1×`[S]` | Integration + E2E: durable lifecycle, chaos, cold-start ≤90s |
| Phase 7 | 5 | 0 (sequential gates) | 1×`[S]`+4×`[XS]` | Rollout: deploy-publisher-first, backfill, flag flip, soak |
| Phase 8 | 6 | 6 (all parallel) | 1×`[S]`+5×`[XS]` | Docs: AGENTS/CLAUDE for adapter & registry, KEDA README, package README |
| **Total** | **43** | **18 ⊕** | **6×`[M]` + 14×`[S]` + 23×`[XS]` ≈ 32 task-units** | |

## Critical Path

`1.1 → 1.2 → 3.1 → 3.3 → 3.4 → 4.1 → 4.2 → 5.1+5.2 → 5.5 → 6.1+6.2 → 6.4 → 7.1 → 7.2 → 7.3 → 7.4 → 7.5`

Phase 2 (publisher) runs in parallel to Phase 3 (consumer); both join at Phase 6 integration. Phase 8 docs run in parallel to Phases 6+7 once the implementation surface is stable (Phase 4 complete).

## Implementation Order Notes

- **Phase 1 first** so the publisher in Phase 2 can import the shared helper without a temporary local copy.
- **Phases 2 and 3 in parallel** — touch disjoint codebases (`registry-service` vs `adapter-service`) and disjoint test files.
- **Phase 4 must precede Phase 5** because the manifests assume `bootstrapSplitService` is wired (api would crash without `SERVICE_MODE` handling).
- **Phase 6 last among code phases** — integration tests need the new wiring AND the new manifests rendered into a local overlay.
- **Phase 7 is strictly sequential** and matches the rollout ordering in `design.md`'s `Migration / Rollout` section: ship worker idle (publisher off) → ship publisher gated → backfill once → flip flag → soak.
- **Phase 8 docs** can land any time after the corresponding implementation phase, but are listed last so the docs reflect the final wired surface (no churn).

## REQ → Task Coverage Matrix

| Spec ID | Tasks |
|---------|-------|
| REQ-RSE-001 | 2.1, 2.2, 2.4, 2.5 |
| REQ-RSE-002 | 1.1, 1.2, 1.6, 2.4, 2.5 |
| REQ-RSE-003 | 2.4, 2.5 |
| REQ-RSE-004 | 2.4, 2.5, 7.2, 7.4 |
| REQ-RSE-005 | 2.4, 2.5 |
| NFR-RSE-001 | 2.3 |
| NFR-RSE-002 | 2.4 |
| REQ-ASIS-001 | 3.1, 3.3, 3.5, 6.1 |
| REQ-ASIS-002 | 3.5, 6.1, 6.2 |
| REQ-ASIS-003 | 3.3, 3.5, 6.1 |
| REQ-ASIS-004 | 3.3, 6.3 |
| REQ-ASIS-005 | 3.3, 3.5 |
| REQ-ASIS-006 | 3.3, 3.5, 6.2 |
| NFR-ASIS-001 | 3.2 |
| NFR-ASIS-002 | 6.2 |
| NFR-ASIS-003 | 6.4 |
| REQ-AST-001 | 4.1, 5.1, 5.3, 5.7, 8.1 |
| REQ-AST-002 | 3.4, 4.1, 4.3, 5.2, 8.1 |
| REQ-AST-003 | 4.2, 4.4, 5.2, 8.1 |
| REQ-AST-004 | 4.2, 4.4, 8.1 |
| REQ-AST-005 | 4.2, 4.4, 8.1 |
| REQ-AST-006 | 4.1, 5.1, 5.2, 8.1 |
| REQ-AST-007 | 4.1, 4.2, 8.1 |
| NFR-AST-001 | 5.1, 5.2 |
| NFR-AST-002 | 4.2, 8.1 |
| REQ-ASA-001 | 5.5, 5.6, 8.5 |
| REQ-ASA-002 | 5.5, 8.5 |
| REQ-ASA-003 | 5.5, 5.7, 5.8, 6.4, 7.5 |
| REQ-ASA-004 | 5.5 |
| REQ-ASA-005 | 5.5 |
| REQ-ASA-006 | 5.5 |
| NFR-ASA-001 | 6.4, 7.5 |
| NFR-ASA-002 | 5.5, 7.5 |
| NFR-ASA-003 | 7.5 |
| NFR-XC-001 | 6.2, 7.5 |
| NFR-XC-002 | 6.4, 7.5 |
| NFR-XC-003 | 3.2, 8.5 |

> Every REQ-*/NFR-* in the four delta specs maps to ≥1 implementation task and ≥1 test/verification task.

## Definition of Done (per task)

1. The code/manifest change is written, saved, and follows the design's file-changes table.
2. The change matches the relevant spec scenarios (cross-referenced above).
3. Co-located unit tests exist (`*.spec.ts` next to the module) for code tasks; integration/E2E live under `tests/integration` / `tests/e2e`.
4. `biome check` passes for touched TypeScript files.
5. `bun run build` succeeds for the affected service(s).
6. The task is checked off (`[x]`) in this file.

## Next Step

Ready for implementation (`sdd-apply`). Recommended batching:
1. Run **Phase 1** alone (foundation; downstream phases depend on it).
2. Run **Phase 2 ⊕ Phase 3** in two parallel sub-agent batches.
3. Run **Phase 4** sequentially (depends on Phase 3 wiring).
4. Run **Phase 5** (4 ⊕ pairs).
5. Run **Phase 6** (3 ⊕ integration tests, then E2E).
6. Run **Phase 7** as a strict serial pipeline (operational gates with human verification).
7. Run **Phase 8** last (or fold into post-merge cleanup; all 6 tasks are ⊕).
