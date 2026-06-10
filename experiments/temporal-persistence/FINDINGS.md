# Temporal Persistence Stress Findings

The fixed stress matrix shows the system is healthy at 25 rps, starts missing SLOs at 50 rps, and overloads at 100 rps. The strongest evidence points to workflow-start and workflow-execution pressure cascading into Temporal history/persistence saturation, not Redis or Kourier routing.

Follow-up tests:

- Capping `workflow-service-worker` max replicas from 8 to 4 is not a fix. It improved ingress ack latency at 50 rps but worsened end-to-end latency by starving workflow starts and creating `workflow-triggers` backlog.
- Capping `workflow-worker` max replicas from 12 to 6 is the first useful local-dev tuning. It fixes ingress latency at 50 and 100 rps and improves 50 rps e2e, but 100 rps still overloads workflow-start drain and Temporal persistence.
- Removing the synthetic parallel branch from the stress workflow reduces eventual completion latency at 100 rps, but it makes ingress worse by allowing the trigger/start backlog to grow much larger.

## Outcome

| Rate | Verdict | Key Evidence |
| ---: | --- | --- |
| 25 rps | Healthy baseline, but e2e latency already noticeable | 2999 sent, 0 HTTP failures, gateway p95 29.25 ms, e2e p95 32.1s, Temporal running workflows drained to 0. |
| 50 rps | First SLO failure point | 5982 sent, 0 HTTP failures, gateway p95 436.64 ms, 17 dropped iterations, e2e p95 491.3s, 14 lost after filtered reconcile. |
| 100 rps | Overload | 11631 sent, 0 HTTP failures, gateway p95 1.37s, 368 dropped iterations, e2e p95 1652.5s, 261 lost, 1 duplicate. |
| 50 rps, cap4 | Rejected tuning candidate | 5999 sent, 0 HTTP failures, gateway p95 improved to 258.48 ms and dropped iterations to 0, but e2e p95 worsened to 665.3s and `workflow-triggers` reached 4674 pending / 337 ack pending. |
| 50 rps, workflow-worker cap6 | Accepted local-dev tuning | 5999 sent, 0 HTTP failures, 0 dropped iterations, gateway p95 30.30 ms, e2e p95 285.9s, 5 lost. |
| 100 rps, workflow-worker cap6 | Ingress fixed, downstream still overloaded | 11999 sent, 0 HTTP failures, 0 dropped iterations, gateway p95 87.45 ms, e2e p95 1515.4s, 157 lost; `workflow-triggers` still drained after k6 stopped. |
| 100 rps, minimal workflow cap6 | Rejected as default fixture | 11824 sent, 0 HTTP failures, 176 dropped iterations, gateway p95 765.25 ms, e2e p95 1220.3s, 66 lost; `workflow-triggers` hit 10424 pending. |

## Main Finding

At 100 rps, the cascade becomes visible in Temporal and JetStream:

| Signal | 100 rps Pressure Value | Meaning |
| --- | ---: | --- |
| `workflow-triggers` pending | 5448 | Workflow-start consumer cannot keep up during pressure. |
| `workflow-triggers` ack pending | 1000 | Consumer reached the configured ack-pending ceiling. |
| `workflow-triggers` redelivered | 254 | NATS redelivery starts once trigger processing slows. |
| `postgres-temporal-1` CPU | 881m | Temporal persistence is near one local CPU core. |
| `GetWorkflowExecution` p95 | 2.5s | Temporal history/persistence reads become very slow. |
| Running workflows after 10 min drain | 696 | Workflow execution remains backed up well after ingress stops. |

Working hypothesis: workflow-start/execution pressure is too high for the local Temporal persistence layer. At 50 rps the user-visible SLO already fails; at 100 rps the same pressure cascades into Temporal persistence/history saturation.

The cap4 result refines the hypothesis: simply throttling the trigger worker reduces immediate Temporal write contention enough to improve gateway ack, but the system still cannot complete workflows fast enough. The bottleneck moves into workflow start backlog, so the next fix needs to reduce per-workflow Temporal pressure or execution latency, not just lower start concurrency.

The workflow-worker cap6 result shows the previous execution-worker ceiling was too aggressive for local Temporal Postgres. Reducing execution workers gives Temporal persistence enough headroom to keep ingress responsive. At 100 rps, however, the trigger consumer still cannot start/drain all workflows fast enough once Temporal Postgres approaches one local CPU core.

The minimal-workflow result shows there are two different bottleneck budgets:

- Once a workflow starts, fewer activities reduce completion latency and loss.
- Before workflows start, Temporal start throughput and the `workflow-triggers` consumer become the limiter. With the minimal fixture, the trigger queue grew to 10424 pending and ingress latency regressed.

The default stress fixture was restored after this experiment so future runs remain comparable to the baseline matrix.

## Plan Executed

1. Fix measurement contamination before trusting any stress result.
2. Verify Redis cluster health before load.
3. Run the fixed 25 rps baseline as a control.
4. Run the same fixed flow for 50 rps.
5. If 50 rps is valid, run the same fixed flow for 100 rps.
6. Wait for Temporal workflows to drain before reconciling sink delivery.
7. Record results and compare gateway, JetStream, Temporal task queues, Temporal persistence, and Postgres signals.

## Pre-Flight Fixes

These issues had to be fixed or controlled before the matrix was meaningful:

| Issue | Fix / Control |
| --- | --- |
| Direct `STRESS_TARGET=http://192.168.139.2` disabled the Knative Host header. | Use `KOURIER_HOST=192.168.139.2`, `KOURIER_PORT=80`, and `API_GATEWAY_URL=http://api-gateway.platform-services-dev.127.0.0.1.sslip.io`. |
| Wrong Telegram secret produced gateway 200s but channel-service dropped messages. | Use current acme channel secret: `TELEGRAM_WEBHOOK_SECRET=anothersecret`. |
| Redis cluster had `cluster_state:fail` and `cluster_slots_assigned:0`. | Reinitialized Redis with `job/redis-cluster-reinit-20260528`; verified `cluster_state:ok`, `16384` slots. |
| Manual Temporal DB purge left connector-runtime with stale slots and no pollers. | Restarted `connector-runtime` after Redis/Temporal cleanup. |
| k6 scenario hard-coded `startRate: 1`, so “25 rps” averaged ~13 rps. | Added `buildPhase1ScenarioOptions()` and regression test; scenario now uses each stage's configured `startRate`. |
| Stress sink logs are cumulative. | Filter sink JSONL by the k6 send-time window before reconcile. |

## Commands Used

### Redis Health Check

```bash
kubectl -n support-services-dev exec redis-0 -- redis-cli cluster info
kubectl -n support-services-dev exec redis-0 -- redis-cli cluster nodes
```

Expected before load:

```text
cluster_state:ok
cluster_slots_assigned:16384
cluster_slots_ok:16384
cluster_known_nodes:6
cluster_size:3
```

### Connector Runtime Sanity Check

```bash
pod=$(kubectl -n platform-services-dev get pods \
  -l app.kubernetes.io/name=connector-runtime \
  --field-selector=status.phase=Running \
  -o jsonpath='{.items[0].metadata.name}')

kubectl -n platform-services-dev exec "$pod" -- bun -e '
  import Redis from "ioredis";
  const c = new Redis.Cluster(
    [{ host: "redis.support-services-dev.svc.cluster.local", port: 6379 }],
    {
      enableReadyCheck: true,
      lazyConnect: true,
      redisOptions: { maxRetriesPerRequest: 2, commandTimeout: 1000 },
      slotsRefreshInterval: 5000,
      slotsRefreshTimeout: 2000,
    },
  );
  const t = Date.now();
  try { console.log("redis-get", await c.get("probe"), `${Date.now() - t}ms`); }
  finally { c.disconnect(); }
'
```

Observed before the 50 rps run:

```text
redis-get null 23ms
```

### Fixed Load Command

```bash
env -u STRESS_TARGET \
  API_GATEWAY_URL='http://api-gateway.platform-services-dev.127.0.0.1.sslip.io' \
  KOURIER_HOST='192.168.139.2' \
  KOURIER_PORT='80' \
  TELEGRAM_WEBHOOK_SECRET='anothersecret' \
  STRESS_FETCH_SINK=false \
  ./experiments/temporal-persistence/run-stage.sh <label> <rate> 2m
```

Labels used:

| Label | Rate |
| --- | ---: |
| `baseline-25rps-valid` | 25 |
| `baseline-50rps-valid` | 50 |
| `baseline-100rps-valid` | 100 |

### Captures

```bash
./experiments/temporal-persistence/capture.sh pre-baseline-50rps-valid
./experiments/temporal-persistence/capture.sh post-baseline-50rps-valid
./experiments/temporal-persistence/capture.sh pre-baseline-100rps-valid
./experiments/temporal-persistence/capture.sh post-baseline-100rps-pressure
./experiments/temporal-persistence/capture.sh post-baseline-100rps-drained
```

### Drain Check

```bash
kubectl -n support-services-dev exec deploy/temporal-frontend -- \
  temporal workflow count --query 'ExecutionStatus="Running"'

kubectl -n support-services-dev exec deploy/temporal-frontend -- \
  temporal task-queue describe --task-queue connector-runtime --task-queue-type activity
```

### Sink Fetch And Filtered Reconcile

Fetch the cumulative sink log:

```bash
cd tests/stress
./sink/fetch-jsonl.sh \
  --out '../../experiments/temporal-persistence/results/<label>/<label>.sink.jsonl'
```

Filter by the k6 send-time window, then reconcile:

```bash
jq -c 'select(.sent_at >= <start_ms> and .sent_at <= <end_ms>)' \
  '../../experiments/temporal-persistence/results/<label>/<label>.sink.jsonl' \
  > '../../experiments/temporal-persistence/results/<label>/<label>.filtered.sink.jsonl'

bun run reconcile/reconcile.ts \
  --scenario webhook-ingress \
  --sink '../../experiments/temporal-persistence/results/<label>/<label>.filtered.sink.jsonl' \
  --k6 'reports/<k6-output>.json' \
  --output reports
```

## Results Detail

### 25 rps

| Metric | Value |
| --- | ---: |
| Sent | 2999 |
| HTTP failures | 0% |
| Gateway p95 | 29.25 ms |
| Gateway p99 | 224.19 ms |
| E2E p50 | 22.19s |
| E2E p95 | 32.07s |
| Running workflows after drain | 0 |
| `workflow-triggers` pending after drain | 0 |
| `postgres-temporal-1` CPU post-run | 49m |

### 50 rps

| Metric | Value |
| --- | ---: |
| Sent | 5982 |
| HTTP failures | 0% |
| Dropped iterations | 17 |
| Gateway p95 | 436.64 ms |
| Gateway p99 | 1.48s |
| Filtered delivered | 5968 |
| Filtered lost | 14 |
| E2E p50 | 251.03s |
| E2E p95 | 491.30s |
| Running workflows after drain | 0 |
| `workflow-triggers` pending after drain | 0 |
| `GetWorkflowExecution` p95 post-drain | 1.78s |
| `postgres-temporal-1` CPU post-drain | 32m |

### 100 rps

| Metric | Value |
| --- | ---: |
| Sent | 11631 |
| HTTP failures | 0% |
| Dropped iterations | 368 |
| k6 max VUs | 200 |
| Gateway p95 | 1.37s |
| Gateway p99 | 3.36s |
| Filtered delivered after drain | 11370 |
| Filtered lost after drain | 261 |
| Duplicates | 1 |
| E2E p50 | 1026.11s |
| E2E p95 | 1652.54s |
| Running workflows at pressure capture | 673 |
| Running workflows after drain | 0 |
| `workflow-triggers` pending at pressure capture | 5448 |
| `workflow-triggers` ack pending at pressure capture | 1000 |
| `workflow-triggers` redelivered at pressure capture | 254 |
| `postgres-temporal-1` CPU at pressure capture | 881m |
| `GetWorkflowExecution` p95 at pressure capture | 2.5s |

### 50 rps with `workflow-service-worker` max replicas capped to 4

| Metric | Value |
| --- | ---: |
| Sent | 5999 |
| HTTP failures | 0% |
| Dropped iterations | 0 |
| Gateway p95 | 258.48 ms |
| Gateway p99 | 660.27 ms |
| Filtered delivered | 5979 |
| Filtered lost | 20 |
| E2E p50 | 413.13s |
| E2E p95 | 665.35s |
| Running workflows at pressure capture | 345 |
| Running workflows after drain | 0 |
| `workflow-triggers` pending at pressure capture | 4674 |
| `workflow-triggers` ack pending at pressure capture | 337 |
| `workflow-orchestrator` workflow backlog at pressure capture | 31 |
| `connector-runtime` activity backlog at pressure capture | 7 |
| `postgres-temporal-1` CPU at pressure capture | 787m |
| `postgres-temporal-visibility-1` CPU at pressure capture | 482m |

Verdict: rejected and restored to `maxReplicaCount=8`. It helps ingress ack but worsens the business outcome.

### 50 rps with `workflow-worker` max replicas capped to 6

| Metric | Value |
| --- | ---: |
| Sent | 5999 |
| HTTP failures | 0% |
| Dropped iterations | 0 |
| Gateway p95 | 30.30 ms |
| Gateway p99 | 212.06 ms |
| Filtered delivered | 5994 |
| Filtered lost | 5 |
| E2E p50 | 162.77s |
| E2E p95 | 285.87s |
| Running workflows at pressure capture | 227 |
| Running workflows after drain | 0 |
| `workflow-orchestrator` workflow backlog at pressure capture | 7 |
| `connector-runtime` activity backlog at pressure capture | 3 |
| `workflow-worker` slots at pressure capture | 48 workflow / 37 activity |
| `postgres-temporal-1` CPU at pressure capture | 878m |

Verdict: accepted for local dev. Persisted in `knative/services/overlays/local/dev/kustomization.yaml` as `workflow-worker-scaler` `maxReplicaCount=6`.

### 100 rps with `workflow-worker` max replicas capped to 6

| Metric | Value |
| --- | ---: |
| Sent | 11999 |
| HTTP failures | 0% |
| Dropped iterations | 0 |
| Gateway p95 | 87.45 ms |
| Gateway p99 | 232.02 ms |
| Filtered delivered | 11842 |
| Filtered lost | 157 |
| E2E p50 | 862.85s |
| E2E p95 | 1515.38s |
| Running workflows at pressure capture | 721 |
| Running workflows after drain | 0 |
| `workflow-triggers` pending at stalled capture | 2923 |
| `workflow-triggers` ack pending at stalled capture | 612 |
| `workflow-orchestrator` workflow backlog at pressure capture | 12 |
| `connector-runtime` activity backlog at pressure capture | 8 |
| `workflow-worker` slots at pressure capture | 66 workflow / 44 activity |
| `postgres-temporal-1` CPU at pressure capture | 956m |

Verdict: mixed but useful. It raises the ingress ceiling to 100 rps, but the business workflow still drains too slowly; the next bottleneck is `workflow-triggers` start backlog plus Temporal persistence.

### 100 rps with minimal workflow and `workflow-worker` max replicas capped to 6

Variant: removed the synthetic `Parallel Branch` step, leaving only `extractStressMeta` and `notifyStressSink` before the completion publisher.

| Metric | Value |
| --- | ---: |
| Sent | 11824 |
| HTTP failures | 0% |
| Dropped iterations | 176 |
| Gateway p95 | 765.25 ms |
| Gateway p99 | 2.17s |
| Filtered delivered | 11758 |
| Filtered lost | 66 |
| E2E p50 | 741.46s |
| E2E p95 | 1220.25s |
| Running workflows at pressure capture | 419 |
| Running workflows after drain | 0 |
| `workflow-triggers` pending at pressure capture | 10424 |
| `workflow-triggers` ack pending at pressure capture | 232 |
| `workflow-orchestrator` workflow backlog at pressure capture | 41 |
| `connector-runtime` activity backlog at pressure capture | 4 |
| `workflow-worker` slots at pressure capture | 19 workflow / 12 activity |

Verdict: rejected as the default benchmark fixture. It proves per-workflow work matters, but it lets the trigger/start backlog grow faster and breaks the ingress SLO. Full workflow fixture restored from `experiments/temporal-persistence/results/minimal-workflow-fixture/stress-workflow-before.json`.

## Next Controlled Change

Do not increase workers blindly, and do not hard-cap workflow starts too low. The next useful test should reduce per-message Temporal work or split the measurement into "webhook accept" versus "workflow completion" budgets.

Rejected candidate already tested:

```bash
kubectl -n platform-services-dev patch scaledobject workflow-service-worker-scaler --type merge \
  -p '{"spec":{"maxReplicaCount":4}}'
```

Do not repeat this as-is unless validating a different objective such as "optimize ack latency while accepting much worse e2e".

For the next candidate, compare:

- Gateway p95/p99 and dropped iterations.
- `workflow-triggers` pending, ack pending, and redeliveries.
- Temporal running workflows after k6 stops.
- Temporal persistence p95, especially `GetWorkflowExecution`, `CreateWorkflowExecution`, and `UpdateWorkflowExecution`.
- `postgres-temporal-1` CPU and write-time rate.
- Filtered e2e p50/p95/loss.

Next candidate to investigate before running more load: start-workflow throughput. The minimal fixture reduced per-workflow work, but `workflow-triggers` pending exploded. Inspect/measure `workflowService.executeWorkflow` latency and Temporal `CreateWorkflowExecution` latency under load, then test whether trigger concurrency can be shaped dynamically without starving starts or overloading Temporal Postgres.

## Artifacts

| Artifact | Purpose |
| --- | --- |
| `experiments/temporal-persistence/results.md` | Compact running results table and current interpretation. |
| `experiments/temporal-persistence/results/pre-baseline-50rps-valid` | 50 rps pre-capture. |
| `experiments/temporal-persistence/results/post-baseline-50rps-valid` | 50 rps post-drain capture. |
| `experiments/temporal-persistence/results/baseline-50rps-valid/baseline-50rps-valid.filtered.sink.jsonl` | 50 rps filtered sink rows. |
| `tests/stress/reports/webhook-ingress-20260528-111910.k6.summary.json` | 50 rps k6 summary. |
| `tests/stress/reports/webhook-ingress-2026-05-28T14-32-00-757Z.reconcile.csv` | 50 rps filtered reconcile. |
| `experiments/temporal-persistence/results/pre-baseline-100rps-valid` | 100 rps pre-capture. |
| `experiments/temporal-persistence/results/post-baseline-100rps-pressure` | 100 rps pressure capture while workflows were still running. |
| `experiments/temporal-persistence/results/post-baseline-100rps-drained` | 100 rps post-drain capture. |
| `experiments/temporal-persistence/results/baseline-100rps-valid/baseline-100rps-valid.drained.filtered.sink.jsonl` | 100 rps filtered sink rows after drain. |
| `tests/stress/reports/webhook-ingress-20260528-113342.k6.summary.json` | 100 rps k6 summary. |
| `tests/stress/reports/webhook-ingress-2026-05-28T15-04-49-165Z.reconcile.csv` | 100 rps filtered reconcile. |
| `experiments/temporal-persistence/results/pre-cap4-50rps` | cap4 50 rps pre-capture. |
| `experiments/temporal-persistence/results/post-cap4-50rps-pressure` | cap4 50 rps pressure capture. |
| `experiments/temporal-persistence/results/post-cap4-50rps-drained` | cap4 50 rps post-drain capture. |
| `experiments/temporal-persistence/results/cap4-50rps/summary.csv` | cap4 normalized comparison row. |
| `tests/stress/reports/webhook-ingress-20260528-142611.k6.summary.json` | cap4 50 rps k6 summary. |
| `experiments/temporal-persistence/results/workflow-worker-cap6-50rps/summary.csv` | workflow-worker cap6 50 rps normalized comparison row. |
| `experiments/temporal-persistence/results/post-workflow-worker-cap6-50rps-pressure` | workflow-worker cap6 50 rps pressure capture. |
| `experiments/temporal-persistence/results/post-workflow-worker-cap6-50rps-drained` | workflow-worker cap6 50 rps post-drain capture. |
| `experiments/temporal-persistence/results/workflow-worker-cap6-100rps/summary.csv` | workflow-worker cap6 100 rps normalized comparison row. |
| `experiments/temporal-persistence/results/post-workflow-worker-cap6-100rps-pressure` | workflow-worker cap6 100 rps pressure capture. |
| `experiments/temporal-persistence/results/post-workflow-worker-cap6-100rps-stalled` | workflow-worker cap6 100 rps stalled/draining capture showing trigger backlog. |
| `experiments/temporal-persistence/results/post-workflow-worker-cap6-100rps-drained` | workflow-worker cap6 100 rps post-drain capture. |
| `experiments/temporal-persistence/results/minimal-workflow-fixture/stress-workflow-before.json` | Snapshot used to restore full stress workflow after minimal experiment. |
| `experiments/temporal-persistence/results/minimal-workflow-fixture/stress-workflow-minimal-applied.json` | Snapshot of the applied minimal workflow fixture. |
| `experiments/temporal-persistence/results/minimal-workflow-cap6-100rps/summary.csv` | Minimal workflow cap6 100 rps normalized comparison row. |
| `experiments/temporal-persistence/results/post-minimal-workflow-cap6-100rps-pressure` | Minimal workflow pressure capture. |
| `experiments/temporal-persistence/results/post-minimal-workflow-cap6-100rps-drained` | Minimal workflow post-drain capture. |

## Verification

Final verification after the matrix:

```text
Redis: cluster_state:ok, cluster_slots_assigned:16384
Temporal running workflows: Total: 0
bun test lib/stages.test.ts: 1 pass, 0 fail
bun run build: tsc --noEmit passed
git diff --check: passed
```
