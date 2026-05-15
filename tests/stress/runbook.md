# Phase 1 — Runbook

Operational guide for running Phase 1 stress tests against a live cluster.

## Pre-flight (T-30 min)

1. **Cluster sanity**
   - `kubectl get pods -A` — no `CrashLoopBackOff`, no Knative services scaling
     from zero.
   - `kubectl get hpa -n platform-services-dev` — current replicas baseline.
   - Grafana: open the `stress-gateway`, `stress-jetstream`, `stress-e2e`
     dashboards (or the equivalent `api-gateway`, `nats-jetstream`,
     `event-processor` dashboards). Confirm Prometheus is scraping.
2. **Stress sink**
   - `kubectl apply -f tests/stress/phase1/sink/knative-service.yaml`
   - Verify it serves: `kubectl exec -n platform-services-dev deploy/api-gateway-XX
     -- curl -s http://stress-sink.platform-services-dev.svc.cluster.local/healthz`
3. **Tenant + credentials**
   - The tenant slug (`E2E_TENANT`, default `acme`) must exist or be creatable
     by the auth context on first request.
   - Export `ADMIN_EMAIL` + `ADMIN_PASSWORD`, or `E2E_CLIENT_ID` +
     `E2E_CLIENT_SECRET`.
4. **Local setup** (when not using in-cluster sink)
   - `./port-forward.sh` from the repo root.
   - `export STRESS_SINK_LOCAL=true`
   - `export STRESS_SINK_URL=http://host.docker.internal:8090/sink` (so the
     in-cluster webhook-service can reach the local sink — only valid on Docker
     Desktop / OrbStack with this hostname; otherwise expose via ngrok / tailscale).

## Start

```bash
cd tests/stress/phase1
./scripts/run.sh --scenario events-callback
```

The default ramp is 67 minutes total (10 + 15 + 15 + 15 + 10 + 2 m). For a
30-second smoke run before the real test:

```bash
STRESS_BASELINE_DURATION=5s \
STRESS_LIGHT_DURATION=5s \
STRESS_MEDIUM_DURATION=5s \
STRESS_HEAVY_DURATION=5s \
STRESS_PEAK_DURATION=5s \
STRESS_SPIKE_RAMP=2s \
STRESS_SPIKE_HOLD=3s \
./scripts/run.sh --scenario events-callback
```

## Stop early

`Ctrl-C` in the runner shell. The `trap` in `run.sh` kills the sampler and the
local sink, flushes the JSONL, and exits. If anything is left over:

```bash
pkill -f sampler.ts
pkill -f sink/server.ts
```

## What to watch live (Grafana)

- **api-gateway**: ack latency p95 < 100 ms target.
- **NATS JetStream**: `jetstream_consumer_num_pending` for `event-processor`
  and `webhook-dispatcher` consumers — must drain to zero between stage
  transitions, otherwise a consumer is the bottleneck.
- **event-processor**: per-stage span durations.
- **webhook-service**: `dlq.webhook` publish rate must remain ≈0.
- **Pod restart count**: any restart aborts the test (per the stop rule).

## Where the artefacts live

After the run, see `reports/<scenario>-<timestamp>.*`:

- `*.k6.json` (NDJSON), `*.k6.summary.json`
- `*.sampler.jsonl` (Knative replica timeline)
- `*.sink.jsonl` (every delivery)
- `*.reconcile.md`, `*.reconcile.csv` (per-stage e2e table)

## Owner / on-call

- **Test owner**: Platform team (insert handle).
- **NATS / Knative**: Infra team.
- **Auth**: Backend team.
- **If it goes sideways**: stop the run (Ctrl-C), capture the timestamp, ping
  `#platform-stress` with the timestamp + the last `reconcile.md`.

## Reset Temporal state between runs

Phase 2.4 of the stress plan exercises Temporal directly. To get
comparable runs you need a clean Temporal Postgres state between
attempts. Two options, depending on how aggressive you want the wipe.

> Replace `<env>` with the overlay you're targeting (`local/dev`,
> `orbstack/dev`, ...) and `<ns>` with the actual namespace
> (`support-services-dev` in dev). Adjust as needed.

### Option A — Full reset (drops cluster + reinit, ~90s)

Tears down the CNPG cluster and PVCs, recreates them, lets Temporal's
`auto-setup` re-run schema migrations on a virgin DB.

```bash
kubectl -n <ns> cnpg destroy postgres-temporal --keep=0
kubectl apply -k infrastructure/overlays/<env>
kubectl -n <ns> wait --for=condition=Ready cluster/postgres-temporal --timeout=5m
kubectl -n <ns> rollout status deploy/temporal --timeout=5m
```

Use when you want zero residual state (schema drift, leftover task
queues, dangling history).

### Option B — TRUNCATE only (keeps schema, ~5s)

Truncates all hot Temporal tables and restarts the Server to flush
in-memory caches (history shards, matching task queues).

```bash
kubectl -n <ns> exec postgres-temporal-1 -c postgres -- \
  psql -U temporal -d temporal -c "
    TRUNCATE history_node, history_tree, executions, current_executions,
            transfer_tasks, timer_tasks, visibility_tasks, replication_tasks,
            tasks RESTART IDENTITY CASCADE;"

kubectl -n <ns> exec postgres-temporal-1 -c postgres -- \
  psql -U temporal -d temporal_visibility \
       -c "TRUNCATE executions_visibility RESTART IDENTITY;"

kubectl -n <ns> rollout restart deploy/temporal
kubectl -n <ns> rollout status   deploy/temporal --timeout=2m
```

Use between back-to-back runs of the same scenario when you only
need to clear workflows, not the schema.

### Snapshot baseline metrics before each run

Always log a UTC timestamp so the Grafana dashboards
(`Temporal Postgres (CNPG)`, `api-gateway-overview`, etc.) and the
Prometheus alerts (`temporal-postgres` group) can be correlated:

```bash
echo "Run start: $(date -u +%FT%TZ)" >> reports/run-log.txt
```

### Expected baseline (steady state, dev sizing)

When the reset is followed by a 10 min `events-callback` run with
default ramps, expect:

- `cnpg_pg_stat_database_xact_commit{datname="temporal"}` rate sustains
  >= the workflow throughput.
- `cnpg_pg_replication_lag` < 1s in steady state (only relevant in
  staging/prod with `instances: 2`).
- `cnpg_pg_stat_user_tables_n_dead_tup{relname="history_node"}` < 50k
  at end of run (autovacuum keeping up).
- Cache hit ratio > 99% for `executions` and `tasks` after warmup.

Anything outside this profile likely indicates an autovacuum problem
or IO saturation — escalate before continuing the campaign.

## Known caveats

- The 32 KB payload pool is just under NATS `max_payload: 1MB` — do not raise
  the pool size beyond ~512 KB without coordinating with the NATS owners.
- The reconciler treats `sent_at` from the k6 payload as authoritative. If the
  k6 host's clock skews from the cluster's clock, e2e latency will be biased.
  Use NTP-synced hosts.
- The sink's in-memory dedupe is bounded at 5 M correlation_ids
  (`STRESS_SINK_SEEN_CAPACITY`). For runs longer than that, raise the cap or
  rely on the reconciler's full-file dedupe.
