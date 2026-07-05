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
ADMIN_EMAIL=admin@yoizen.test ADMIN_PASSWORD=admin bash scripts/smoke-test.sh
# or with client credentials:
E2E_CLIENT_ID=... E2E_CLIENT_SECRET=... bash scripts/smoke-test.sh
```

Runs a Kubernetes readiness preflight against the dev cluster: every configured
Knative Service and plain worker Deployment must be Ready. It does **not** run
the workflow/browser e2e suites. Use `scripts/e2e-http-workflow.sh` for the
HTTP workflow smoke path, and the Playwright specs under `e2e/` for browser
flows.

### Verify a fresh cluster (recommended order)

```bash
./scripts/smoke-test.sh                          # 1. all 25 workloads Ready
E2E_API_URL=http://localhost:8080 \
  ./scripts/e2e-http-workflow.sh                 # 2. HTTP → workflow → jsFunction chain
cd sdk && SDK_E2E=1 npm run test:e2e             # 3. full API contract (57 assertions via @yoizen/platform-sdk)
```

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
StorageClass). `BUILD_PARALLELISM=2` paces the 18-image build on smaller machines.

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
E2E_API_URL=http://localhost:8080 ./scripts/e2e-http-workflow.sh

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

Full documentation: [DOCS/README.md](DOCS/README.md)
