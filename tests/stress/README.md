# Stress Test Suite (Artillery)

This project runs load and stress tests against the cluster to validate
autoscaling behavior under heavy traffic.

## Scenarios

- `events-publish`: pushes load to `POST /api/events` only.
- `events-roundtrip`: exercises `POST /api/events` + `GET /api/results/:id`.
- `webhook-ingress`: hammers webhook ingress (`POST /api/webhooks/:channel/:tenantId`).

## Prerequisites

- Kubernetes cluster running platform services.
- API gateway reachable from this host (usually via `./port-forward.sh`).
- Node.js and Bun installed.
- Credentials:
  - `ADMIN_EMAIL` + `ADMIN_PASSWORD`, or
  - `E2E_CLIENT_ID` + `E2E_CLIENT_SECRET`.

## Install

```bash
cd tests/stress
npm install
```

## Run

```bash
# Scenario only (Artillery metrics)
npm run stress:publish
npm run stress:roundtrip
npm run stress:webhook

# With scaling sampler + scaling report
npm run stress:publish:scale
npm run stress:roundtrip:scale
npm run stress:webhook:scale

# All scenarios sequentially (without sampler)
npm run stress:all
```

## Phase tuning via env vars

Load profile defaults can be overridden per run:

- `ARTILLERY_WARMUP_DURATION` (default `30`)
- `ARTILLERY_WARMUP_RATE` (default `5`)
- `ARTILLERY_RAMP_DURATION` (default `120`)
- `ARTILLERY_RAMP_START_RATE` (default `5`)
- `ARTILLERY_RAMP_TO_RATE` (default `200`)
- `ARTILLERY_SUSTAIN_DURATION` (default `180`)
- `ARTILLERY_SUSTAIN_RATE` (default `200`)
- `ARTILLERY_SPIKE_DURATION` (default `60`)
- `ARTILLERY_SPIKE_RATE` (default `500`)
- `ARTILLERY_COOLDOWN_DURATION` (default `60`)
- `ARTILLERY_COOLDOWN_RATE` (default `20`)

Example:

```bash
ARTILLERY_SPIKE_RATE=800 npm run stress:publish:scale
```

## Runtime env vars

- `STRESS_TARGET`: explicit base URL for requests
  (default auto-resolved from `API_GATEWAY_URL` or Knative DNS).
- `SMOKE_TEST_NAMESPACE`: namespace used to build Knative DNS
  (default `platform-services-dev`).
- `MINIKUBE_DOMAIN`: DNS suffix for Knative service URL
  (default `192.168.49.2.sslip.io`).
- `KOURIER_HOST` and `KOURIER_PORT`: when set, requests are routed through
  port-forward and `Host` header is injected.
- `E2E_TENANT`: tenant header for authenticated requests (default `acme`).

## Scaling report artifacts

With `*:scale` scripts, artifacts are created in `reports/`:

- `*.json`: Artillery summary output
- `*.jsonl`: kubectl sampler timeline
- `*.scaling.md`: merged scaling report
