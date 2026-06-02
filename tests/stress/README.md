# Stress tests (k6 + Bun sink + reconciler)

Black-box load suite for the Yoizen platform. Load is injected at the
`api-gateway` ingress (channel/webhook entry path). Two observation
paths are recorded per run:

1. **Gateway ack** — k6 records ingress latency + status per request.
2. **e2e via stress-sink** — k6 embeds a correlation envelope
   (`STRESS|<cid>|<sent_at>|<stage>`) in `message.text`; the
   provisioned `Stress Workflow` parses it in a `jsFunction` step and
   POSTs `{ correlation_id, sent_at, stage }` to the in-cluster
   `stress-sink` Knative service via `endpointCall`. The reconciler
   joins both sides to compute end-to-end latency per stage.

> **Status:** post-refactor (`stress-refactor` branch). The previous
> Artillery suite, the `phase1/` subfolder and the `scale/` sampler are
> gone. Only the `webhook-ingress` scenario is shipped today; new
> scenarios should be added under [`scenarios/`](./scenarios/). The
> Knative sampler is opt-in (`--with-sampler true`) and requires a
> replacement script under `tests/stress/scale/sampler.ts` or via
> `SAMPLER_SCRIPT=<path>`.

## Layout

```text
tests/stress/
├── lib/                       pure helpers consumed by k6 and Bun
│   ├── auth.ts                JWT acquisition (admin or client_credentials)
│   ├── correlation.ts         Map/counter-based correlation_id generation
│   ├── env.ts                 gateway URL, tenant header, namespace
│   ├── histogram.ts           O(1) bucketed latency histogram
│   ├── payloads.ts            2 KB / 32 KB pools (median + p95)
│   └── stages.ts              ramp profile (baseline → spike), env-overridable
├── scenarios/
│   └── webhook-ingress.ts     k6 script: provider webhook entry path (Telegram)
├── sink/                      in-cluster delivery capture (Bun)
│   ├── server.ts              HTTP server: POST /sink, /metrics, /stats
│   ├── Dockerfile
│   ├── build-and-load.sh      build image and load into Minikube
│   ├── fetch-jsonl.sh         pull deliveries out of the pod after a run
│   └── knative-service.yaml
├── reconcile/
│   └── reconcile.ts           per-stage Markdown + CSV report
├── scripts/
│   ├── provision.sh           idempotent tenant/service/channel/workflow setup
│   ├── provision-code-only.sh same fixtures, code-only workflow variant
│   ├── resolve-stress-target.sh  Kourier / sslip.io URL for k6
│   ├── reconcile-temporal-mongo-executions.sh  fix stale RUNNING rows
│   └── run.sh                 k6 + reconcile orchestrator
├── reports/                   k6 NDJSON, sink JSONL and reconcile output
└── runbook.md                 operational runbook (start / stop / who owns it)
```

## Prerequisites

- A reachable `api-gateway`. For stress runs, prefer Kourier ingress
  (default in `run.sh` via `--use-kourier auto`) instead of
  `./port-forward.sh`, which pins traffic to a single pod.
- `k6` ≥ v0.52 (native TypeScript support) — install from
  [grafana/k6 releases](https://github.com/grafana/k6/releases).
- `bun` ≥ 1.1 for the sink and reconciler.
- `kubectl`, `jq` and `curl` on `PATH` for the provisioning script.
- Credentials in env: `ADMIN_EMAIL` + `ADMIN_PASSWORD`, or
  `E2E_CLIENT_ID` + `E2E_CLIENT_SECRET` for the auth helper.

## Step 1 — Provision the cluster fixtures

The `webhook-ingress` scenario assumes a tenant, a registry service, a
Telegram channel account and a workflow already exist. The provisioner
is idempotent — creates if missing, reuses if present, **and updates
in place** when the existing workflow lacks the `notifyStressSink`
step:

```bash
ADMIN_EMAIL=admin@yoizen.test \
ADMIN_PASSWORD=admin \
./tests/stress/scripts/provision.sh
```

Resources it creates / reuses (defaults — overridable via env):

| Resource | Default | Env override |
|----------|---------|--------------|
| Tenant | `acme` | `TENANT_NAME` |
| Registry service | `echo-service` (`ealen/echo-server:latest`, port 3000) | — |
| Channel account | `tgbot` (Telegram) | — |
| Workflow | `Stress Workflow` (`branch` → `extractStressMeta` → `notifyStressSink`) | `STRESS_SINK_URL`, `WORKFLOW_FORCE_REPROVISION` |
| Gateway URL | auto-discovered via Kourier LB or `minikube ip` | `API_GATEWAY_URL`, `MINIKUBE_PROFILE`, `INGRESS_NS`, `INGRESS_SVC` |

The workflow definition wires the sink notification automatically:

1. `Parallel Branch` — original parallel `jsFunction` + `serviceCall`
   (kept as a representative load shape).
2. `extractStressMeta` (`jsFunction`) — parses the
   `STRESS|<cid>|<sent_at>|<stage>` prefix the k6 scenario embeds in
   `message.text`. Returns safe defaults for non-stress messages.
3. `notifyStressSink` (`endpointCall`) — POSTs
   `{ correlation_id, sent_at, stage }` to `STRESS_SINK_URL` (default
   in-cluster Knative DNS). Templates resolve from
   `extractStressMeta`'s result.

Set `WORKFLOW_FORCE_REPROVISION=true` to re-`PUT` the workflow even
when the sink-notify step is already present (use after editing the
parse code or the action shape).

The script prints the four resolved IDs at the end:

```text
TENANT_ID=...
SERVICE_ID=...
CHANNEL_ID=...
WORKFLOW_ID=...
```

## Step 2 — Deploy the in-cluster sink

The `Stress Workflow` provisioned in Step 1 expects the sink to be
reachable at `STRESS_SINK_URL` (default
`http://stress-sink.platform-services-dev.svc.cluster.local/sink`). If
the sink is not deployed, the workflow's `endpointCall` step will
retry+fail and the reconciler will only have ack data from k6.

```bash
# Build the sink image and load it into Minikube (auto-detects the active
# profile from the kubectl context).
./tests/stress/sink/build-and-load.sh

# Deploy as a Knative service.
kubectl apply -f tests/stress/sink/knative-service.yaml

# Verify it is Ready.
kubectl -n platform-services-dev get ksvc stress-sink
```

### Sink image cheat sheet

| Action | Command |
|--------|---------|
| Build + load into Minikube (auto profile) | `./sink/build-and-load.sh` |
| Build only (no load) | `STRESS_SINK_PUSH_MODE=none ./sink/build-and-load.sh` |
| Push to a remote registry | `STRESS_SINK_IMAGE=ghcr.io/<org>/stress-sink:<tag> STRESS_SINK_PUSH_MODE=registry ./sink/build-and-load.sh` |
| Deploy / re-deploy | `kubectl apply -f sink/knative-service.yaml` |
| Tail deliveries live | `kubectl -n platform-services-dev logs -f -l serving.knative.dev/service=stress-sink --container=stress-sink` |
| Pull JSONL after a run (via logs) | `./sink/fetch-jsonl.sh --out reports/sink.jsonl` |
| Pull JSONL via `kubectl cp` | `./sink/fetch-jsonl.sh --mode cp --out reports/sink.jsonl` |
| In-cluster URL (callback target) | `http://stress-sink.platform-services-dev.svc.cluster.local/sink` |
| External URL (Knative + Kourier) | `kubectl -n platform-services-dev get ksvc stress-sink -o jsonpath='{.status.url}'` |

The image is named `dev.local/stress-sink:dev` by default — that prefix
is in Knative's `registries-skipping-tag-resolving` list, so the
deployment doesn't try to talk to a remote registry. Override with
`STRESS_SINK_IMAGE` if you need a real registry tag.

## Step 3 — Run a scenario

Local sink (handy for smoke runs without deploying anything):

```bash
cd tests/stress

export ADMIN_EMAIL=admin@yoizen.test
export ADMIN_PASSWORD=admin
export STRESS_SINK_LOCAL=true   # spawns the Bun sink on :8090 in this shell
export STRESS_SINK_URL=http://host.docker.internal:8090/sink

./scripts/run.sh --scenario webhook-ingress
```

In-cluster sink (the runner now pulls the JSONL automatically when
`STRESS_SINK_URL` points at a `*.svc.cluster.local` host):

```bash
cd tests/stress

export ADMIN_EMAIL=...
export ADMIN_PASSWORD=...
export STRESS_SINK_URL=http://stress-sink.platform-services-dev.svc.cluster.local/sink

./scripts/run.sh --scenario webhook-ingress
```

After the k6 run completes, `run.sh` will:

1. Call `./sink/fetch-jsonl.sh --out reports/<scenario>-<ts>.sink.jsonl`
   to copy the JSONL out of the pod (skip with `STRESS_FETCH_SINK=false`).
2. Invoke `reconcile/reconcile.ts` with **both** `--sink` and `--k6`,
   so per-stage `Sent` counts come from k6 even if the sink is empty.
3. Print a clear warning if the sink JSONL ended up with 0 lines.

To re-run the reconciler manually against an existing run:

```bash
bun run reconcile/reconcile.ts \
  --scenario webhook-ingress \
  --sink reports/<scenario>-<ts>.sink.jsonl \
  --k6   reports/<scenario>-<ts>.k6.json \
  --output reports
```

> **Always pass `--k6`** — without it, an empty sink produces an empty
> table and the `Sent` column is lost.

## Stages

Single **medium** stage (`tests/stress/lib/stages.ts`): constant arrival rate
for the full duration (no multi-stage ramp in code today). Defaults:

| Stage | Duration | Rate (msg/s) | k6 VUs (preallocated) |
|-------|----------|--------------|------------------------|
| medium | 15 m | 200 | 500 |

Smoke profile — validate the pipeline in under a minute:

```bash
STRESS_MEDIUM_DURATION=30s STRESS_MEDIUM_RATE=10 \
  ./scripts/run.sh --scenario webhook-ingress
```

Full 15 m @ 200 RPS (Kourier ingress, auto-discovered):

```bash
STRESS_MEDIUM_RATE=200 STRESS_MEDIUM_DURATION=15m \
  TELEGRAM_WEBHOOK_SECRET=anothersecret \
  ./scripts/run.sh --scenario webhook-ingress
```

### Environment overrides

| Env var | Purpose |
|---------|---------|
| `STRESS_TARGET` | Explicit base URL (overrides auto Kourier discovery). |
| `API_GATEWAY_URL` | Knative DNS for the gateway (set by `resolve-stress-target.sh`). |
| `--use-kourier` | `run.sh` flag: `auto` (default), `true`, or `false`. |
| `KOURIER_HOST` / `KOURIER_PORT` | Legacy port-forward target when `--use-kourier false`. |
| `STRESS_NAMESPACE` / `SMOKE_TEST_NAMESPACE` | k8s namespace (default `platform-services-dev`). |
| `MINIKUBE_DOMAIN` | DNS suffix when no explicit target is set. |
| `E2E_TENANT` | Tenant slug for `x-yoizen-tenant` header (default `acme`). |
| `STRESS_SINK_URL` | Sink endpoint the scenario / api-gateway should hit. |
| `STRESS_SINK_LOCAL=true` | Spawn the Bun sink locally during the run. |
| `STRESS_SINK_PORT` | Local sink port (default 8090). |
| `STRESS_SINK_OUTPUT` | Override sink JSONL path. |
| `STRESS_PAYLOAD_SIZE=median` or `p95` | Pin payload size; default is mixed (95% median, 5% p95). |
| `STRESS_<STAGE>_RATE` / `_DURATION` / `_VUS` | Per-stage knobs. |
| `TELEGRAM_WEBHOOK_SECRET` | Sets the `X-Telegram-Bot-Api-Secret-Token` header. |
| `K6_BIN` | Override the k6 binary (default: `k6` in `PATH`). |

## Scenarios

### `webhook-ingress`

```text
POST /api/webhooks/telegram/<tenant>
```

Provider-style entry path: ships a Telegram-shaped `Update` body that
mirrors what the real bot platform pushes. The gateway hands the body
off to JetStream after a constant-time guard on
`X-Telegram-Bot-Api-Secret-Token`. The body's `message.text` field
carries the stress correlation envelope
(`STRESS|<cid>|<sent_at>|<stage>`) so the workflow can echo it to the
sink for end-to-end measurement — see
[Reading the results](#reading-the-results).

Metrics:

- `phase1_webhook_sent{stage=...}` — counter, k6-side.
- `phase1_webhook_ack_ms{stage=...}` — k6 trend, gateway ack only.
- `http_req_duration{phase:webhook-ingress}` — same as above, k6
  built-in.

Thresholds:

- `http_req_failed{phase:webhook-ingress}` < 1%
- `http_req_duration{phase:webhook-ingress}` p95 < 150 ms

To enable the secret token (production runs **must** override it):

```bash
export TELEGRAM_WEBHOOK_SECRET="<the-secret-from-the-channel-account>"
```

## Outputs

After every run, `reports/` contains:

- `<scenario>-<ts>.k6.json` — k6 streaming NDJSON (every metric sample).
- `<scenario>-<ts>.k6.summary.json` — k6 aggregated summary (the
  authoritative source for ack latency / error rate today).
- `<scenario>-<ts>.sink.jsonl` — every delivery observed by the sink
  (auto-pulled from the in-cluster pod when `STRESS_SINK_URL` points at
  `*.svc.cluster.local`).
- `<scenario>-<ts>.sink.log` — local sink stdout (only when
  `STRESS_SINK_LOCAL=true`).
- `<scenario>-<ts>.reconcile.md` — per-stage table:
  `Sent / Delivered / Lost / Loss % / Duplicates / p50 / p95 / p99 / min / max`.
  When the sink has no rows the report still lists per-stage `Sent`
  counts from k6 and prints an explicit "no sink data" notice.
- `<scenario>-<ts>.reconcile.csv` — same table for spreadsheet ingestion.

## Reading the results

The suite produces two complementary views per run.

### Gateway ack (always meaningful)

The k6 summary file is the source of truth for ingestion behaviour:

```bash
jq '{
  sent:   .metrics.phase1_webhook_sent.count,
  errs:   .metrics["http_req_failed{phase:webhook-ingress}"].fails,
  errPct: .metrics["http_req_failed{phase:webhook-ingress}"].value,
  ack: {
    p50: .metrics.phase1_webhook_ack_ms.med,
    p95: .metrics.phase1_webhook_ack_ms["p(95)"],
    p99: .metrics.phase1_webhook_ack_ms["p(99)"],
    max: .metrics.phase1_webhook_ack_ms.max,
  },
  thresholds: .metrics["http_req_duration{phase:webhook-ingress}"].thresholds,
}' reports/<scenario>-<ts>.k6.summary.json
```

Sample shape:

```json
{
  "sent": 487,
  "errs": 0,
  "errPct": 0,
  "ack": { "p50": 5.36, "p95": 12.14, "p99": 70.57, "max": 138.29 },
  "thresholds": { "p(95)<150": false }
}
```

### End-to-end (sink-derived)

The k6 webhook scenario embeds a correlation envelope in
`message.text`:

```text
STRESS|<correlation_id>|<sent_at_ms>|<stage>
```

`channel-service`'s envelope normalization preserves `text`
verbatim (`packages/.../channel-service/.../envelope.factory.ts`), so
the field shows up as `ctx.request.text` inside the workflow.

The provisioned `Stress Workflow` (Step 1) handles the rest:

1. `Parallel Branch` — original load shape (`jsFunction` +
   `serviceCall`).
2. `extractStressMeta` (`jsFunction`) — parses the prefix and returns
   `{ correlation_id, sent_at, stage }`.
3. `notifyStressSink` (`endpointCall`) — POSTs the parsed envelope to
   `STRESS_SINK_URL` (`http://stress-sink.../sink` by default). The
   sink records `{ correlation_id, sent_at, delivered_at,
   latency_ms = delivered_at - sent_at }` and stores it as JSONL.

The reconciler then joins:

- **`Sent` per stage** ← `phase1_webhook_sent` counter from k6.
- **`Delivered` per stage** ← unique `correlation_id`s in the sink.
- **`Lost` per stage** ← `Sent - Delivered`.
- **`p50 / p95 / p99 / min / max`** ← per-stage latency histogram from
  the sink.

### Troubleshooting an empty `*.sink.jsonl`

If a fresh run produces `Delivered = 0` everywhere, check (in order):

```bash
# 1. The provisioner ran with the new shape:
./tests/stress/scripts/provision.sh   # idempotent; safe to re-run
#    Look for "Workflow 'Stress Workflow' updated" or
#    "already up to date".

# 2. The sink got POSTs from the workflow:
kubectl -n platform-services-dev logs \
  -l serving.knative.dev/service=stress-sink \
  --tail=30 --container=stress-sink
#    Lines starting with `{"correlation_id"` mean it's working.

# 3. The workflow's endpointCall is not failing:
kubectl -n platform-services-dev logs \
  -l serving.knative.dev/service=connector-runtime \
  --tail=200 | grep -E '(notifyStressSink|stress-sink)'

# 4. STRESS_SINK_URL is reachable from connector-runtime:
kubectl -n platform-services-dev exec deploy/connector-runtime -- \
  curl -sf http://stress-sink.platform-services-dev.svc.cluster.local/healthz
```

If the workflow was created **before** this change, force a re-PUT:

```bash
WORKFLOW_FORCE_REPROVISION=true ./tests/stress/scripts/provision.sh
```

## Stop rules

The reconcile report flags any stage where:

- error rate > 1% (from k6 thresholds; cross-check `http_req_failed`)
- ack p95 > the agreed SLA (k6 `http_req_duration` p95 < 150 ms today)
- e2e p95 > the agreed SLA (configurable per environment)
- message loss > 0
- duplicates > 0
- any pod restart (read Grafana / `kubectl get pods` — out of band)

The first stage that triggers any rule is the deliverable.

## Performance notes

The implementation deliberately avoids hot-path allocations and uses
constant-time data structures throughout:

- `Map<string, T>` for stage stats, payload pools, env caches,
  correlation dedupe, and k6 scenario assembly. No linear scans on the
  hot path.
- `LatencyHistogram` records latency in `O(1)`; percentiles are
  `O(buckets)` and avoid sorting an array of every observation.
- The sink's JSONL writer batches writes to a 64 KiB buffer
  (configurable) and flushes on size or 1 s, which keeps disk I/O off
  the request path.
- The reconciler streams JSONL line-by-line via `readline` — never loads
  the full file into memory; total memory is `O(unique correlation_ids)`.

## Tooling

```bash
cd tests/stress
bun install                  # or npm install — installs Biome + types
npm run lint                 # biome check on lib/scenarios/sink/reconcile
npm run lint:fix             # biome check --write
npm run build                # tsc --noEmit (type-check only)
npm run sink:dev             # start the Bun sink locally on :8080
npm run sink:build           # build the sink image and load it into Minikube
npm run provision            # idempotent tenant/service/channel/workflow setup
npm run reconcile -- ...     # run the reconciler manually
npm run scenario:webhook     # shortcut for ./scripts/run.sh --scenario webhook-ingress
```

## Known limitations

- **Sampler is opt-in.** `scripts/run.sh` defaults to
  `--with-sampler false` because `tests/stress/scale/sampler.ts` was
  removed in the refactor. Re-enable once a replacement lands (or
  point at one explicitly):
  ```bash
  SAMPLER_SCRIPT=path/to/sampler.ts ./scripts/run.sh \
    --scenario webhook-ingress --with-sampler true
  ```
  Otherwise pull the Knative replica + HPA timeline from Grafana /
  Prometheus directly.
- The 32 KB payload pool stays well under NATS `max_payload: 1MB`. Do
  not raise the pool size beyond ~512 KB without coordinating with the
  NATS owners.
- The reconciler treats the `sent_at` field from the k6 payload as
  authoritative. If the k6 host's clock skews from the cluster's clock,
  e2e latency will be biased — keep both NTP-synced.
- The sink's in-memory dedupe is bounded at 5 M `correlation_id`s
  (`STRESS_SINK_SEEN_CAPACITY`). For runs longer than that, raise the
  cap or rely on the reconciler's full-file dedupe.
