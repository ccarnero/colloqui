# Coexistance Implementation Plan

## Goal

Run and debug `coexistance` inside the `acme` tenant namespace on the local
platform cluster while keeping the setup close to production and preserving a
clean path for future Minikube support.

## Current decisions

- Tenant: `acme`
- First environment: `dev`
- Namespace: `acme-dev-ns`
- First runtime: `OrbStack`
- Workload type: `Deployment` for debug, not `Knative`
- Webhook exposure: direct to the service, not via API Gateway
- NATS: use the cluster bus by internal DNS
- MongoDB: host-backed dependency bridged into the namespace
- Tenant-specific files must live under `acme/coexistance/`

## Target layout

```text
acme/coexistance/
├── app/
│   ├── client/
│   ├── server/
│   ├── package.json
│   └── ...
└── deploy/
    ├── base/
    │   ├── kustomization.yaml
    │   ├── configmap.yaml
    │   ├── secret.example.yaml
    │   ├── deployment.yaml
    │   ├── service.yaml
    │   ├── mongo-host-service.yaml
    │   └── seed-job.yaml
    └── overlays/
        ├── orbstack/dev/
        │   ├── kustomization.yaml
        │   ├── namespace.yaml
        │   ├── endpoint-slice.yaml
        │   ├── env-patch.yaml
        │   └── resources-patch.yaml
        └── minikube/dev/
            ├── kustomization.yaml
            ├── namespace.yaml
            ├── endpoint-slice.yaml
            ├── env-patch.yaml
            └── resources-patch.yaml
```

## Part 1: Copy and rename the app

Source:

- `/Users/chris/Documents/claude-cowork/personal/colloqui/wa-connect`

Destination:

- `acme/coexistance/app`

### First-pass rename scope

Apply these renames during the copy rollout:

- `colloqui` -> `coexistance`
- `wa-connect` -> `coexistance`
- `WA Connect` -> `Coexistance`

### Rename priorities

#### Must change in first pass

- package names in root and workspaces
- backend package metadata
- frontend package metadata
- runtime logs and visible application title
- seeded business names that surface in debug flows
- scripts and local docs that directly affect setup or runtime

#### Can wait for second pass

- long-form historical documentation
- broad editorial cleanup in help docs
- non-functional references in old context notes

### Files to review first

- `app/package.json`
- `app/server/package.json`
- `app/client/package.json`
- `app/server/src/server.js`
- `app/server/src/scripts/seed.js`
- `app/setup.sh`
- `app/docs/help/06-cloudflare-tunnel.md`

## Part 2: Application runtime contract

The backend currently behaves as follows:

- Bun + Express server
- app port `6666`
- health endpoint `/api/health`
- webhook endpoint `/api/webhooks/whatsapp`

Required environment values include:

- `PORT=6666`
- `MONGODB_URI`
- `JWT_SECRET`
- `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_WABA_ID`
- `LOCAL_TESTING`
- `NATS_URL`

The current code already reads from `process.env`, so Kubernetes-provided env is
the source of truth.

## Part 3: Base Kubernetes manifests

Implement under `deploy/base/`.

### `deployment.yaml`

Create `Deployment` named `coexistance-debug` with:

- one replica
- labels aligned with the platform conventions
- image reference supplied by overlay
- command using Bun inspector
- probes hitting `/api/health`
- ports:
  - `6666` for HTTP
  - `9229` for debugger

Recommended command shape:

```text
bun --inspect=0.0.0.0:9229 --watch src/server.js
```

### Volume strategy

Do not mount the entire application tree over the container workdir if it would
hide `node_modules`.

Preferred first implementation:

- ship dependencies inside the image
- mount only the editable source tree if live-edit is needed
- rebuild the image when dependencies change

### `service.yaml`

Create `Service` named `coexistance-debug` with ports:

- `http: 6666`
- `debug: 9229`

### `configmap.yaml`

Use for non-secret runtime defaults such as:

- `PORT`
- `LOCAL_TESTING`
- `NATS_URL`

### `secret.example.yaml`

Provide an example manifest documenting the required secret keys without real
values.

### `mongo-host-service.yaml`

Create a `Service` without selector named `mongo-host`.

This gives a stable DNS name to the app inside the tenant namespace:

- `mongo-host.acme-dev-ns.svc.cluster.local`

### `seed-job.yaml`

Add an optional one-shot `Job` that runs the existing seed script with the same
environment contract as the main workload.

## Part 4: OrbStack overlay

Implement under `deploy/overlays/orbstack/dev/`.

### Responsibilities

- declare namespace `acme-dev-ns`
- point the workload to the OrbStack image reference
- provide OrbStack-specific env patches
- provide the host MongoDB bridge endpoint
- tune resources if needed

### MongoDB bridge

Add an `EndpointSlice` for `mongo-host` that points to the host endpoint
reachable from OrbStack-backed pods.

This keeps the application using a stable in-cluster DNS name while isolating
runtime-specific host details in the overlay.

### NATS

Use the in-cluster DNS URL already used by the platform local overlays:

- `nats://nats.support-services-dev.svc.cluster.local:4222`

## Part 5: Minikube overlay

Prepare the same overlay shape under `deploy/overlays/minikube/dev/`.

The intent is to keep the base manifests identical and change only runtime
details such as:

- host MongoDB endpoint
- storage or mount behavior if necessary
- resource tuning if the runtime requires it

## Part 6: Local registry impact

The new local registry changes the image strategy but does not change the
service architecture.

### Recommended image workflow

Keep two workflows:

#### Fastest inner loop on OrbStack

- use direct local images when a registry is not necessary
- this avoids duplicate storage and is still the fastest path

#### Pull-based workflow when needed

- use the local registry at `localhost:32000`
- push immutable tags only
- build with `docker buildx build --push`

### Important current limitation

The current Zot registry accepts the image blobs but rejects the manifest push
with HTTP `415` when Docker pushes `application/vnd.docker.distribution.manifest.v2+json`.

Observed result:

- blobs upload successfully
- tag list remains empty
- manifest `PUT` fails

This means the `coexistance` implementation should not depend on the registry
until the registry media-type compatibility issue is resolved.

### Immediate recommendation

For the first `coexistance` rollout on OrbStack:

- keep using direct local images for the debug workload
- revisit registry-backed pulls after the registry push issue is fixed

This preserves the disk-safe hybrid model and avoids blocking the service work.

## Part 7: Validation checklist

### Copy and rename

- [ ] copied app exists under `acme/coexistance/app`
- [ ] runtime/package names say `coexistance`
- [ ] visible UI branding says `Coexistance`

### Deployment

- [ ] `kubectl kustomize` renders `deploy/overlays/orbstack/dev`
- [ ] namespace `acme-dev-ns` exists
- [ ] pod starts in `acme-dev-ns`
- [ ] `/api/health` returns success
- [ ] debugger is reachable on `9229`

### Dependencies

- [ ] pod can reach `mongo-host.acme-dev-ns.svc.cluster.local`
- [ ] pod can reach `nats.support-services-dev.svc.cluster.local:4222`
- [ ] seed job creates expected Mongo records

### Webhook path

- [ ] public tunnel reaches `coexistance-debug`
- [ ] Meta verification request succeeds
- [ ] POST webhook reaches the app while debugger is attached

## Part 8: Suggested execution order

1. Copy `colloqui` into `app/`.
2. Apply the first-pass rename.
3. Add a debug `Dockerfile` to `app/`.
4. Implement `deploy/base`.
5. Implement `deploy/overlays/orbstack/dev`.
6. Validate Mongo and NATS connectivity.
7. Validate debugger attach and webhook handling.
8. Add the Minikube overlay once OrbStack is stable.
