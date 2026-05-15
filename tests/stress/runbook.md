# Stress tests — Runbook

Operational guide for running the end-to-end stress suite against a live
cluster. Paired reading: [`README.md`](./README.md).

## Pre-flight (T-30 min)

1. **Cluster sanity**
   - `kubectl get pods -A` — no `CrashLoopBackOff`, no Knative services
     stuck scaling from zero.
   - `kubectl get hpa -n platform-services-dev` — capture the current
     replica baseline so you can compare after the run.
   - Grafana: open `api-gateway-overview`, `nats-jetstream`,
     `Temporal Postgres (CNPG)` (or the equivalent dashboards in your
     environment). Confirm Prometheus is scraping.
2. **Provision fixtures** (idempotent; safe to re-run)
   ```bash
   ADMIN_EMAIL=admin@yoizen.test \
   ADMIN_PASSWORD=admin \
   ./tests/stress/scripts/provision.sh
   ```
   Confirm the four IDs are printed at the end:
   ```text
   TENANT_ID=...
   SERVICE_ID=...
   CHANNEL_ID=...
   WORKFLOW_ID=...
   ```
3. **Stress sink**
   ```bash
   ./tests/stress/sink/build-and-load.sh           # build + load image
   kubectl apply -f tests/stress/sink/knative-service.yaml
   kubectl -n platform-services-dev get ksvc stress-sink
   ```
   Sanity-check from inside the cluster:
   ```bash
   kubectl -n platform-services-dev exec deploy/api-gateway-XX -- \
     curl -sf http://stress-sink.platform-services-dev.svc.cluster.local/healthz
   ```
4. **Tenant + credentials**
   - The tenant slug (`E2E_TENANT`, default `acme`) must exist (the
     provisioner creates it if missing).
   - Export `ADMIN_EMAIL` + `ADMIN_PASSWORD`, or
     `E2E_CLIENT_ID` + `E2E_CLIENT_SECRET`.
   - Optional: `TELEGRAM_WEBHOOK_SECRET` if the tenant pinned a custom
     bot secret on the channel account.
5. **Local setup (when not using the in-cluster sink)**
   - `./port-forward.sh` from the repo root.
   - `export STRESS_SINK_LOCAL=true`
   - `export STRESS_SINK_URL=http://host.docker.internal:8090/sink`
     (so the in-cluster api-gateway can reach the local sink — only
     valid on Docker Desktop / OrbStack with this hostname; otherwise
     expose via ngrok or tailscale).

## Start

```bash
cd tests/stress
./scripts/run.sh --scenario webhook-ingress
```

> The runner used to spawn `../scale/sampler.ts` for a Knative replica
> timeline, but that file was removed in the refactor. The default is
> now `--with-sampler false`; if a replacement lands, opt back in via
> `--with-sampler true` (and `SAMPLER_SCRIPT=<path>` if it lives
> outside `tests/stress/scale/sampler.ts`).

The default ramp is **67 minutes** total (10 + 15 + 15 + 15 + 10 + 2 m).
30-second smoke run before the real test:

```bash
STRESS_BASELINE_DURATION=5s \
STRESS_LIGHT_DURATION=5s \
STRESS_MEDIUM_DURATION=5s \
STRESS_HEAVY_DURATION=5s \
STRESS_PEAK_DURATION=5s \
STRESS_SPIKE_RAMP=2s \
STRESS_SPIKE_HOLD=3s \
./scripts/run.sh --scenario webhook-ingress
```

## Stop early

`Ctrl-C` in the runner shell. The `trap` in `run.sh` kills the local
sink, flushes the JSONL and exits. If anything is left over:

```bash
pkill -f sink/server.ts
```

## What to watch live (Grafana)

- **api-gateway**: ack latency p95 < 100 ms target on the
  `webhook-ingress` panel.
- **NATS JetStream**: `jetstream_consumer_num_pending` for
  `event-processor` and `webhook-dispatcher` consumers — must drain to
  zero between stage transitions, otherwise a consumer is the
  bottleneck.
- **Temporal**: workflow start rate must track the ingest rate. Watch
  `temporal_workflow_failed_total` and CNPG dashboard.
- **Pod restart count**: any restart aborts the test (per the stop
  rule).

## Where the artefacts live

After the run, see `reports/<scenario>-<timestamp>.*`:

- `*.k6.json` (NDJSON) — every metric sample.
- `*.k6.summary.json` — final summary.
- `*.sink.jsonl` — every delivery (only when the sink ran on this host;
  otherwise pull it from the in-cluster pod, see below).
- `*.reconcile.md`, `*.reconcile.csv` — per-stage e2e table.

### Pull the sink JSONL from the in-cluster pod

```bash
./tests/stress/sink/fetch-jsonl.sh \
  --out tests/stress/reports/run-N.sink.jsonl
# or, if STRESS_SINK_STDOUT is off in the Knative manifest:
./tests/stress/sink/fetch-jsonl.sh --mode cp \
  --out tests/stress/reports/run-N.sink.jsonl
```

Then run the reconciler manually:

```bash
bun run tests/stress/reconcile/reconcile.ts \
  --scenario webhook-ingress \
  --sink tests/stress/reports/run-N.sink.jsonl \
  --k6 tests/stress/reports/<scenario>-<ts>.k6.json \
  --output tests/stress/reports
```

## Owner / on-call

- **Test owner**: Platform team (insert handle).
- **NATS / Knative**: Infra team.
- **Auth / api-gateway**: Backend team.
- **If it goes sideways**: stop the run (Ctrl-C), capture the timestamp,
  ping `#platform-stress` with the timestamp + the last `reconcile.md`.

## Reset Temporal state between runs

To get comparable runs you need a clean Temporal Postgres state between
attempts. Two options, depending on how aggressive you want the wipe.

> Replace `<env>` with the overlay you're targeting (`local/dev`,
> `orbstack/dev`, ...) and `<ns>` with the actual namespace (typically
> `support-services-dev`).

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

Use between back-to-back runs of the same scenario when you only need
to clear workflows, not the schema.

The repo also ships a one-shot helper that wraps Option B (TRUNCATE +
rollout restart) for the dev environment:

```bash
./scripts/purge-temporal.sh
```

### Snapshot baseline metrics before each run

Always log a UTC timestamp so the Grafana dashboards
(`Temporal Postgres (CNPG)`, `api-gateway-overview`, etc.) and the
Prometheus alerts (`temporal-postgres` group) can be correlated:

```bash
echo "Run start: $(date -u +%FT%TZ)" >> reports/run-log.txt
```

### Expected baseline (steady state, dev sizing)

When the reset is followed by a 10 min `webhook-ingress` run with
default ramps, expect:

- `cnpg_pg_stat_database_xact_commit{datname="temporal"}` rate sustains
  ≥ the workflow throughput.
- `cnpg_pg_replication_lag` < 1 s in steady state (only relevant in
  staging/prod with `instances: 2`).
- `cnpg_pg_stat_user_tables_n_dead_tup{relname="history_node"}` < 50 k
  at end of run (autovacuum keeping up).
- Cache hit ratio > 99 % for `executions` and `tasks` after warmup.

Anything outside this profile likely indicates an autovacuum problem or
IO saturation — escalate before continuing the campaign.

## Reset circuit breakers between runs

Long campaigns can leave the channel-service / connector-runtime
breakers in a half-open state, which biases subsequent runs. The repo
ships a helper:

```bash
./scripts/purge-circuit-breakers.sh
```

## Known caveats

- The 32 KB payload pool stays just under NATS `max_payload: 1MB` —
  do not raise the pool size beyond ~512 KB without coordinating with
  the NATS owners.
- The reconciler treats `sent_at` from the k6 payload as authoritative.
  Keep the k6 host and the cluster NTP-synced or e2e latency will be
  biased.
- The sink's in-memory dedupe is bounded at 5 M `correlation_id`s
  (`STRESS_SINK_SEEN_CAPACITY`). For runs longer than that, raise the
  cap or rely on the reconciler's full-file dedupe.
- The Knative sampler is opt-in. Pass `--with-sampler true` only after
  a replacement for the removed `tests/stress/scale/sampler.ts` lands
  (or point at one with `SAMPLER_SCRIPT=<path>`); otherwise the runner
  logs a warning and skips it.
