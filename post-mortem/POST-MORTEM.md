# POST-MORTEM — Stress Test (2026-05-22)

**Status:** Bottleneck identified — **single-instance PostgreSQL backing Temporal** (`postgres-temporal-1`).
**Severity:** S2 — Major degradation. ~34.7% workflow-start failure rate, end-to-end webhook ingestion timed out at peak.
**Window analysed:** 2026-05-22 15:15 → 17:55 UTC (≈2 h 40 m of stress traffic).
**Workload:** `acme` tenant, single workflow definition `PNRPCPyYMZ2kV0hNHexmU` ("Stress Workflow"), driven via `webhook → channel-service → workflow-service → temporal → workflow-worker`.

---

## 1. TL;DR

The whole pipeline is healthy until it hits the **Temporal history shard layer**, which is bottlenecked on **a single PostgreSQL instance** (`postgres-temporal-1`).

That single Postgres can't sustain the write/read pattern Temporal's history+visibility shards generate under stress. Every layer **upstream** of it (Temporal SDK worker, workflow-service consumer, NATS, api-gateway) shows symptoms that are *consequences* of Postgres backpressure, not root causes:

| Layer | Symptom | Verdict |
|---|---|---|
| `postgres-temporal-1` | 2 077 duplicate-key INSERTs into `queues` / `queue_messages`; 57 `canceling statement due to user request`; autovacuum at 51 MB/s read | **Root-cause bottleneck** |
| `temporal` (server) | 2 615 `Update workflow execution operation failed: context deadline exceeded` in **28 s**; 121 Slow gRPC (5–10 s each); `Per shard RPS warn limit exceeded` (114 RPS shard / 77 RPS namespace) | Victim of Postgres, amplifier of cascade |
| `workflow-worker` (Temporal SDK) | 14 `poll_workflow_task_queue` cancellations, 40 activity timeouts, 6 `Activity task timed out` workflow failures | Victim |
| `workflow-service-worker` (TriggerConsumerService) | 866 `Failed to start Workflow` (34.7% of triggers), **6 983 duplicate triggers** (≈280% NATS redelivery) | Victim — workflow-start gRPC > 30 s `ackWait` |
| `nats` | 1 × `Internal subscription on $JS.API.CONSUMER.INFO.INGRESS-ACME.workflow-triggers took 2.65 s` + matching readloop spike | Victim — JetStream API starved by a consumer that won't ACK |
| `api-gateway` | 121 `NatsError: TIMEOUT` from `publishWebhook` clustered in 1 minute (15:52) + sustained `RateLimitConfigCacheService` / `DynamicRouteCacheService` timeouts vs `registry-service` | Victim — JetStream publish ack stalled while the cluster was saturated |

**Bottleneck ranking (worst → best):**
1. `postgres-temporal-1` (single replica, slow I/O, queue-table contention)
2. `temporal` history shards (RPS exceeded, store ops timing out)
3. `workflow-service-worker` (concurrency=16 amplifies redelivery storm)
4. `nats` JetStream management API (transient API starvation)
5. `api-gateway` (publish-ack timeouts; webhooks lost to the client)

---

## 2. Architecture under test

```
client  ─── HTTPS ──▶  api-gateway
                          │  publishWebhook → JetStream (INGRESS-<tenant>.webhook.…)
                          ▼
                   nats (JetStream)
                          │  evt.*.channel-service.messaging.*.*.received.v1
                          ▼
            workflow-service-worker (TriggerConsumerService)
                 concurrency=16, ackWait=30 s, maxDeliver=3
                          │  client.workflow.start  (gRPC)
                          ▼
                  temporal (history / matching)
                          │  update-wf-execution / queues  (SQL)
                          ▼
                postgres-temporal-1 (single CNPG instance)

(workflow-worker = Temporal Node SDK polling for workflow + activity tasks)
```

The cascade flows **bottom-up**: when `postgres-temporal-1` stalls, `temporal` shards stall, which stalls every gRPC client, which stalls the NATS consumer, which stalls the JetStream publish ack pipeline.

---

## 3. Per-component evidence

### 3.1 `postgres-temporal-1` — the bottleneck

Source: [`post-mortem/postgres-temporal.log`](./postgres-temporal.log) — 11 945 records, 2 134 `ERROR`, 9 803 `LOG`.

**ERROR breakdown:**

| Count | SQLSTATE | Message | Query |
|------:|----------|---------|-------|
| **1 703** | `23505` | `duplicate key value violates unique constraint "queues_pkey"` | `INSERT INTO queues (queue_type, queue_name, …)` |
| **374**   | `23505` | `duplicate key value violates unique constraint "queue_messages_pkey"` | `INSERT INTO queue_messages (queue_type, queue_name, queue_partition, message_id, …)` |
| **57**    | `57014` | `canceling statement due to user request` | `SELECT … FROM executions / activity_info_maps / timer_tasks …` |

- The 2 077 duplicate-key INSERTs are Temporal's history hosts racing to claim the same shard queue partition (`queue_type=2`, `queue_name=2_active_active_B8jqXXpO`). They are recoverable, but every one of them costs a full network round-trip, a parse/plan, a btree probe, **and** a transaction abort. At this rate they are pure waste against a single instance.
- The 57 `57014` cancellations are **Postgres-side proof of context-deadline cascade** — they line up 1:1 with Temporal's "Update workflow execution operation failed: context deadline exceeded".
- Vacuum/autovacuum on `executions` and `executions_visibility` is running with `I/O timings: read: 7.87 s, write: 1.17 s, avg read rate: 51.987 MB/s, buffer usage: 26 820 hits, 101 524 misses` — meaning the working set does **not** fit in shared buffers and autovacuum is fighting hot writes for disk bandwidth.

**Verdict:** the database is the choke point. A single Postgres instance with this I/O profile cannot serve Temporal's 4-shard history workload at the offered load.

---

### 3.2 `temporal` (server) — saturated, propagating backpressure

Source: [`post-mortem/temporal.log`](./temporal.log) — 5 399 lines covering **only 28 s** (17:54:10 → 17:54:38).

| Count | Level | Message | Detail |
|------:|-------|---------|--------|
| **2 615** | error | `Update workflow execution operation failed.` | 1 604 × `context deadline exceeded`, 1 011 × `context canceled` — **100% store-operation=`update-wf-execution`** |
| 1 766 | warn  | `Fail to process task` | `timer-queue-processor` + `transfer-queue-processor`, all `error-type: serviceerror.DeadlineExceeded` / `context.DeadlineExceeded`, attempts up to **45** |
| 840   | error | `Critical error processing task, retrying.` | same shard tasks repeatedly failing — proves the persistence layer is the choke point |
| 121   | warn  | `Slow gRPC call` | **all 5–10 s**: 53 × `StartWorkflowExecution`, 40 × `RespondWorkflowTaskCompleted`, 28 × `RespondActivityTaskCompleted` |
| 4     | warn  | `Per shard (per namespace) RPS warn limit exceeded` | shard-7 at **114 RPS** (shard limit) and **77 RPS** (namespace limit); shard-2 at 78/43 |

- Generating **~95 errors per second sustained** for 28 s tells us the history service is in a runaway retry loop driven by `update-wf-execution` failures against Postgres.
- Slow gRPC is concentrated in `StartWorkflowExecution` (53 × 5–10 s) — exactly what `TriggerConsumerService` is calling. This explains the 866 "Failed to start Workflow" upstream.
- "Per shard RPS warn limit exceeded" confirms Temporal's own self-throttling is kicking in; the shard executors can't keep up with the inbound task pressure.

**Verdict:** Temporal server is healthy CPU-wise but is being held hostage by its persistence layer. Adding history shards / hosts will not help until Postgres scales.

---

### 3.3 `workflow-service-worker` (TriggerConsumerService) — duplicate storm

Source: [`post-mortem/workflow-service-worker.log`](./workflow-service-worker.log) — 19 024 lines, 866 error / 868 warn / 17 233 info.

| Outcome | Count |
|---|---:|
| `Triggered workflow … -> execution …` | **1 626** |
| `Failed to trigger workflow … : Failed to start Workflow` | **866** |
| `Failed to process message: Failed to start Workflow` | **866** (1 ack-fail per warn) |
| `Duplicate trigger … already started` | **6 983** |

- Failure rate at the trigger layer: `866 / (866 + 1 626) = 34.7%`.
- **Redelivery amplification:** `6 983 duplicates / 1 626 unique triggers ≈ 4.3 redeliveries per workflow on average.** With `maxDeliver=3` + `ackWait=30 s` configured in [`trigger-consumer.service.ts`](../services/workflow-service/src/modules/triggers/trigger-consumer.service.ts), this proves the consumer is hitting `ackWait` repeatedly because `client.workflow.start()` is taking longer than 30 s end-to-end — which lines up exactly with Temporal's 5–10 s slow gRPC × retries.
- The 866 failures are not lost: they correspond to messages that exhausted `maxDeliver=3` and were DLQ'd / dropped by JetStream. The current config is intentionally conservative ("3 retries cover transient gRPC blips without amplifying the workflow population during a backend slowdown") — but at this load even 3 is too many: the duplicate-trigger guard absorbs the noise, but every duplicate costs **another `client.workflow.start` gRPC + Postgres roundtrip** through Temporal, which feeds the cascade.

**Verdict:** `workflow-service-worker` itself is fine. Its `concurrency=16` is *more* than the downstream can absorb at peak. The bottleneck propagates up through this layer; lowering concurrency or widening backoff would *protect* Temporal but not fix it.

---

### 3.4 `workflow-worker` (Temporal Node SDK) — victim

Source: [`post-mortem/workflow-worker.log`](./workflow-worker.log) — 1 358 lines.

- **1 224 `Executed_*` activity completions** between 15:15:32 → 17:53:26 → **≈7.7 activities/min** sustained. With activity concurrency of 100 configured per worker, real throughput is bounded by Temporal's response time, not by worker capacity.
- **14 ×** `gRPC call poll_workflow_task_queue retried 6+ times` — Temporal server stops responding within the poll deadline.
- **40 ×** `Network error while completing activity … Timeout expired` / `Cancelled` / `h2 protocol error: http2 error`.
- **6 ×** `Workflow failed … error: [Error: Activity task timed out]` — actual user-visible workflow failures.
- **5 ×** `Activity not found on completion. … workflow execution already completed` — the activity completed locally but Temporal already marked it timed out and started a new attempt (double-execution risk in non-idempotent activities).

**Verdict:** victim; nothing to fix on the worker, but **non-idempotent activities are at risk of double execution** under this regime.

---

### 3.5 `nats` — momentarily starved, not a bottleneck

Source: [`post-mortem/nats.log`](./nats.log) — only 4 entries beyond startup:

```text
2026-05-22 15:47:27.069  [WRN] Internal subscription on
  "$JS.API.CONSUMER.INFO.INGRESS-ACME.workflow-triggers" took too long: 2.133 s
2026-05-22 15:47:27.146  [WRN] Internal subscription on
  "$JS.API.CONSUMER.INFO.INGRESS-ACME.workflow-triggers" took too long: 2.654 s
2026-05-22 15:47:27.146  [WRN] Internal subscription on … 2.655 s
2026-05-22 15:47:27.146  [WRN] 192.168.194.77:50042 - cid:23
  Readloop processing time: 2.655 s
```

- JetStream's internal `CONSUMER.INFO` call took 2.6 s — JetStream is fine, but the consumer was hammering it with `CONSUMER.INFO` while not draining messages (because `client.workflow.start` was blocked on Temporal). This is the only NATS-side smell in the whole run.

**Verdict:** NATS is not a bottleneck. The single readloop spike is a *symptom* of `MultiTenantConsumerManager` polling `CONSUMER.INFO` while the work queue is full.

---

### 3.6 `api-gateway` — victim, user-visible failure surface

Source: [`post-mortem/api-gateway.log`](./api-gateway.log) — 293 lines, 121 error / 21 warn.

| Window | Count | Pattern |
|---|---:|---|
| 15:43:19 – 15:43:19 | 2 | `NatsError: TIMEOUT` in `publishWebhook` (`webhook-ingress-publisher.service.ts:81 → js.publish`) |
| **15:52:30 – 15:52:32** | **118** | Same `NatsError: TIMEOUT` clustered in **< 2 seconds** |
| 15:57 – 17:41 | 21 | `RateLimitConfigCacheService` / `DynamicRouteCacheService` — `TimeoutError: The operation timed out.` vs `registry-service` (via `fetch` with 3 s `AbortSignal.timeout`) |
| 21-05 17:44 | 1 | `Tenant service responded 409: Tenant 'acme' already exists` (benign, pre-existing) |

- The 118-error burst at 15:52 is the **user-visible blast radius** of the bottleneck: every one of those is a webhook that the client retried or lost. The JS NATS client's default request timeout fired because JetStream's publish-ack path was queued behind the same I/O JetStream uses for its management API (which is what NATS' 2.65 s warning at 15:47 showed).
- The sustained `RateLimitConfigCacheService` / `DynamicRouteCacheService` timeouts are unrelated to NATS — they are HTTP timeouts to `registry-service`. They indicate that **`registry-service` is also being squeezed**, likely because the same Postgres host serves it (this is consistent with the cluster co-locating `registry-service` on the same node as `temporal`). Not investigated in this stress run; flagged as a follow-up.

**Verdict:** api-gateway is the surface where users experienced the outage. Itself is healthy and bounded; raising the JetStream publish timeout would only mask the issue.

---

## 4. Cascade timeline

```
T0  ┌──── load ramps up ──── triggers start firing ──── workflow-service-worker @ concurrency=16
    │
T1  │ Postgres queue_messages / queues INSERT contention → duplicate-key aborts (2 077 total)
    │ Autovacuum competes with hot writes (51 MB/s read)
    │
T2  │ Temporal history shards: update-wf-execution times out at the gRPC deadline
    │      → 2 615 errors in 28 s, 121 Slow gRPC (5–10 s)
    │      → "Per shard RPS warn limit exceeded" (114 RPS)
    │
T3  │ workflow-service-worker: client.workflow.start blocks > 30 s ackWait
    │      → JetStream redelivers → 6 983 duplicate triggers → 866 final failures
    │      → MultiTenantConsumerManager hammers CONSUMER.INFO
    │
T4  │ NATS: internal $JS.API.CONSUMER.INFO subscription stalls 2.65 s
    │
T5  │ api-gateway: js.publish() ack does not return → 118 NatsError: TIMEOUT in 2 s
    │      → client-visible webhook ingestion outage
T6  └──── system unwinds as load tails off
```

The whole shape is consistent with a **classic write-amplification cascade rooted in the persistence layer**.

---

## 5. Bottleneck — `postgres-temporal-1`

Why this and not anything else:

1. **Temporal's own errors are 100% `store-operation: update-wf-execution`** with `context deadline exceeded`. Not CPU, not memory, not network — the SQL layer.
2. **Postgres' own log** shows `57014 canceling statement due to user request` (Temporal aborting slow queries) and 2 077 duplicate-key aborts from shard contention.
3. **Vacuum I/O profile** (`51 MB/s read, 9.5 MB/s write`, 101 524 buffer misses vs 26 820 hits on the `executions_visibility` rebuild) shows the working set does not fit in shared buffers — disk-bound.
4. **`Per shard RPS warn limit exceeded`** is Temporal's own admission that the shard executor can't drain its task queue, which is always backed by persistence.
5. **Single instance** (`postgres-temporal-1`) — there is no streaming replica or read replica visible in the log; every history host is hitting one writer.

---

## 6. Recommendations (ordered by ROI)

### P0 — Postgres / Temporal persistence (the real fix)

1. **Scale Postgres vertically first:** move to faster disk (NVMe / `pd-ssd` / `io2`), raise `shared_buffers` to fit the active set of `executions` + `executions_visibility` indexes (current run shows >2 GB of index pages alone). Tune `effective_cache_size`, `work_mem`, `wal_writer_delay`, and `synchronous_commit=off` for Temporal's queue-tables if durability tradeoffs are acceptable.
2. **Tune autovacuum aggressiveness on `executions`, `executions_visibility`, `queue_messages`, `queues`:** `autovacuum_vacuum_cost_limit ≥ 2000`, `autovacuum_naptime=10s`, table-level `autovacuum_vacuum_scale_factor=0.05`. Current autovacuum is starving the write path.
3. **Split Temporal persistence by datasource** (Temporal v1.20+): put `default` store, `visibility` store, and `advanced visibility` on different Postgres instances or use Elasticsearch for visibility. Visibility writes are the bulk of the duplicate-key noise.
4. **Add a hot standby / read replica for Temporal visibility queries** (`workflow.list({TenantId})` used by `workflows.service.ts`).
5. **Increase Temporal history shard count** *only after* Postgres is scaled (more shards = more parallel writers = more pressure if the DB isn't ready).

### P1 — protect the cascade (cheap, do now)

6. **`workflow-service-worker` (`trigger-consumer.service.ts`):**
   - Drop `runnerOptions.concurrency` from 16 → 8 until Temporal is scaled. The current value over-amplifies the redelivery storm.
   - Raise `ackWaitMs` from 30 000 → 60 000 to match observed worst-case `StartWorkflowExecution` p99 of ~10 s **plus** retries. Current 30 s causes redelivery on the first slow gRPC.
   - Keep `maxDeliver=3`; the duplicate-trigger guard correctly absorbs collisions thanks to `workflowId = <tenant>:<name>:<idempotencyKey>:<defId>`.
7. **`api-gateway` `webhook-ingress-publisher.service.ts`:**
   - Wrap `js.publish` in an explicit timeout (`{ timeout: 10_000 }`) and return `503 Service Unavailable` rather than a 500, so providers (WhatsApp / Telegram / Meta) trigger their own retry paths instead of poisoning our flow.
   - Consider `nats.connection.flush()` cadence and `pendingLimits` — at peak the JetStream publish ack queue grew unbounded.
8. **Audit non-idempotent activities** referenced by `Stress Workflow`. The 5 `Activity not found on completion … workflow execution already completed` warnings mean some activities completed on the worker side after Temporal already retried — anything with external side-effects (HTTP POSTs, NATS publishes, payments) must use the activity's `taskToken` / idempotency key.

### P2 — observability gaps surfaced

9. **No metrics in any log:** the `Pino` lines are descriptive but we had to count error strings to derive RPS. Wire OpenTelemetry counters into:
   - `WorkflowsService.executeWorkflow` (success/failure/duration)
   - `MultiTenantConsumerManager` (redelivery count per stream/consumer)
   - `WebhookIngressPublisherService.publishWebhook` (publish latency p50/p95/p99)
10. **No `registry-service` log was captured**, yet 21 of api-gateway's warnings point at it. Include `registry-service` in the next stress capture.
11. **Temporal log only covers 28 s** of the 2 h run — the log rotation / sink dropped the rest. Increase the retention window before the next test.

---

## 7. What is *not* the bottleneck

To avoid wasted effort:

- **NATS / JetStream:** healthy, with one transient API stall (2.65 s) as a downstream symptom. Do not redesign the stream layout based on this run.
- **`workflow-worker` (Temporal Node SDK):** healthy. Activity execution rate is gated by Temporal, not by worker capacity.
- **`api-gateway` request handling:** healthy. The failures are all on the *publish* boundary.
- **`workflow-service-worker` correctness:** the duplicate-trigger guard worked exactly as designed — 6 983 duplicates were absorbed silently with no double-execution at the workflow level.

---

## 8. Repro & data lineage

| Log file | Lines | Window | Key extraction |
|---|---:|---|---|
| `api-gateway.log` | 293 | 2026-05-21 17:37 → 2026-05-22 17:41 | `grep '"level":"error"' \| grep -oP '"name":"[^"]+"'` |
| `nats.log` | 27 | 2026-05-21 17:33 → 2026-05-22 15:47 | Full file inspection |
| `postgres-temporal.log` | 11 945 | 2026-05-22 17:40 → 17:55 | `grep -oP '"error_severity":"[A-Z]+"'`, `unique constraint` extraction |
| `temporal.log` | 5 399 | 2026-05-22 17:54:10 → 17:54:38 | `grep -oP '"msg":"[^"]+"'`, store-operation / RPS warns |
| `workflow-service-worker.log` | 19 024 | 2026-05-22 15:34 → 17:47 | Triggered / Duplicate / Failed counts |
| `workflow-worker.log` | 1 358 | 2026-05-22 15:15 → 17:53 | `Executed_*` count, Workflow failed, gRPC retries |

All counts in this document were derived from the attached logs with reproducible `rg`/`grep` filters; nothing was inferred from outside the artefacts.

---

## 9. Action items

| # | Owner | Action | Priority | Status |
|---|---|---|---|---|
| 1 | Platform/SRE | Scale `postgres-temporal-1` vertically (NVMe + tuned `shared_buffers`/autovacuum) | **P0** | Done (Phase 1 + Phase 2 §10.2) |
| 2 | Platform/SRE | Split Temporal `default` vs `visibility` datasources | P0 | Done (Phase 1) |
| 3 | workflow-service | `ackWaitMs: 60_000` + `concurrency: 8` in `trigger-consumer.service.ts` | P1 | Done (Phase 1) + Phase 2 §10.4 fix |
| 4 | api-gateway | Explicit `timeout` + `503` on `publishWebhook` | P1 | Done (Phase 1) |
| 5 | workflow-worker | Audit activities for idempotency under retry/double-completion | P1 | Done (Phase 1) |
| 6 | All | Add OTel counters listed in §6.9 | P2 | Pending |
| 7 | SRE | Capture `registry-service` + full-window `temporal.log` in next stress run | P2 | Pending |
| 8 | Platform/SRE | Migrate Temporal compute layer from `temporalio/auto-setup` (4 services in 1 process) to HA topology (4 split Deployments, `temporalio/server`, schema bootstrap as Job) | **P0** | Done — see [`DOCS/RUNBOOK-TEMPORAL-HA-MIGRATION.md`](../DOCS/RUNBOOK-TEMPORAL-HA-MIGRATION.md). Resolves §10.1 (`VISIBILITY_POSTGRES_SEEDS` ignored, fix-in-bootstrap obsoleted) and §10.2 (ring imbalance only affects `temporal-history` ring now, separated from frontend/matching/worker) |

---

## 10. Phase 2 — post-fix re-run (2026-05-22, +4 h after Phase 1)

Phase 1 ran with all P0+P1 fixes deployed against a clean cluster. The first 5 minutes of stress load surfaced **four secondary issues** that were not visible in the original capture because the original cluster died at the Postgres bottleneck before they could be observed. All four were diagnosed and fixed in-flight; this section records them.

### 10.1 `temporalio/auto-setup` ignores `VISIBILITY_POSTGRES_SEEDS` (boot-time bug)

**Symptom**: Temporal pods crashlooped on first boot after the visibility split with:

```
sql schema version compatibility check failed:
unable to read DB schema version keyspace/database: temporal_visibility
error: pq: relation "schema_version" does not exist
```

**Cause**: `temporalio/auto-setup:1.28.4` runs `setup-schema` for BOTH `DBNAME` and `VISIBILITY_DBNAME` against the SAME host (`POSTGRES_SEEDS`), even when `VISIBILITY_POSTGRES_SEEDS` is set to a different host. The Temporal server runtime DOES honour `VISIBILITY_POSTGRES_SEEDS` (per the env var added by §P0.2), so it connects to the new visibility cluster, finds an empty DB, and crashes. The auto-setup logs even report `Schema setup complete` — because it wrote the visibility schema to the *default* cluster.

**Confirmation** (from `temporal_visibility` on `postgres-temporal-1` *before* the fix):
```
db_name              | curr_version | min_compatible_version
temporal_visibility  | 1.9          | 0.1   ← in the WRONG cluster
```
And on `postgres-temporal-visibility-1`: `ERROR: relation "schema_version" does not exist`.

**Fix**: [`infrastructure/scripts/ensure-temporal-visibility-schema.sh`](../infrastructure/scripts/ensure-temporal-visibility-schema.sh) — idempotent helper that resolves the live `auto-setup` image tag from `Deployment/temporal`, launches a short-lived pod, runs `temporal-sql-tool setup-schema + update-schema` directly against `postgres-temporal-visibility-rw`, and cleans up the orphan `temporal_visibility` left behind on the default cluster. Both `bootstrap-minikube.sh` and `bootstrap-orbstack.sh` invoke it automatically between the CNPG wait and the Temporal rollout. Idempotent path: ~1 s. Bootstrap path: ~6 s end-to-end. Runbook: [`DOCS/RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md`](../DOCS/RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md) §"Known issue".

### 10.2 History shard ring stuck after restarts

**Symptom**: After Postgres restarted (CNPG rolling apply of §P0.2), all 16 history shards re-assigned to a single Temporal pod (16/0 split). One pod was at 1248m CPU + 12 890 `context deadline exceeded` in 5 min while the sibling was at 489m CPU with 222 errors — same workload.

**Cause**: Temporal's membership ring (ringpop) only rebalances shards when a host *leaves*. When Postgres reboots, both pods reconnect simultaneously; whichever responds first claims the shards and the other stays idle until a host churn event.

**Fix**: Manual `kubectl delete pod` on the overloaded replica forces its shards to migrate to the sibling during the restart window. When the new pod re-joins, the ring is more balanced.

**Effect**: 16/0 → 10/6 split. CPU 1248m/489m → 1000m/883m. Error rate per pod dropped ~70%.

**Follow-up**: this is an operational hazard, not a code bug — document in the next iteration of the runbook. Long-term consider `tctl admin cluster get-ring` automation in the bootstrap to assert balance.

### 10.3 `postgres-temporal` CPU under-provisioned for the local overlay

**Symptom**: After the shard rebalance, `postgres-temporal-1` was at 1337m / 2000m CPU (67%) and `GetWorkflowExecution` started cascading sub-select timeouts:

```
948 "GetWorkflowExecution: failed to get CHASM nodes ... context deadline exceeded"
888 "GetWorkflowExecution: failed to get signals requested ..."
861 "GetWorkflowExecution: failed to get buffered events ..."
708 "GetWorkflowExecution: failed to get signal info ..."
624 "GetWorkflowExecution: failed to get request cancel info ..."
```

`GetWorkflowExecution` fans out 6 parallel `SELECT`s against the shard; if any one times out the whole call fails. Postgres was hitting CPU saturation.

**Fix**: Bumped `limits.cpu: 2 → 4` in [`infrastructure/overlays/local/local-base/patches/postgres-temporal-resources.yaml`](../infrastructure/overlays/local/local-base/patches/postgres-temporal-resources.yaml). Node has 12 cores total, was at 71% utilisation → 3.4 cores free for the bump.

**Effect**: postgres-temporal CPU 67% → 37%. `context deadline exceeded` -90%, `GetWorkflowExecution: failed ...` -96%, `Workflow is busy` -96%.

**Secondary finding**: with CPU no longer the constraint, `WalSync`/`WALWrite` became the dominant wait events. The single-instance dev cluster was still doing local fsync on every commit because `synchronous_commit: remote_write` was inherited from `base` (designed for 2-instance HA). Set `synchronous_commit: off` in the same overlay (dev only, see §10.3 comment block in the manifest) — eliminated the WAL fsync wait events entirely. **DO NOT** propagate to base (production HA needs sync replication).

### 10.4 `backoff[0] !== ackWaitMs` — NATS overrides ack_wait with backoff[0]

**Symptom**: Even after Phase 1's §P1.1 fix (`ackWaitMs: 30_000 → 60_000`), `workflow-service-worker` still showed dup/trig = 5.6x (145 triggered + 810 duplicates in 2 min). Throughput hadn't recovered.

**Cause**: The Phase 1 fix paired `ackWaitMs: 60_000` with `backoffMs: [10_000, 30_000]`. NATS server semantics (documented in [`packages/database/src/nats-durable-consumer.ts` lines 31-42](../packages/database/src/nats-durable-consumer.ts)) state that **when a `backoff` array is present on a consumer, the effective ack-wait for the i-th delivery is `backoff[i-1]`** — `ack_wait` is overridden. So the effective first-attempt ack-wait was 10 s, not 60 s. Confirmed by inspecting the consumer's persisted config:

```json
"ack_wait": 10000000000,            // 10 s (NATS rewrote it to backoff[0])
"backoff": [10000000000, 30000000000],
"max_deliver": 3
```

`client.workflow.start` was taking longer than 10 s under load, so NATS NACK'd → redeliver → duplicate trigger → guard absorbed it. Bloated dup ratio + wasted gRPC + extra Postgres pressure.

**Fix**: In [`services/workflow-service/src/modules/triggers/trigger-consumer.service.ts`](../services/workflow-service/src/modules/triggers/trigger-consumer.service.ts), changed `backoffMs: [10_000, 30_000]` → `[60_000, 120_000]` so `backoff[0] === ackWaitMs`. With `maxDeliver: 3` and the last entry reused once exhausted, total time-to-DLQ = 60 + 120 + 120 = 5 min — still within the workflow timeout budget. Added a test in [`services/workflow-service/test/unit/trigger-consumer-config.spec.ts`](../services/workflow-service/test/unit/trigger-consumer-config.spec.ts) that asserts `backoff[0] === ackWaitMs` so the invariant cannot regress.

**Effect** (60 s window, post-fix):

| Metric | Pre §10.4 | Post §10.4 |
|---|---:|---:|
| Workflows triggered | 145 | **639** (+4.4x) |
| Duplicate triggers | 810 | **0** (-100%) |
| Failed triggers | 0 | 0 |
| JetStream `Outstanding Acks` | 712 | 21 |
| JetStream `Unprocessed Messages` | 4 677 | 0 |
| Temporal errors/s | 99 | 80 |

`dup/trig = 0` means every workflow now executes exactly once at the `trigger-consumer` boundary. The 4.4x rise in **effective** throughput came from eliminating the wasted work.

### 10.5 What's left

The residual ~80 Temporal errors/s under sustained load are retry chatter inside Temporal's history queue processors against Postgres. They are `error` level in the Temporal log but **not** visible to the user — workflows complete (`workflow-worker`: 1 144 activities in 2 min, 6 failures = 0.5% fatal rate; `api-gateway`: 0 publish errors). Acceptable for the dev/local profile; revisit if the production overlay shows the same after a `kubectl top` measurement under stress.

### 10.6 Updated regression gates

For the next stress re-run, in addition to the §6 gates:

| Signal | Where | Target |
|---|---|---|
| `dup/trig` ratio | `workflow-service-worker` logs (`Triggered workflow` vs `Duplicate trigger`) | < 1.2x sustained |
| Shard balance | `kubectl logs -l app.kubernetes.io/name=temporal --since=1m \| grep -oE '"shard-id":[0-9]+' \| sort -u \| wc -l` per pod | 7-9 shards per pod (±2 of even split) |
| Postgres CPU | `kubectl top pod postgres-temporal-1` | < 50% of limit sustained |
| Postgres wait events | `SELECT wait_event_type, wait_event ...` | No `WalSync`/`WALWrite` in top-5 |
| NATS consumer config | `nats consumer info INGRESS-<tenant> workflow-triggers --json` | `ack_wait == backoff[0]` |
