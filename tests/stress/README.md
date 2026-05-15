# Phase 1 — Black-box end-to-end stress tests (k6 + sink + reconciler)

Implementation of [Phase 1 of `stress-test-plan.md`](../../../stress-test-plan.md)
adapted to the architecture in [`stress-test-adapted.md`](../../../stress-test-adapted.md).

The platform under test is treated as a black box: load is injected at the
api-gateway / channel-service ingress and observed at a `stress-sink` service
that captures every delivery. End-to-end latency is reconstructed from the
`sent_at` timestamp embedded in every payload and the `delivered_at` recorded
by the sink.

## Layout

```text
tests/stress/phase1/
├── lib/                     pure helpers consumed by k6 + Bun
│   ├── env.ts               gateway URL, tenant header, namespace
│   ├── auth.ts              JWT acquisition (admin or client_credentials)
│   ├── correlation.ts       Map/counter-based correlation_id generation
│   ├── payloads.ts          2 KB / 32 KB pools (median + p95)
│   ├── stages.ts            ramp profile (baseline → spike), env-overridable
│   └── histogram.ts         O(1) bucketed latency histogram
├── scenarios/               k6 scripts (one per ingress shape)
│   ├── events-callback.ts   PRIMARY: full e2e via callbackUrl=stress-sink
│   ├── events-publish.ts    pure ingest throughput
│   ├── events-roundtrip.ts  ingest + Redis result lookup
│   └── webhook-ingress.ts   provider webhook entry path
├── sink/                    in-cluster delivery capture (Bun)
│   ├── server.ts            HTTP server: POST /sink, /metrics, /stats
│   ├── Dockerfile
│   └── knative-service.yaml
├── reconcile/
│   └── reconcile.ts         per-stage Markdown + CSV report
├── scripts/
│   └── run.sh               k6 + sampler + reconcile orchestrator
└── runbook.md               operational runbook (start / stop / who owns it)
```

## Prerequisites

- A reachable api-gateway (port-forward via `./port-forward.sh` from the repo
  root, or hit the Knative DNS directly).
- `k6` (≥ v0.52, native TypeScript support) — install via
  [grafana/k6 releases](https://github.com/grafana/k6/releases).
- `bun` (≥ 1.1) for the sink and reconciler.
- Credentials in env: either `ADMIN_EMAIL` + `ADMIN_PASSWORD` or
  `E2E_CLIENT_ID` + `E2E_CLIENT_SECRET`.
- For in-cluster runs: deploy the sink Knative service:

  ```bash
  kubectl apply -f tests/stress/phase1/sink/knative-service.yaml
  ```

## Quick start (local, with bundled sink)

```bash
cd tests/stress/phase1

export ADMIN_EMAIL=admin@yoizen.test
export ADMIN_PASSWORD=admin
export STRESS_SINK_LOCAL=true   # spin up the sink on :8090 in this process tree
export STRESS_SINK_URL=http://host.docker.internal:8090/sink

# Run the primary scenario (60 min total under the default ramp).
./scripts/run.sh --scenario events-callback
```

## Quick start (in-cluster)

```bash
# 1. Build the sink image and load it into Minikube (auto-detects the active
#    profile from the kubectl context; works on the `yoizen-arch` profile too).
./tests/stress/phase1/sink/build-and-load.sh

# 2. Deploy as a Knative service.
kubectl apply -f tests/stress/phase1/sink/knative-service.yaml

# 3. Verify it's Ready (a few seconds).
kubectl -n platform-services-dev get ksvc stress-sink

# 4. Run the scenario, pointing the callback at the in-cluster sink DNS.
cd tests/stress/phase1
export ADMIN_EMAIL=...
export ADMIN_PASSWORD=...
export STRESS_SINK_URL=http://stress-sink.platform-services-dev.svc.cluster.local/sink
./scripts/run.sh --scenario events-callback

# 5. After the run, pull the deliveries out of the pod for the reconciler.
./sink/fetch-jsonl.sh --out reports/run-1.sink.jsonl
bun run reconcile/reconcile.ts \
  --scenario events-callback \
  --sink reports/run-1.sink.jsonl \
  --output reports
```

### Sink image: build & access cheat sheet

| Action | Command |
|--------|---------|
| Build + load into Minikube (auto-detects profile) | `./sink/build-and-load.sh` |
| Build only (no load) | `STRESS_SINK_PUSH_MODE=none ./sink/build-and-load.sh` |
| Push to a remote registry | `STRESS_SINK_IMAGE=ghcr.io/<org>/stress-sink:<tag> STRESS_SINK_PUSH_MODE=registry ./sink/build-and-load.sh` |
| Deploy / re-deploy | `kubectl apply -f sink/knative-service.yaml` |
| Tail deliveries live | `kubectl -n platform-services-dev logs -f -l serving.knative.dev/service=stress-sink --container=stress-sink` |
| Pull JSONL after a run | `./sink/fetch-jsonl.sh --out reports/sink.jsonl` |
| Pull JSONL via `kubectl cp` (if stdout mirror is off) | `./sink/fetch-jsonl.sh --mode cp --out reports/sink.jsonl` |
| In-cluster URL (callback target) | `http://stress-sink.platform-services-dev.svc.cluster.local/sink` |
| External URL (Knative + Kourier) | `kubectl -n platform-services-dev get ksvc stress-sink -o jsonpath='{.status.url}'` (then `Host:` header through your Kourier port-forward) |

The image is named `dev.local/stress-sink:dev` by default — the `dev.local`
prefix is in Knative's default `registries-skipping-tag-resolving` list, so the
deployment doesn't try to talk to a remote registry. Override with
`STRESS_SINK_IMAGE` if you need a real registry tag.

## Stages

Five steady-state stages plus a spike. All durations and rates are env-overridable
without editing the source. Defaults match the plan:

| Stage    | Duration | Rate (msg/s) | k6 VUs (preallocated) |
|----------|----------|--------------|------------------------|
| baseline | 10 m     | 10           | 5                      |
| light    | 15 m     | 50           | 25                     |
| medium   | 15 m     | 200          | 100                    |
| heavy    | 15 m     | 500          | 250                    |
| peak     | 10 m     | 1000         | 500                    |
| spike    | 2 m      | 2000 → 200   | 1000                   |

To run a smoke profile (≈2 min total), override the durations:

```bash
export STRESS_BASELINE_DURATION=20s
export STRESS_LIGHT_DURATION=30s
export STRESS_MEDIUM_DURATION=30s
export STRESS_HEAVY_DURATION=30s
export STRESS_PEAK_DURATION=20s
export STRESS_SPIKE_RAMP=5s
export STRESS_SPIKE_HOLD=15s
./scripts/run.sh --scenario events-callback
```

Full list of overrides (`STRESS_*`):

| Env var | Purpose |
|---------|---------|
| `STRESS_TARGET` | Explicit base URL (overrides Knative DNS + Kourier). |
| `API_GATEWAY_URL` | Knative DNS for the gateway (used to set `Host` header). |
| `KOURIER_HOST` / `KOURIER_PORT` | Port-forward target. |
| `SMOKE_TEST_NAMESPACE` / `STRESS_NAMESPACE` | k8s namespace. |
| `MINIKUBE_DOMAIN` | DNS suffix when no explicit target is set. |
| `E2E_TENANT` | Tenant slug for `x-yoizen-tenant` header. |
| `STRESS_SINK_URL` | Where api-gateway forwards the callback (sink endpoint). |
| `STRESS_SINK_LOCAL=true` | Spawn the Bun sink locally during the run. |
| `STRESS_SINK_PORT` | Local sink port (default 8090). |
| `STRESS_SINK_OUTPUT` | Override sink JSONL path. |
| `STRESS_PAYLOAD_SIZE=median` or `p95` | Pin payload size; default = 95% median, 5% p95. |
| `STRESS_<STAGE>_RATE` / `_DURATION` / `_VUS` | Per-stage knobs. |

## Scenarios

### `webhook-ingress`

`POST /api/webhooks/whatsapp/<tenant>` (provider-style). No JWT (provider
signature is out of scope for Phase 1). Measures channel-service ingest ack.

## Outputs

After every run, `reports/` contains:

- `<scenario>-<ts>.k6.json` — k6 streaming NDJSON (every metric sample).
- `<scenario>-<ts>.k6.summary.json` — k6 aggregated summary.
- `<scenario>-<ts>.sampler.jsonl` — Knative replica + HPA timeline (when
  `--with-sampler true`, default). Reuses the existing
  [`tests/stress/scale/sampler.ts`](../scale/sampler.ts).
- `<scenario>-<ts>.sink.jsonl` — every delivery observed by the sink.
- `<scenario>-<ts>.reconcile.md` — per-stage table:
  `Sent / Delivered / Lost / Loss % / Duplicates / p50 / p95 / p99 / min / max`.
- `<scenario>-<ts>.reconcile.csv` — same table for spreadsheet ingestion.

## Stop rules (per the plan §1.5)

The reconcile report flags any stage where:

- error rate > 1% (from k6 thresholds, also check `http_req_failed`)
- e2e p95 > the agreed SLA (configure your own; the k6 threshold is informational)
- message loss > 0
- duplicates > 0
- any pod restart (read the sampler timeline / Grafana for this — out of band)

The first stage that triggers any rule is the deliverable.

## Performance notes

The implementation deliberately avoids hot-path allocations and uses
constant-time data structures throughout:

- `Map<string, T>` for stage stats, payload pools, env caches, correlation
  dedupe, and k6 scenario assembly. No linear scans on the hot path.
- `LatencyHistogram` records latency in `O(1)`; percentiles are `O(buckets)`
  and avoid sorting an array of every observation.
- The sink's JSONL writer batches writes to a 64 KiB buffer (configurable) and
  flushes on size or 1 s, which keeps disk I/O off the request path.
- The reconciler streams JSONL line-by-line via `readline` — never loads the
  full file into memory; total memory is `O(unique correlation_ids)`.

## Linting

```bash
cd tests/stress/phase1
bun install        # or npm install
npm run lint
npm run build      # type-check only (no emit)
```

## Migration note

This replaces (does not remove) the Artillery suite under
[`tests/stress/artillery`](../artillery/). The
[`tests/stress/scale/sampler.ts`](../scale/sampler.ts) and
[`tests/stress/scale/report.ts`](../scale/report.ts) are reused as-is.
