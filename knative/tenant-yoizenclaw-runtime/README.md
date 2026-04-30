# YoizenClaw runtime (tenant namespace)

Kustomize manifests for the Python **YoizenClaw runtime** ([`applications/yoizenclaw-application`](../../applications/yoizenclaw-application)) as a Knative `Service` in a **tenant** namespace (e.g. `acme-dev-ns`), using the same style as platform services (`namespace` in the overlay, YAML in `base/`).

This is **not** part of [`knative/services/base`](../services/base); it is deployed **only** into the tenant namespace where per-tenant PostgreSQL lives.

## Prerequisites

- Kubernetes cluster with **Knative Serving** (see repo `bootstrap.sh`).
- Namespace **`acme-dev-ns`** and tenant **PostgreSQL** reachable at Service hostname **`postgres`** in that namespace (same pattern as [`DOCS/ARCHITECTURE.md`](../../DOCS/ARCHITECTURE.md)).
- **NATS** in `support-services-dev` reachable at  
  `nats://nats.support-services-dev.svc.cluster.local:4222`.
- A **Secret** in `acme-dev-ns` named **`postgres-credentials`** with key **`POSTGRES_PASSWORD`** (same shape as [`knative/services/base/postgres-credentials.yaml`](../services/base/postgres-credentials.yaml)). Adjust the manifest if your tenant uses another name or key.
- Database name **`yoizen`** and user aligned with [`yoizenclaw-admin-service`](../../services/yoizenclaw-admin-service) per-tenant DB usage.

## Build the container image

Build context **must** be the `applications/` directory so `shared/types/python` and `yoizenclaw-application` are both available:

```bash
# From repository root
docker build \
  -t dev.local/yoizenclaw-runtime:local \
  -f applications/yoizenclaw-application/Dockerfile \
  applications/
```

For Minikube, point Docker at the Minikube daemon and load the image if needed:

```bash
eval "$(minikube docker-env -p yoizen-arch)"
# build command above
```

## Deploy

```bash
kubectl apply -k knative/tenant-yoizenclaw-runtime/overlays/acme-dev
```

Or use [`rebuild-redeploy.sh`](../../rebuild-redeploy.sh) (see script help for `yoizenclaw-runtime`).

## Verify

```bash
kubectl get ksvc yoizenclaw-runtime -n acme-dev-ns
kubectl logs -n acme-dev-ns -l serving.knative.dev/service=yoizenclaw-runtime --tail=50
```

Runtime chat is driven over **NATS** (`chat_respond` subjects); HTTP is mainly `/health` and metrics. After deploy, exercise the admin **playground** chat against a published agent for tenant `acme`.

## Other tenants

Copy `overlays/acme-dev/` to a new overlay (e.g. `overlays/globex-dev/`), set `namespace`, and edit [`base/yoizenclaw-runtime.yaml`](base/yoizenclaw-runtime.yaml) or add a **JSON/strategic patch** for `TENANT_ID`, `POSTGRES_*`, and `secretKeyRef`.

## Troubleshooting

If `docker build` fails during `pip install -e .` with **ResolutionImpossible**, the usual causes are: (1) OpenTelemetry packages not on one release line — see pinned OTEL versions in [`applications/yoizenclaw-application/pyproject.toml`](../../applications/yoizenclaw-application/pyproject.toml); (2) **`pydantic-ai`** meta-package pulling optional providers (e.g. Mistral) that pin incompatible `opentelemetry-semantic-conventions` — this repo uses **`pydantic-ai-slim`** with explicit extras instead.
