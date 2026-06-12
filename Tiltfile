# =============================================================================
# Tiltfile — platform-cluster dev environment
# =============================================================================
#
# Optional convenience layer: replaces the manual
#   ./bootstrap-orbstack-osx.sh dev platform-services + ./port-forward.sh dev
# workflow during active development. The bootstrap scripts are the primary
# and authoritative way to stand up the cluster.
#
# Prerequisites (run once before `tilt up`):
#   1. Minikube profile "yoizen-arch" running
#   2. ./bootstrap-orbstack-osx.sh support-services
#      (installs Knative, Kourier, CNPG, infrastructure)
#
# Usage:
#   tilt up                        # start dev loop (default: postgres, dev)
#   STORAGE_ENGINE=mongo tilt up   # mongo overlay
#   TILT_ENV=qa tilt up            # qa environment
#
# What this file does:
#   - Restricts to minikube context "yoizen-arch"
#   - Patches config-deployment for dev.local registry (idempotent)
#   - Applies Knative serving config + RBAC
#   - Builds all 19 service images via Minikube docker daemon
#   - Applies kustomize overlay for platform services
#   - Configures port-forwards (api-gateway, admin-console, support services)
#   - Groups split services (api+worker+scaler) into single Tilt resources
#
# Environment variables:
#   STORAGE_ENGINE  — postgres (default) or mongo. Selects kustomize overlay.
#   TILT_ENV        — Environment suffix (default: dev).
# =============================================================================

allow_k8s_contexts('yoizen-arch')

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------
storage_engine = os.environ.get('STORAGE_ENGINE', 'postgres')
tilt_env = os.environ.get('TILT_ENV', 'dev')
platform_ns = 'platform-services-{}'.format(tilt_env)
support_ns = 'support-services-{}'.format(tilt_env)

# ---------------------------------------------------------------------------
# Idempotent: patch config-deployment so Knative skips tag-to-digest for
# dev.local images. The bootstrap script does this too — calling it here
# ensures it's set even if support-services was bootstrapped without it.
# ---------------------------------------------------------------------------
local(
    "kubectl patch configmap/config-deployment " +
    "--namespace knative-serving " +
    "--type merge " +
    "--patch '{\"data\":{\"registries-skipping-tag-resolving\":\"dev.local\"}}' " +
    "|| true"
)

# ---------------------------------------------------------------------------
# Knative serving config (autoscaler, GC) and RBAC (cluster-role, bindings)
# ---------------------------------------------------------------------------
k8s_yaml(kustomize('knative/serving'))
k8s_yaml(kustomize('knative/services/rbac'))

# ---------------------------------------------------------------------------
# Register custom resource types so Tilt recognizes them as workloads.
# Without this, Tilt ignores Knative Services.
# ---------------------------------------------------------------------------
k8s_kind('Service',
         api_version='serving.knative.dev/v1',
         image_json_path='{.spec.template.spec.containers[*].image}')

# ---------------------------------------------------------------------------
# Select kustomize overlay based on storage engine.
#   mongo    -> knative/services/overlays/local/mongo-{env}
#   postgres -> knative/services/overlays/local/postgres-{env}
# ---------------------------------------------------------------------------
if storage_engine == 'mongo':
    overlay_path = 'knative/services/overlays/local/mongo-{}'.format(tilt_env)
else:
    overlay_path = 'knative/services/overlays/local/postgres-{}'.format(tilt_env)

# ---------------------------------------------------------------------------
# Docker image builds
# ---------------------------------------------------------------------------
# Each service has an `only` filter listing the local paths Tilt watches.
# File changes outside these paths do NOT trigger a rebuild.
#
# Categories based on Dockerfile COPY directives:
#
# Group A — NestJS + shared/observability/database/testing:
#   auth-service, tenant-service, registry-service, channel-service,
#   connector-admin, usage-aggregator-service
#
# Group B — NestJS + shared/observability/database:
#   api-gateway, cache-service, audit-service, workflow-service,
#   agent-admin-service, ai-agent-gateway,
#   agent-ai-service, agent-memory-service, agent-scheduler-service
#
# Group C — NestJS + shared/observability (no database):
#   proxy-service, connector-runtime
#
# Group D — Angular (node+nginx, angular-shared):
#   admin-console
#
# ---------------------------------------------------------------------------

_nestjs_core = ['package.json', 'packages/shared', 'packages/observability', 'packages/database']
_nestjs_testing = _nestjs_core + ['packages/testing']
_nestjs_no_db = ['package.json', 'packages/shared', 'packages/observability']

_nestjs_testing_svcs = [
    'auth-service',
    'tenant-service',
    'registry-service',
    'channel-service',
    'connector-admin',
    'usage-aggregator-service',
]

_nestjs_core_svcs = [
    'api-gateway',
    'cache-service',
    'audit-service',
    'workflow-service',
    'agent-admin-service',
    'ai-agent-gateway',
    'agent-ai-service',
    'agent-memory-service',
    'agent-scheduler-service',
]

_nestjs_no_db_svcs = [
    'proxy-service',
    'connector-runtime',
]

for svc in _nestjs_testing_svcs:
    docker_build(
        'dev.local/{}:local'.format(svc),
        context='.',
        dockerfile='services/{}/Dockerfile'.format(svc),
        only=['services/{}'.format(svc)] + _nestjs_testing,
    )

for svc in _nestjs_core_svcs:
    docker_build(
        'dev.local/{}:local'.format(svc),
        context='.',
        dockerfile='services/{}/Dockerfile'.format(svc),
        only=['services/{}'.format(svc)] + _nestjs_core,
    )

for svc in _nestjs_no_db_svcs:
    docker_build(
        'dev.local/{}:local'.format(svc),
        context='.',
        dockerfile='services/{}/Dockerfile'.format(svc),
        only=['services/{}'.format(svc)] + _nestjs_no_db,
    )

# Group D — admin-console (Angular + nginx, watches angular-shared)
docker_build(
    'dev.local/admin-console:local',
    context='.',
    dockerfile='services/admin-console/Dockerfile',
    only=['services/admin-console', 'packages/angular-shared'],
)

# ---------------------------------------------------------------------------
# Apply platform services kustomize overlay
# ---------------------------------------------------------------------------
k8s_yaml(local('kubectl kustomize ' + overlay_path))

# ---------------------------------------------------------------------------
# Port-forwards for platform services (auto-discovered by Tilt from YAML)
# ---------------------------------------------------------------------------
# ===========================================================================
# Platform resource configuration — label categories
#
#   core     — Infra base: gateway, auth, tenant, registry, cache, proxy
#   ai       — Yoizenclaw agent ecosystem
#   channel  — Channel & connector services
#   workflow — Workflow, audit, usage aggregation
#   admin    — Admin UI (Angular frontend)
# ===========================================================================

# -----------------------------------------------------------------------
# Core infrastructure services
# -----------------------------------------------------------------------
k8s_resource(
    'api-gateway',
    port_forwards='8080:3000',
    labels=['core'],
)
k8s_resource('auth-service', labels=['core'])
k8s_resource('tenant-service', labels=['core'])
k8s_resource('registry-service', labels=['core'])
k8s_resource('cache-service', labels=['core'])
k8s_resource('proxy-service', labels=['core'])

# -----------------------------------------------------------------------
# AI agent ecosystem
# -----------------------------------------------------------------------
k8s_resource('agent-ai-service', labels=['ai'])
k8s_resource('agent-memory-service', labels=['ai'])
k8s_resource('agent-scheduler-service', labels=['ai'])
k8s_resource('ai-agent-gateway', labels=['ai'])
k8s_resource('agent-admin-service', labels=['ai'])
k8s_resource('agent-admin-service-worker', labels=['ai'])

# -----------------------------------------------------------------------
# Admin UI (Angular frontend)
# -----------------------------------------------------------------------
k8s_resource(
    'admin-console',
    port_forwards='4200:8080',
    labels=['admin'],
)

# ---------------------------------------------------------------------------
# Port-forwards for support services
#
# These services are NOT deployed by Tilt (they come from
# ./bootstrap-orbstack-osx.sh dev support-services). We use local_resource
# with serve_cmd to maintain persistent kubectl port-forward connections.
# ---------------------------------------------------------------------------
local_resource(
    'nats (support)',
    serve_cmd='kubectl port-forward -n {} svc/nats 4222:4222'.format(support_ns),
    labels=['support'],
)
local_resource(
    'temporal-ui (support)',
    serve_cmd='kubectl port-forward -n {} svc/temporal-ui 8233:80'.format(support_ns),
    labels=['support'],
)
local_resource(
    'grafana (support)',
    serve_cmd='kubectl port-forward -n {} svc/grafana 3001:3000'.format(support_ns),
    labels=['support'],
)
local_resource(
    'prometheus (support)',
    serve_cmd='kubectl port-forward -n {} svc/prometheus 9090:9090'.format(support_ns),
    labels=['support'],
)

# ---------------------------------------------------------------------------
# Split service resources
#
# Each split service shares one Docker image and branches on SERVICE_MODE:
#   {svc}-api    — Knative Service (KPA-managed, HTTP endpoints)
#   {svc}-worker — plain Deployment (min-scale=max-scale=1, NATS consumers)
#
# Developer mode: KEDA ScaledObjects no longer exist — all worker
# Deployments run at a fixed replica count of 1 (min-scale=max-scale=1).
# The `k8s_kind('ScaledObject', ...)` registration and all
# `*-worker-scaler` / `*-scaler` k8s_resource lines have been removed.
# ---------------------------------------------------------------------------

# Channel — connector-admin, channel-service, connector-runtime
k8s_resource('connector-admin-api', new_name='connector-admin', labels=['channel'])
k8s_resource('connector-admin-worker', labels=['channel'])
k8s_resource('channel-service-api', new_name='channel-service', labels=['channel'])
k8s_resource('channel-service-worker', labels=['channel'])
k8s_resource('connector-runtime', labels=['channel'])

# Workflow — workflow-service, audit-service, usage-aggregator, workflow-worker
k8s_resource('workflow-service-api', new_name='workflow-service', labels=['workflow'])
k8s_resource('workflow-service-worker', labels=['workflow'])
k8s_resource('audit-service-api', new_name='audit-service', labels=['workflow'])
k8s_resource('audit-service-worker', labels=['workflow'])
k8s_resource('usage-aggregator-api', new_name='usage-aggregator', labels=['workflow'])
k8s_resource('usage-aggregator-worker', labels=['workflow'])
k8s_resource('workflow-worker', labels=['workflow'])

