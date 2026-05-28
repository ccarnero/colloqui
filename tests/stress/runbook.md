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
5. **Ingress for k6 (stress runs)**
   - Prefer `./scripts/run.sh` with default `--use-kourier auto` (hits
     `api-gateway` via Kourier, load-balanced across KPA replicas).
   - Avoid `./port-forward.sh` for stress — it forwards to one pod.
6. **Local setup (when not using the in-cluster sink)**
   - `./port-forward.sh` from the repo root (debugging only).
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

The default profile is one **medium** stage: **15 m @ 200 RPS** (see
`lib/stages.ts`). 30-second smoke before the real test:

```bash
STRESS_MEDIUM_DURATION=30s STRESS_MEDIUM_RATE=10 \
  ./scripts/run.sh --scenario webhook-ingress
```

Production stress target (15 m @ 200 RPS):

```bash
STRESS_MEDIUM_RATE=200 STRESS_MEDIUM_DURATION=15m \
  TELEGRAM_WEBHOOK_SECRET=anothersecret \
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

Tears down the CNPG cluster and PVCs, recreates them, lets the
`temporal-schema-setup-<version>` Job re-apply schema migrations on
a virgin DB. Post-HA-migration there is no single `temporal` rollout
— wait for the 4 role Deployments in parallel.

```bash
kubectl -n <ns> cnpg destroy postgres-temporal --keep=0
kubectl apply -k infrastructure/overlays/<env>
kubectl -n <ns> wait --for=condition=Ready cluster/postgres-temporal --timeout=5m
kubectl -n <ns> wait --for=condition=complete \
  job/temporal-schema-setup-1-28-4 --timeout=5m
for role in frontend history matching worker; do
  kubectl -n <ns> rollout status deploy/temporal-${role} --timeout=5m &
done; wait
```

Use when you want zero residual state (schema drift, leftover task
queues, dangling history).

### Option B — TRUNCATE only (keeps schema, ~5s)

Truncates all hot Temporal tables and restarts the Server to flush
in-memory caches (history shards, matching task queues). Post-HA
migration the `temporal` Deployment was split into 4 role-specific
ones; `rollout restart` has to iterate.

```bash
kubectl -n <ns> exec postgres-temporal-1 -c postgres -- \
  psql -U temporal -d temporal -c "
    TRUNCATE history_node, history_tree, executions, current_executions,
            transfer_tasks, timer_tasks, visibility_tasks, replication_tasks,
            tasks RESTART IDENTITY CASCADE;"

kubectl -n <ns> exec postgres-temporal-visibility-1 -c postgres -- \
  psql -U temporal -d temporal_visibility \
       -c "TRUNCATE executions_visibility RESTART IDENTITY;"

for role in frontend history matching worker; do
  kubectl -n <ns> rollout restart deploy/temporal-${role}
done
for role in frontend history matching worker; do
  kubectl -n <ns> rollout status deploy/temporal-${role} --timeout=2m &
done; wait
```

Use between back-to-back runs of the same scenario when you only need
to clear workflows, not the schema.

The repo also ships a one-shot helper that wraps Option B (TRUNCATE +
rollout restart) for the dev environment:

```bash
./scripts/purge-temporal.sh
./scripts/purge-circuit-breakers.sh
```

If Mongo `workflow_executions` still shows stale `RUNNING` rows after a
run (Temporal already completed them):

```bash
./scripts/reconcile-temporal-mongo-executions.sh          # dry-run
./scripts/reconcile-temporal-mongo-executions.sh --apply  # fix rows
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

## Troubleshooting

### `reconcile.md` is empty / has no rows

Most common cause: **the reconciler ran without `--k6`**. Re-run with
both flags — the report is generated fresh per invocation:

```bash
bun run reconcile/reconcile.ts \
  --scenario webhook-ingress \
  --sink   reports/<scenario>-<ts>.sink.jsonl \
  --k6     reports/<scenario>-<ts>.k6.json \
  --output reports
```

`run.sh` always passes both flags automatically.

### `*.sink.jsonl` is 0 bytes after a run

The scenario embeds the correlation envelope in `message.text` and the
provisioned `Stress Workflow` POSTs it to the sink. If no deliveries
land, walk these in order:

1. **Workflow shape.** Confirm the workflow has the new
   `notifyStressSink` step (the provisioner auto-updates pre-existing
   workflows that lack it):
   ```bash
   ./tests/stress/scripts/provision.sh
   # If the script reports "already up to date" but you still see no
   # deliveries, force the in-place update:
   WORKFLOW_FORCE_REPROVISION=true ./tests/stress/scripts/provision.sh
   ```
2. **Sink ingress.** Check the sink pod actually got POSTs:
   ```bash
   kubectl -n platform-services-dev logs -l serving.knative.dev/service=stress-sink \
     --tail=30 --container=stress-sink
   ```
   Lines starting with `{"correlation_id"` mean it's working. Only the
   `[stress-sink] listening on ...` startup line means zero POSTs
   reached it — keep walking the list below.
3. **Workflow → sink call.** Inspect connector-runtime for the
   `notifyStressSink` activity:
   ```bash
   kubectl -n platform-services-dev logs \
     -l serving.knative.dev/service=connector-runtime \
     --tail=200 | grep -E '(notifyStressSink|stress-sink)'
   ```
   Look for circuit-breaker `DENY`, fetch errors, or 4xx/5xx replies.
4. **Sink reachability from connector-runtime.**
   ```bash
   kubectl -n platform-services-dev exec deploy/connector-runtime -- \
     curl -sf http://stress-sink.platform-services-dev.svc.cluster.local/healthz
   ```
   Anything but `ok` means a Knative / Kourier / DNS issue.
5. **`fetch-jsonl.sh` mode.** If sink logs show deliveries but the
   pulled JSONL is empty, the Knative manifest may have
   `STRESS_SINK_STDOUT=false` — either flip it back on, or pull from
   the emptyDir directly:
   ```bash
   ./tests/stress/sink/fetch-jsonl.sh --mode cp \
     --out tests/stress/reports/run-N.sink.jsonl
   ```

### Sink rejects the POSTs with `400 missing sent_at`

You're on an old sink build. The current version coerces
numeric-string `sent_at` (because workflow templates resolve to
strings). Rebuild + reload:

```bash
./tests/stress/sink/build-and-load.sh
kubectl -n platform-services-dev delete pod \
  -l serving.knative.dev/service=stress-sink
```

### `[run] sink JSONL not found … reconcile skipped`

You're on an old `run.sh`. The current version always materialises the
file (empty if needed) and runs the reconciler with `--k6`. Pull the
latest `tests/stress/scripts/run.sh`.

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
