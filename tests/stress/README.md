# End-to-end stress tests (k6 + Bun sink + reconciler)

Black-box load suite for the Yoizen platform. Load is injected at the
`api-gateway` ingress (channel/webhook entry path) and observed at a
`stress-sink` Knative service that captures every delivery. End-to-end
latency is reconstructed from the `sent_at` timestamp embedded in every
payload and the `delivered_at` recorded by the sink.

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
│   └── run.sh                 k6 + reconcile orchestrator
├── reports/                   k6 NDJSON, sink JSONL and reconcile output
└── runbook.md                 operational runbook (start / stop / who owns it)
```

## Prerequisites

- A reachable `api-gateway` (typically via `./port-forward.sh` from the
  repo root, or hit the Knative DNS directly).
- `k6` ≥ v0.52 (native TypeScript support) — install from
  [grafana/k6 releases](https://github.com/grafana/k6/releases).
- `bun` ≥ 1.1 for the sink and reconciler.
- `kubectl`, `jq` and `curl` on `PATH` for the provisioning script.
- Credentials in env: `ADMIN_EMAIL` + `ADMIN_PASSWORD`, or
  `E2E_CLIENT_ID` + `E2E_CLIENT_SECRET` for the auth helper.

## Step 1 — Provision the cluster fixtures

The `webhook-ingress` scenario assumes a tenant, a registry service, a
Telegram channel account and a workflow already exist. The provisioner
is idempotent (creates if missing, reuses if present):

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
| Workflow | `Stress Workflow` (parallel branch: `jsFunction` + `serviceCall`) | — |
| Gateway URL | auto-discovered via Kourier LB or `minikube ip` | `API_GATEWAY_URL`, `MINIKUBE_PROFILE`, `INGRESS_NS`, `INGRESS_SVC` |

The script prints the four resolved IDs at the end:

```text
TENANT_ID=...
SERVICE_ID=...
CHANNEL_ID=...
WORKFLOW_ID=...
```

## Step 2 — Deploy the in-cluster sink

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

In-cluster sink (recommended once the sink Knative service is Ready):

```bash
cd tests/stress

export ADMIN_EMAIL=...
export ADMIN_PASSWORD=...
export STRESS_SINK_URL=http://stress-sink.platform-services-dev.svc.cluster.local/sink

./scripts/run.sh --scenario webhook-ingress

# After the run, pull the deliveries out of the pod for the reconciler.
./sink/fetch-jsonl.sh --out reports/run-1.sink.jsonl
bun run reconcile/reconcile.ts \
  --scenario webhook-ingress \
  --sink reports/run-1.sink.jsonl \
  --output reports
```

## Stages

Five steady-state stages plus a recovery spike. Defaults match the
original Phase 1 plan; every duration / rate / VU count is
env-overridable without editing source.

| Stage | Duration | Rate (msg/s) | k6 VUs (preallocated) |
|-------|----------|--------------|------------------------|
| baseline | 10 m | 10 | 5 |
| light | 15 m | 50 | 25 |
| medium | 15 m | 200 | 100 |
| heavy | 15 m | 500 | 250 |
| peak | 10 m | 1000 | 500 |
| spike | 30 s ramp + 1 m 30 s hold | 2000 → 200 | 1000 |

Smoke profile (≈2 min total) — useful to validate the pipeline end-to-end:

```bash
export STRESS_BASELINE_DURATION=20s
export STRESS_LIGHT_DURATION=30s
export STRESS_MEDIUM_DURATION=30s
export STRESS_HEAVY_DURATION=30s
export STRESS_PEAK_DURATION=20s
export STRESS_SPIKE_RAMP=5s
export STRESS_SPIKE_HOLD=15s
./scripts/run.sh --scenario webhook-ingress
```

### Environment overrides

| Env var | Purpose |
|---------|---------|
| `STRESS_TARGET` | Explicit base URL (overrides Knative DNS + Kourier). |
| `API_GATEWAY_URL` | Knative DNS for the gateway (used to set `Host` header). |
| `KOURIER_HOST` / `KOURIER_PORT` | Port-forward target (defaults: `localhost:8080`). |
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
`X-Telegram-Bot-Api-Secret-Token`. Measures gateway ingest ack latency
(`http_req_duration{phase:webhook-ingress}`) plus end-to-end latency
once the workflow processed the message and posted to the sink via
`callbackUrl`.

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
- `<scenario>-<ts>.k6.summary.json` — k6 aggregated summary.
- `<scenario>-<ts>.sink.jsonl` — every delivery observed by the sink.
- `<scenario>-<ts>.sink.log` — local sink stdout (only when
  `STRESS_SINK_LOCAL=true`).
- `<scenario>-<ts>.reconcile.md` — per-stage table:
  `Sent / Delivered / Lost / Loss % / Duplicates / p50 / p95 / p99 / min / max`.
- `<scenario>-<ts>.reconcile.csv` — same table for spreadsheet ingestion.

## Stop rules

The reconcile report flags any stage where:

- error rate > 1% (from k6 thresholds; cross-check `http_req_failed`)
- e2e p95 > the agreed SLA (configure your own; the k6 threshold is
  informational)
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
