# Source-Mounted Developer Mode

Source-mounted dev mode lets you edit service TypeScript files on your Mac and see changes reload in the cluster pod in seconds — without a Docker image rebuild. `bun --watch` detects each save and re-runs the entry point inside the pod.

## What it is

In normal developer flow you edit code, run `./rebuild-changed.sh`, and wait for a Docker build. With dev mode:

1. The pod's image is swapped to `oven/bun:1.3.14-slim` (Bun on Debian/glibc).
2. The repo root is mounted read-only into the pod via a hostPath volume (OrbStack VirtioFS).
3. Pre-installed `node_modules` are provided by a shared PVC (`dev-mode-deps`) using the "sandwich" pattern: root, per-service, and per-package module directories are mounted at their expected paths.
4. `bun --watch src/main.ts` (or the appropriate entry point) runs in the container.

File changes on the host are visible to the container immediately — OrbStack VirtioFS supports both direct writes and atomic renames without polling.

## Prerequisites

- OrbStack with Kubernetes enabled.
- Cluster bootstrapped with `./bootstrap-orbstack-osx.sh` (bootstrap auto-configures the required Knative feature flags and creates the deps PVC).
- `jq` on PATH: `brew install jq`.
- Run `./dev-mode.sh deps` once before the first `on` command (and again whenever `pnpm-lock.yaml` changes).

The Knative feature flags required for dev mode (`kubernetes.podspec-volumes-hostpath`, `kubernetes.podspec-persistent-volume-claim`, `kubernetes.podspec-persistent-volume-write`, `kubernetes.podspec-securitycontext`, `kubernetes.podspec-init-containers`) are patched into `knative-serving/config-features` automatically by `./bootstrap-orbstack-osx.sh`. You do not need to apply them manually.

## Quickstart

```bash
# 1. Install/refresh node_modules into the PVC (once, or when pnpm-lock.yaml changes)
./dev-mode.sh deps

# 2. Flip a service to dev mode
./dev-mode.sh channel-service on

# 3. Edit source files — bun --watch reloads automatically
#    e.g. services/channel-service/src/modules/accounts/accounts.service.ts

# 4. Watch logs (Knative pods are labelled serving.knative.dev/service;
#    worker Deployment pods use app.kubernetes.io/name)
kubectl logs -f -n platform-services-dev \
  -l serving.knative.dev/service=channel-service-api -c user-container
# worker: kubectl logs -f -n platform-services-dev deploy/channel-service-worker

# 5. Restore the service to image mode when done
./dev-mode.sh channel-service off
```

## How it works

### hostPath + PVC sandwich

The pod spec gets two volumes:

| Volume name | Source | Mounted at |
|-------------|--------|------------|
| `source` | hostPath `~/sources/yoizen/platform-cluster` | `/app` (read-only) |
| `dev-deps` | PVC `dev-mode-deps` (subPath mounts) | `/app/node_modules`, `/app/services/<svc>/node_modules`, `/app/packages/{shared,database,observability}/node_modules` |

```
/app                          ← hostPath (repo root, read-only)
├── src/                      ← your live source
├── node_modules/             ← PVC subPath: node_modules
├── services/
│   └── channel-service/
│       ├── src/              ← your live source
│       └── node_modules/     ← PVC subPath: services/channel-service/node_modules
└── packages/
    ├── shared/
    │   └── node_modules/     ← PVC subPath: packages/shared/node_modules
    ├── database/
    │   └── node_modules/     ← PVC subPath: packages/database/node_modules
    └── observability/
        └── node_modules/     ← PVC subPath: packages/observability/node_modules
```

pnpm uses relative symlinks from service `node_modules` up to the workspace root `node_modules` — these resolve correctly because the PVC subPaths lay out the same tree structure that pnpm expects.

### bun --watch

The container command is replaced with `bun --watch <entry-point>`. Bun's file watcher detects changes through OrbStack VirtioFS natively (inotify events propagate via the VirtioFS virtio channel). No polling is needed.

### Environment variable preservation

The `on` command uses RFC 6902 JSON patch (`--type json`) against the live object. Env vars live in the `containers[0].env` array and are **never touched** — only `image`, `command`, `workingDir`, `volumeMounts`, `volumes`, `securityContext`, `resources`, and `readinessProbe.failureThreshold` are patched. `SERVICE_MODE`, `OTEL_SERVICE_NAME`, database credentials, and all other env vars stay exactly as declared in the overlay.

### Annotation for tracking

Both the object `metadata.annotations` and the pod template `metadata.annotations` get `yoizen.io/dev-mode: "true"`. The object annotation is used by `status` and by the `rebuild-changed.sh` guard. The template annotation forces a new Knative revision / Deployment rollout when the patch is applied.

## Service reference

All targets use `oven/bun:1.3.14-slim` (Debian/glibc). The deps PVC is installed by a Job running `node:24-slim`, so pnpm installs the gnu-variant optional binaries (`@swc/core-linux-arm64-gnu`, `@temporalio/core-bridge` glibc build, etc.). This matches the production runtime stages which are also Debian-based.

| Logical service | Knative Services (ksvc) | Deployments | Entry point |
|-----------------|-------------------------|-------------|-------------|
| `auth-service` | `auth-service` | — | `src/main.ts` |
| `tenant-service` | `tenant-service` | — | `src/main.ts` |
| `cache-service` | `cache-service` | — | `src/main.ts` |
| `proxy-service` | `proxy-service` | — | `src/main.ts` |
| `registry-service` | `registry-service` | — | `src/main.ts` |
| `api-gateway` | `api-gateway` | — | `src/main.ts` |
| `agent-memory-service` | `agent-memory-service` | — | `src/main.ts` |
| `agent-ai-service` | `agent-ai-service` | — | `src/main.ts` |
| `agent-scheduler-service` | `agent-scheduler-service` | — | `src/main.ts` |
| `ai-agent-gateway` | `ai-agent-gateway` | — | `src/main.ts` |
| `audit-service` | `audit-service-api` | `audit-service-worker` | `src/main.ts` |
| `channel-service` | `channel-service-api` | `channel-service-worker` | `src/main.ts` |
| `connector-admin` | `connector-admin-api` | `connector-admin-worker` | `src/main.ts` |
| `usage-aggregator-service` | `usage-aggregator-api` | `usage-aggregator-worker` | `src/main.ts` |
| `agent-admin-service` | `agent-admin-service` | `agent-admin-service-worker` | `src/main.ts` |
| `workflow-service` | `workflow-service-api` | `workflow-service-worker`, `workflow-worker` | `src/main.ts` / `src/temporal/worker.ts` |
| `connector-runtime` | — | `connector-runtime` | `src/worker.ts` |
| `admin-console` | ❌ not supported | — | — |

The `workflow-worker` deployment (Temporal worker) uses `src/temporal/worker.ts` as its entry point, which differs from the other workflow-service targets.

## `deps` command — lockfile workflow

The `deps` command populates the `dev-mode-deps` PVC by running a Kubernetes Job (`node:24-slim`) that mirrors the Dockerfile's install steps: `corepack enable pnpm && pnpm install --ignore-scripts && pnpm rebuild esbuild`. Running on `node:24-slim` (Debian/glibc) ensures pnpm resolves the gnu-variant optional binaries (`@swc/core-linux-arm64-gnu`, `@temporalio/core-bridge` linux-gnu build) rather than the musl variants. After the Job completes, the sha256 of `pnpm-lock.yaml` is recorded in the `dev-mode-state` ConfigMap.

On every subsequent `deps` run, the local `pnpm-lock.yaml` sha is compared to the recorded value. If they match, the install is skipped (fast). If they differ or `--force` is passed, the Job runs again.

The `on` command also warns you if it detects a sha mismatch before patching:

```
[WARN]  pnpm-lock.yaml has changed since the last deps install.
[WARN]  node_modules in the PVC may be stale. Run: ./dev-mode.sh deps
```

## Troubleshooting

### Watch not triggering

- Confirm OrbStack VirtioFS is the filesystem. This has been tested on OrbStack — other VM providers (Minikube, kind) may not propagate inotify events.
- Check that the file path you're editing is under `services/` or `packages/`. The hostPath mounts the repo root at `/app`; files outside the repo are not visible.
- Look at pod events: `kubectl describe pod -n platform-services-dev -l serving.knative.dev/service=<ksvc>` (Knative targets) or `-l app.kubernetes.io/name=<deployment>` (worker Deployments).

### Stale deps / module not found

If you see `Cannot find module` errors in the pod:

1. Check `./dev-mode.sh status` for deps freshness.
2. Run `./dev-mode.sh deps` to refresh the PVC.
3. After the Job completes, restart the pod: `kubectl rollout restart deployment/<name> -n platform-services-dev` or cycle the service off/on.

If a new package was added to the workspace after the last `deps` run, the PVC's lockfile sha will differ from the local one and `./dev-mode.sh on` will warn you.

### glibc/musl incompatibility — `__register_atfork: symbol not found`

This error means a glibc-linked native `.node` addon was loaded inside a musl (Alpine) container. The two most common triggers in this platform are:

- `@temporalio/core-bridge` — the Rust-backed gRPC transport for the Temporal SDK; upstream ships **only** glibc builds (`linux-arm64-gnu`).
- `@swc/core` — ships both musl and gnu variants; pnpm picks the one that matches the installer image's libc.

**The fix is already in place**: all dev-mode targets and the deps-install Job run on Debian/glibc images (`oven/bun:1.3.14-slim` and `node:24-slim` respectively). The PVC therefore contains gnu-variant binaries. If you see this error after running `deps --force`, verify that both images are actually `slim` (not `alpine`) and that the Job pod ran on `node:24-slim`.

### connector-admin / tsx note

`connector-admin`'s `package.json` uses `tsx` as its development runner. Dev mode runs `bun --watch src/main.ts` instead. Bun can execute TypeScript directly without tsx; this is expected to work. If you encounter tsx-specific runtime behaviour (e.g. module resolution differences), file an issue — the workaround would be to switch connector-admin to a Node-based image override.

### `off` restores the last-built image

`./dev-mode.sh <svc> off [--overlay postgres-dev|mongo-dev]` restores the service from the kustomize overlay (default `postgres-dev`) using an RFC 6902 JSON patch — `kubectl replace` and `kubectl apply` are both avoided (the former rejects Knative's immutable creator annotation, the latter's strategic merge leaves orphaned volumes that fail Knative validation). This restores `image: dev.local/<svc>:local`, which is whatever image was last built by `./rebuild-redeploy.sh` or `./bootstrap-orbstack-osx.sh`. It does **not** trigger a fresh build. If you need an up-to-date image: `./rebuild-redeploy.sh <svc>`.

### Multiple services in dev mode

Each service is independent. You can have several services in dev mode simultaneously. `./dev-mode.sh status` lists all of them.

### rebuild-changed.sh skips dev-mode services

`./rebuild-changed.sh` automatically skips services that carry the `yoizen.io/dev-mode=true` annotation. You will see:

```
[WARN]  channel-service is in source-mounted dev mode — skipping image rebuild
[WARN]    Run ./dev-mode.sh channel-service off  to return to image mode
```

This prevents `rebuild-changed.sh` from overwriting your live patch with an image-based rollout.

## CronJob handling in `rebuild-redeploy.sh`

`rebuild-redeploy.sh <service> <env>` (unless run with `--build-only`) also reconciles any plain Kubernetes CronJobs associated with the service, via `ensure_cronjobs`. This is separate from `rollout_ksvc`/`rollout_deployments`, which only patch/restart resources that already exist — a CronJob needs a first-time `kubectl apply` before it exists at all.

`get_cronjob_names` maps a logical service to its CronJob names. Today only `tracking-ingester-service` maps to `tracking-payload-scrub`; every other service maps to an empty list (no-op).

For each mapped CronJob name, `ensure_cronjobs` branches on whether it already exists in the target namespace:

- **Missing** — the script renders the environment's kustomize overlay (`dev` → `knative/services/overlays/local/postgres-dev`; other environments have no overlay wired up yet and are skipped with a warning) and applies **only** that CronJob's document, extracted from the multi-doc kustomize output. The applied object still carries whatever `spec.suspend` value the manifest declares (e.g. `tracking-payload-scrub-cronjob.yaml` ships `suspend: true`), so any human-runs-first gate on that CronJob still applies after this auto-create.
- **Existing** — the script leaves it completely untouched. It never re-applies or patches an existing CronJob, specifically so a human-managed `spec.suspend` flip (e.g. after the gate above is satisfied) is never clobbered back to the manifest's default.

Either way, a rebuilt image is picked up automatically: the CronJob references the service's image tag, so the next scheduled run spins up fresh Job pods against the image `rebuild-redeploy.sh` just pushed. No CronJob-specific rollout step is needed after a rebuild.

### Registering a new service CronJob

1. Add the CronJob manifest under `knative/services/base/`, wire it into the base `kustomization.yaml`, and add any environment-specific patch (e.g. under `knative/services/overlays/local/postgres-dev`) the same way the other base resources are patched per environment.
2. Add the service → CronJob-name mapping in `get_cronjob_names` in `rebuild-redeploy.sh`.

Once both are in place, `rebuild-redeploy.sh <service> <env>` will apply the CronJob automatically the first time it runs against an environment where the CronJob doesn't exist yet, and leave it alone on every run after that.

## Validating dev mode — `scripts/validate-dev-mode.sh`

`./scripts/validate-dev-mode.sh [--with-e2e]` is the end-to-end proof that dev mode still works on this cluster. It runs seven stages against `workflow-service` (the hardcoded guinea pig — worst case: 1 ksvc + 2 worker Deployments): preflight, snapshot the declared image+command of every object, `dev-mode.sh on` (waiting for the rollout), a live-reload canary, the **readiness barrier** (stage 4b), an optional e2e smoke, `dev-mode.sh off`, and a restoration check (the 2026-06-13 regression guard). Manual-loop SPECs use it as the precondition for their per-iteration dev-mode gates.

### Stage 4 — the live-reload canary

Stage 4 appends `console.log("dev-mode-canary-<ts>")` to `services/workflow-service/src/main.ts`, waits for that nonce to appear in the reloaded worker pod's logs, and then undoes the edit with `git checkout -- <file>`. Both the append and the revert are file writes, so **each of them restarts `bun --watch`**.

### Stage 4b — the stage-4→5 readiness barrier

`src/main.ts` is the entry point of the `workflow-service-*` worker Deployments **and** of the `workflow-service-api` ksvc. Stage 4 only observes the worker Deployment, so the API ksvc is still restarting when the canary reports success. Stage 4b closes that window before stage 5's e2e starts:

- **Probe** — authenticated `GET /api/workflows` through the API gateway, i.e. the exact transport stage 5 uses (it reuses the e2e's `E2E_API_URL` / `E2E_HOST_HEADER` / `E2E_TENANT` / `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_RESOLVE_IP` env overrides). A 401/403 refreshes the token instead of counting as un-readiness.
- **Shape check, not liveness** — a sample is good only when the response is HTTP 200 **and** the body is a JSON *array*. During a reload the gateway answers a well-formed HTTP 502 JSON *object*, which a plain 200/liveness check would never catch.
- **Consecutive samples after the observed outage** — `BARRIER_CONSECUTIVE` (3) good samples in a row, accepted only once at least one bad sample proved the revert's reload actually happened. The append and the revert are two distinct reloads, so a single 200 can legitimately land in the gap between them.
- **Grace for a too-fast restart** — if no outage is sampled within `BARRIER_RELOAD_GRACE` (20s) but the streak holds, the barrier accepts with a `[WARN]`; it never skips silently.
- **Bounded, never a fixed sleep** — `BARRIER_TIMEOUT` (120s) from the revert, polling every `BARRIER_INTERVAL` (1s), then a hard failure. Every attempt logs elapsed time, HTTP code, JSON type and streak.

The knobs live at the top of `scripts/validate-dev-mode.sh` (`BARRIER_*`).

### Historical race (2026-07-16 → 2026-07-30)

Between 2026-07-16 and 2026-07-30 the validator had no barrier: stage 5 started on the line right after the canary revert. It reliably hit the ~2–2.5s restart window of the `workflow-service-api` ksvc, where the gateway returns:

```json
{"statusCode":502,"message":"dial tcp 127.0.0.1:3000: connect: connection refused\n"}
```

Two consumers broke on that body. The e2e's workflow LIST does `jq -r '.[] | select(.name | ...)'`, and `.[]` over that object iterates its *values* — so jq indexes the number `502` with `"name"` and fails with `jq: Cannot index number with string "name"`. `provisioning-service`'s workflow `findByName` saw the same 502, downgraded the lookup to a warning, and applied the manifest partially — surfacing later as `Manifest apply response missing an expected resource externalId`.

The symptom was diagnosed twice (2026-07-16, re-confirmed 2026-07-24) and every backend manual-loop degraded to commit-gates-only in the meantime. Full evidence and the fix: `manual-loops/architecture/dev-mode-validator-fix.md` (T01 findings + T02, 2026-07-30). If you see a 502-shaped failure in stage 5 again, read the stage-4b attempt log first — it prints exactly what the API was answering.

## Limitations

- **OrbStack only.** The hostPath mount relies on OrbStack's VirtioFS and the single-node cluster topology. Minikube and remote clusters require a different approach (e.g. Tilt sync, or `livenessPatch` with a cloud volume).
- **Hardcoded repo path.** `REPO_PATH` in `dev-mode.sh` is an absolute host path to this repo checkout. On a different machine or checkout location, update that constant before using `on`.
- **admin-console excluded.** The Angular SPA is compiled at build time to static assets. It has no TypeScript runtime to watch; `bun --watch` does not apply. Use `./rebuild-redeploy.sh admin-console` as usual.
- **Root node_modules layout.** Only the three workspace packages with the most cross-service usage (`shared`, `database`, `observability`) get dedicated PVC subPath mounts. If a service imports directly from another package not on this list, you may see a module-not-found error — open an issue to add the subPath.
- **Single active PVC.** The `dev-mode-deps` PVC is `ReadWriteOnce`. Only one Job can write to it at a time. The `deps` command creates a new Job with `generateName` each time; concurrent runs will queue on the PVC.
