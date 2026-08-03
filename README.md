# Platform Cluster

Serverless event-driven architecture on Kubernetes (Minikube / OrbStack) with Knative Serving, NATS JetStream, Redis, PostgreSQL, and Temporal.

## Developer mode — quickstart

Single-node, single-environment (`dev`) setup. No env argument, no KEDA, single-pod infra.

### Bring up (OrbStack — recommended on macOS)

```bash
./bootstrap-orbstack-osx.sh          # full bring-up (support + platform)
./bootstrap-orbstack-osx.sh --smoke  # same + run smoke tests at the end
```

Bootstrap writes a `/etc/hosts` managed block so the stable hostname resolves immediately:

```
127.0.0.1 api-gateway.platform-services-dev.dev.local
127.0.0.1 admin-console.platform-services-dev.dev.local
```

### Seed the tenant (required after every fresh bring-up)

Bootstrap does **not** seed data. A cluster reset wipes the database PVCs, so the
`acme` tenant and admin user must be re-created before running any e2e suite:

```bash
./port-forward.sh        # separate terminal (exposes the gateway on localhost:8080)
./setup-tenant.sh        # idempotent: creates tenant 'acme' + admin yclawd@demo.io
```

Alternatively, `scripts/orbstack/startup.sh` chains the full path in one command:
bootstrap → readiness gate → tenant seed → HTTP workflow e2e.

### Access

```
API Gateway:   http://api-gateway.platform-services-dev.dev.local
Admin Console: http://admin-console.platform-services-dev.dev.local
```

### Iterate (rebuild changed service images)

```bash
./rebuild-changed.sh
```

Tilt is an optional alternative — see the `Tiltfile` header for details.

### Source-mounted dev mode (skip image rebuilds)

For rapid TypeScript iteration without rebuilding Docker images:

```bash
./dev-mode.sh deps                  # populate node_modules PVC (once)
./dev-mode.sh channel-service on    # mount source + bun --watch
./dev-mode.sh channel-service off   # restore image mode
./dev-mode.sh status                # show what's in dev mode
```

See [DOCS/guides/dev-mode.md](DOCS/guides/dev-mode.md) for full documentation.

### Smoke test

```bash
bash scripts/smoke-test.sh
# non-default namespace:
SMOKE_TEST_NAMESPACE=platform-services-dev bash scripts/smoke-test.sh
```

Runs a Kubernetes readiness preflight against the dev cluster: every configured
Knative Service and plain worker Deployment must be Ready. It sends no traffic
and needs no credentials — `SMOKE_TEST_NAMESPACE` (default
`platform-services-dev`) is the only environment variable it reads. It does
**not** run the workflow/browser e2e suites. Use `scripts/e2e/http-workflow.sh`
for the HTTP workflow smoke path, and the Playwright specs under `e2e/` for
browser flows.

### Verify a fresh cluster (recommended order)

```bash
./scripts/smoke-test.sh                          # 1. 26 workloads Ready (18 ksvc + 8 worker Deployments)
E2E_API_URL=http://localhost:8080 \
  ./scripts/e2e/http-workflow.sh                 # 2. HTTP → workflow → jsFunction chain
cd sdk && SDK_E2E=1 npm run test:e2e             # 3. full API contract (62 cases across 9 files, via @yoizen/platform-sdk)
```

The preflight covers `ALL_KNATIVE_SERVICES` (18/18 of the ksvc manifests) and
`ALL_PLAIN_DEPLOYMENTS` — 8 of the 11 worker Deployments declared under
`knative/services/base`. `connector-runtime-http`, `connector-runtime-invoke`
and `tracking-ingester-worker` are **not** checked; see that script's header.

Steps 2–3 require the tenant seed (above) and the port-forward on `localhost:8080`.
The SDK e2e suite is gated behind `SDK_E2E=1` (plain `npm test` stays offline-safe)
and runs serially by design — the gateway rate-limits per tenant. Environment
overrides (`YOIZEN_BASE_URL`, `YOIZEN_TENANT`, credentials) are documented in
[sdk/test/e2e/README.md](sdk/test/e2e/README.md).

### Optional: MongoDB storage engine

```bash
STORAGE_ENGINE=mongo ./bootstrap-orbstack-osx.sh
```

## Minikube (Linux)

For running locally on a Linux host with minikube (docker driver). Same workflow
as OrbStack, with three adaptations baked into dedicated `*-minikube*` variants
(the OrbStack scripts are untouched): images build into minikube's own daemon,
infrastructure uses the `local` overlay, and dev mode uses a polling reloader
because the 9p mount carries no inotify events.

### Prerequisites

- minikube (docker driver), started and running on the Linux host:
  ```bash
  minikube start -p minikube --addons=metrics-server
  ```
- On `PATH`: `docker`, `kubectl`, `helm`, `npm`, `jq`, `yq`, and a standalone
  `kustomize` >= 5.7.0 (avoids the kubectl-bundled kustomize SIGSEGV, #5552).
- The repo cloned on the **same host** where minikube runs — source-mounted dev
  mode mounts the local clone into the node.

### Resource tuning (recommended on modest boxes)

minikube's `--cpus` flag may not apply with the docker driver, leaving the
cluster uncapped so it can starve the host (and your shell). Cap the container
directly so the host keeps headroom:

```bash
docker update --cpus=6 --memory=13g --memory-swap=13g minikube
```

Persists across `minikube stop/start` and host reboot; re-apply only after a
`minikube delete`.

### Bring up

```bash
BUILD_PARALLELISM=2 ./bootstrap-minikube-linux.sh           # full bring-up (support + platform)
BUILD_PARALLELISM=2 ./bootstrap-minikube-linux.sh --smoke   # same + smoke tests
STORAGE_ENGINE=mongo BUILD_PARALLELISM=2 ./bootstrap-minikube-linux.sh   # mongo OLTP
```

Builds images into minikube's own daemon (`minikube docker-env`) and applies
`infrastructure/overlays/local` (relies on minikube's default `standard`
StorageClass). `BUILD_PARALLELISM=2` paces the 20-image build on smaller
machines — the build set is `YZ_SERVICES` in `services.conf`, one image per
directory under `services/`.

### Access (ingress)

Unlike OrbStack, minikube needs a tunnel for the Kourier LoadBalancer, and the
`/etc/hosts` block requires sudo (the bootstrap warns and prints it if sudo is
unavailable):

```bash
sudo minikube tunnel -p minikube    # separate terminal, keep it running
```

```
127.0.0.1 api-gateway.platform-services-dev.dev.local
127.0.0.1 admin-console.platform-services-dev.dev.local
```

### Validate (tenant + remote execution)

Without `minikube tunnel`, exercise the running platform through a Kourier
port-forward and point the scripts at `localhost` (they send the `Host` header
themselves, so Kourier still routes by hostname):

```bash
kubectl port-forward -n kourier-system svc/kourier 8080:80 &   # keep it running

# 1. provision the demo tenant (acme) + tenant admin (yclawd@demo.io)
./setup-tenant.sh --api-url http://localhost:8080

# 2. remote-execution e2e: http POST -> channel-service -> NATS -> workflow
#    trigger -> Temporal -> jsFunction console.log (asserts the nonce in logs)
E2E_API_URL=http://localhost:8080 ./scripts/e2e/http-workflow.sh

# 3. preflight: every ksvc + worker Deployment is Ready
./scripts/smoke-test.sh
```

The first request to a scaled-to-zero Knative service cold-starts it (the
activator holds the request); the scripts retry, so an initial slow response is
expected. The e2e passes even with `channel-service` in dev mode.

### Source-mounted dev mode (minikube)

```bash
./dev-mode-minikube.sh deps                  # populate node_modules PVC (once)
./dev-mode-minikube.sh channel-service on    # 9p-mount source + polling reloader
./dev-mode-minikube.sh channel-service off   # restore image mode
./dev-mode-minikube.sh status                # show what's in dev mode
```

The dev container runs a mtime **polling reloader** (`scripts/dev-poll-reload.sh`)
instead of `bun --watch`, since 9p carries file data but not inotify events.
Reload latency ~1-2s. `dev-mode-minikube.sh on` starts the `minikube mount`
automatically (`mount`/`unmount` for manual control).

### Caveats

- `/etc/hosts` and `minikube tunnel` need sudo — run them by hand if `chris` has
  no passwordless sudo.
- First bring-up pulls images cold into minikube's daemon, so infra waits are
  300s (vs OrbStack's faster shared daemon).
- After a host reboot / minikube restart, the CloudNativePG operator pod can hang
  in `ContainerCreating` ("Pod sandbox changed") — recreate it, then re-run the
  bootstrap (idempotent):
  ```bash
  kubectl delete pod -n cnpg-system -l app.kubernetes.io/name=cloudnative-pg --force
  ```

## Reset scripts (stuck timeouts / stale test-run residue)

Between stress runs or after a failed integration-test run, leftover state
can make the *next* run fail with what looks like a fresh timeout even
though nothing is actually slow — a tripped circuit breaker's cooldown TTL,
a Temporal workflow still `Running`, or old messages/rows still sitting in
NATS/Postgres/Redis. All reset/cleanup scripts live under `scripts/reset/`
and clear that residue without touching topology, schemas, or credentials:

| Script | Clears | Notes |
|---|---|---|
| `scripts/reset/purge-circuit-breakers.sh` | Redis breaker state under the three `DEFAULT_PREFIXES`: `cb:workflow:http`, `cb:workflow:agent`, `cb:channel:egress` (connector-runtime and workflow-service HTTP/agent calls, channel-service egress) | A tripped breaker's cooldown (~100s) otherwise fails every subsequent call with `Circuit breaker open ... (cooldown)` until it expires on its own. `--dry-run` / `count` subcommand available. |
| `scripts/reset/purge-temporal.sh` | Temporal workflow/history/task-queue tables on `postgres-temporal`, plus `executions_visibility` wherever `resolve_visibility_target` finds it | Full DB recreate takes ~2-4min; this truncates in ~5-10s. Scales the Temporal Deployments it detects to 0 first (`ensure_deployments_exist`: the 4-role HA set, or the single `temporal` auto-setup Deployment this cluster runs) to avoid lock contention. `--dry-run` / `counts` subcommand available. |
| `scripts/reset/reset-dev.ts` | JetStream stream contents + claim-check payloads, per-tenant Postgres/Mongo message & event tables, Redis caches/counters | See `scripts/reset/INVENTORY.md` for the full DATA-vs-CONFIG classification this script implements. Dry-run by default; `--apply` (+ confirmation) actually deletes. Requires `pnpm install` at the repo root once. |
| `scripts/reset/reset-tenant.sh` | Tenant resource *definitions* (workflows, agents, channel accounts, etc.) + `tracking.tracked_events` | Manifest-from-zero wipe; preserves `tenant_users`/`tenant_roles`/`credentials`. `--dry-run` by default. |
| `scripts/reset/reset-all.sh` | Orchestrates all four scripts above in order | One-shot full dev-environment wipe. `--dry-run` by default. |

Each script documents its own required flags/env vars in its header
comment — read that before running it. See `scripts/reset/README.md` for the
full walkthrough and the `.env`/`.env.example` convention.

## Samples & demos

Runnable examples live in three tiers, each with one reason to exist:
[`sdk/examples/`](sdk/examples/README.md) (SDK API-surface examples),
[`integrations/`](integrations/README.md) (end-to-end platform feature references, provisioned
declaratively through the SDK), and [`demos/`](demos/README.md) (commercial showcases — e.g.
[`demos/crm-support-telegram`](demos/crm-support-telegram/README.md), an end-to-end Telegram
support demo backed by a real HubSpot CRM, an AI agent, and a hosted code-over-low-code service,
provisioned entirely through one declarative `manifest.yaml`).

Full documentation: [DOCS/README.md](DOCS/README.md)
