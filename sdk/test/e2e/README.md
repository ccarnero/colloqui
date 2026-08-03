# SDK e2e (live cluster)

Nine suites live here — `admin-final`, `admin-resources`, `agents`, `channels`,
`connectors-registry`, `http-ingest`, `runtime`, `runtime-stream`, `workflows` — 62 `test()`
cases in total (9 top-level, 53 subtests).

`http-ingest.e2e.ts` is the original one: it reproduces the flow of
`scripts/e2e/http-workflow.sh` — login, create a fresh http channel account, send a message,
assert `"accepted"` — but drives the send through the SDK's public API (`createClient` →
`send` / `sendText`) instead of raw curl. Account create/delete uses plain `fetch` because
account CRUD isn't part of the SDK yet.

Every suite is gated behind `SDK_E2E=1` and excluded from `npm test` (the e2e script matches
`test/e2e/**/*.e2e.ts`, a different glob than `test/**/*.test.ts`). Run them explicitly:

```bash
cd sdk
SDK_E2E=1 npm run test:e2e
```

`--test-concurrency=1` is baked into the `test:e2e` script and is required: the gateway
enforces a per-tenant rate limit and concurrent files trip 429s.

## Required cluster access

The tests need a reachable api-gateway. Each suite inlines the same resolution logic (there
is no shared helper module under `test/e2e/`), mirroring
`integrations/lib/resolve-env.sh`:

1. `YOIZEN_BASE_URL` if set, used as-is.
2. Otherwise probe `http://localhost:${API_GATEWAY_PORT:-8080}/health` (a local port-forward).
3. Otherwise probe `http://api-gateway.platform-services-${YWAI_ENV:-dev}.${DEV_DOMAIN:-dev.local}/health`
   (ingress hostname — the SDK's own default).

To start the port-forward (from the repo root):

```bash
./port-forward.sh dev
```

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `SDK_E2E` | — | must be `"1"` or the test is skipped |
| `YOIZEN_BASE_URL` | (probed, see above) | api-gateway base URL |
| `YOIZEN_TENANT` | `acme` | dev seed tenant |
| `YOIZEN_EMAIL` | `yclawd@demo.io` | dev seed tenant-admin login |
| `YOIZEN_PASSWORD` | `admin123` | dev seed tenant-admin login |
| `API_GATEWAY_PORT` | `8080` | local port-forward port, only used for the probe |
| `YWAI_ENV` | `dev` | namespace suffix, only used for the ingress-hostname probe |
| `DEV_DOMAIN` / `MINIKUBE_DOMAIN` | `dev.local` | ingress domain, only used for the ingress-hostname probe |

`http-ingest.e2e.ts` creates its own http channel account per run (unique `externalId`, built
from `ACCOUNT_PREFIX = "sdk-e2e-http"`) and deletes it in a `finally` block; it also does
best-effort cleanup of any stale accounts left over from a previous failed run. The other
suites follow the same discipline: uniquely-named resources, cleanup in `finally`.
