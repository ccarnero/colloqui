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

Runs the e2e workflow suite (`tests/e2e/workflow.e2e.spec.ts` + `auth.setup.ts`) against the dev cluster.

### Optional: MongoDB storage engine

```bash
STORAGE_ENGINE=mongo ./bootstrap-orbstack-osx.sh
```

Full documentation: [DOCS/README.md](DOCS/README.md)
