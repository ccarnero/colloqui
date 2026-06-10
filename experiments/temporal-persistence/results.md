# Temporal Persistence Experiment Results

## Current Pre-Experiment State

The cluster is not clean yet. Current evidence before controlled runs:

- Temporal running workflows: `20138`.
- `workflow-triggers` JetStream pending: `8462`.
- `workflow-triggers` ack pending: `722`.
- `postgres-temporal-1`: about `992m` CPU.
- `postgres-temporal-visibility-1`: about `500m` CPU.
- Temporal DB commit rate: about `4601/s`.
- Temporal DB insert rate: about `831/s`.
- Temporal DB update rate: about `455/s`.
- Temporal DB write time rate: about `4.87`.
- Temporal persistence p95: `GetWorkflowExecution` about `1.56s`, `UpdateWorkflowExecution` about `0.14s`.

Conclusion: do not use this state as an experiment baseline. Drain or purge first.

## Runs

| Label | Rate | Duration | Change | Gateway p95 | E2E p95 | Running workflows after | workflow-triggers pending after | Temporal DB write time | Verdict |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| baseline-25rps | 25 rps | 2m | baseline | n/a | n/a | n/a | n/a | n/a | Invalid: zero iterations because the first runner version tried to activate `baseline`; k6 preserved only zero-duration `medium`. |
| baseline-25rps-v2-invalid | 25 rps | 2m | baseline | n/a | n/a | n/a | n/a | n/a | Invalid: `STRESS_TARGET=http://192.168.139.2` disabled the Knative Host header, producing request timeouts/status `0`. Use `KOURIER_HOST=192.168.139.2 KOURIER_PORT=80 API_GATEWAY_URL=http://api-gateway.platform-services-dev.127.0.0.1.sslip.io` instead. |
| baseline-25rps-fixed | 25 rps | 2m | baseline | 5.4 ms | n/a | 0 | 0 | low | Invalid for e2e: used wrong Telegram secret (`manual`). Gateway ack was `100%`, but channel-service dropped the webhook before starting workflows. |
| baseline-25rps-valid | 25 rps | 2m | baseline + Redis cluster reinit + k6 startRate fix | 29.25 ms | 32065.85 ms | 0 | 0 | 1.7448 | Valid 25 rps baseline: 2999 sent, 3027 sink rows fetched, 0 lost by reconcile, workflow-triggers/channel-webhook-ingress pending/ack/redelivered all 0. Temporal Postgres not saturated (`postgres-temporal-1` 49m CPU post-run). |
| baseline-50rps-valid | 50 rps | 2m | baseline | 436.64 ms | 491301.80 ms | 0 | 0 | 1.9236 | Valid stress datapoint but SLO failed: 5982 sent, 0 HTTP failures, 17 dropped iterations, filtered sink 5968 delivered / 14 lost. Temporal Postgres not CPU-saturated post-drain, but `GetWorkflowExecution` p95 rose to 1.78s. |
| baseline-100rps-valid | 100 rps | 2m | baseline | 1.37 s | 1652535.69 ms | 0 after long drain; 673 at pressure capture | 5448 at pressure capture; 0 after drain | 2.0697 after drain | Overload point: 11631 sent, 0 HTTP failures, 368 dropped iterations, k6 hit 200 VU ceiling, filtered sink 11370 delivered / 261 lost / 1 duplicate. Pressure capture showed `postgres-temporal-1` 881m CPU and `GetWorkflowExecution` p95 2.5s. |
| cap4-50rps | 50 rps | 2m | `workflow-service-worker` max replicas 8 -> 4 | 258.48 ms | 665348.19 ms | 0 after drain; 345 at pressure capture | 4674 at pressure capture; 0 after drain | n/a | Rejected candidate: ingress ack improved and dropped iterations fell to 0, but e2e p95 worsened versus baseline 50 rps and `workflow-triggers` accumulated backlog (`337` ack pending). Restored max replicas to 8. |
| workflow-worker-cap6-50rps | 50 rps | 2m | `workflow-worker` max replicas 12 -> 6 | 30.30 ms | 285870.06 ms | 0 after drain; 227 at pressure capture | n/a | n/a | Accepted local-dev candidate: 5999 sent, 0 HTTP failures, 0 dropped iterations, filtered sink 5994 delivered / 5 lost. Improves both ingress and e2e versus baseline 50 rps, though Temporal Postgres still reached ~878m CPU. |
| workflow-worker-cap6-100rps | 100 rps | 2m | `workflow-worker` max replicas 12 -> 6 | 87.45 ms | 1515381.91 ms | 0 after long drain; 721 at pressure capture | 2923 at stalled capture; 0 after drain | n/a | Mixed but better than baseline 100 rps: 11999 sent, 0 HTTP failures, 0 dropped iterations, filtered sink 11842 delivered / 157 lost. Ingress is fixed, but workflow-trigger drain remains the bottleneck; workflows kept starting long after k6 stopped. |
| minimal-workflow-cap6-100rps | 100 rps | 2m | cap6 + stress workflow removes synthetic parallel branch | 765.25 ms | 1220253.96 ms | 0 after drain; 419 at pressure capture | 10424 at pressure capture; 0 after drain | n/a | Rejected as replacement: e2e p95 and loss improved versus full cap6 100 rps, but ingress regressed badly (176 dropped iterations, k6 hit 200 VUs, gateway p95 765ms). Restored full workflow fixture. |

## Pre-Flight Fixes Found During Baseline

- Direct Kourier IP load must not use `STRESS_TARGET`; that disables the Host header in `tests/stress/lib/env.ts`.
- The current acme Telegram channel secret is `anothersecret`; gateway ack alone does not prove the channel-service accepted the webhook.
- Redis cluster must be `cluster_state:ok` with all `16384` slots assigned before running connector-runtime workloads. Reinitialized with `job/redis-cluster-reinit-20260528` after Redis reported zero slots.
- `webhook-ingress.ts` was hard-coding `startRate: 1`; fixed it to use each stage's configured `startRate`, so controlled runs are actually flat at the target rate.
- The runner fetches sink logs immediately after k6; for e2e latency, wait for Temporal running workflows to drain, then fetch sink logs and rerun reconcile.
- Stress-sink logs are cumulative for the pod. For per-run reconcile, filter sink rows by the k6 send time window before reconciling; otherwise delivered counts include previous runs.

## Current Reading

- 25 rps: ingress, NATS consumers, Temporal, and e2e all complete, but e2e p95 is already ~32s.
- 50 rps: ingress still returns 2xx, but gateway ack p95 exceeds target and e2e p95 grows to ~491s with small loss.
- Capping `workflow-service-worker` from 8 to 4 is not the fix: it reduces gateway ack p95 from ~436ms to ~258ms, but increases e2e p95 from ~491s to ~665s by starving workflow starts and building `workflow-triggers` backlog.
- Capping `workflow-worker` from 12 to 6 is the first useful tuning: 50 rps gateway p95 improves from ~436ms to ~30ms and e2e p95 from ~491s to ~286s; 100 rps gateway p95 improves from ~1.37s to ~87ms with no k6 drops.
- 100 rps: overload. k6 cannot sustain the target cleanly (`368` dropped iterations, 200 VU ceiling), workflow-trigger backlog appears during pressure, and Temporal persistence becomes hot (`postgres-temporal-1` ~881m, `GetWorkflowExecution` p95 ~2.5s).
  With `workflow-worker` cap6, k6 sustains 100 rps cleanly, but e2e still takes ~25 minutes p95 and `workflow-triggers` remains backed up after ingress stops.
- Removing the synthetic branch from the stress workflow improves eventual e2e (`~1220s` vs `~1515s`) and loss (`66` vs `157`) at 100 rps, but it overwhelms workflow-start backlog and breaks ingress SLO (`765ms` p95, `176` dropped iterations), so it is useful evidence but not the default fixture.

Working hypothesis: the first visible SLO failure was gateway/ack latency caused by Temporal execution workers over-amplifying persistence pressure. `workflow-worker` cap6 fixes that ingress symptom and improves 50 rps e2e. The remaining 100 rps bottleneck is workflow-start drain plus Temporal persistence: `workflow-triggers` continues feeding new workflows long after k6 stops, while Temporal Postgres stays near one local CPU core. Reducing per-workflow work helps completion once started, but also allows the trigger queue to build faster than Temporal can accept starts under this local DB ceiling.

## Candidate Change 1 - Rejected

Cap workflow-start pressure before increasing workers:

```bash
kubectl -n platform-services-dev patch scaledobject workflow-service-worker-scaler --type merge \
  -p '{"spec":{"maxReplicaCount":4}}'
```

Re-run the same 25/50/100 rps matrix and compare backlog slope, e2e p95, and Temporal persistence latency.

Result from `cap4-50rps`: rejected and restored to `maxReplicaCount=8`. Gateway p95 improved, but end-to-end p95 worsened and `workflow-triggers` backlog appeared at 50 rps.
