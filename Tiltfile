# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ENV = os.getenv('TILT_ENV', 'dev')
INFRA_NS = 'support-services-' + ENV
PLATFORM_NS = 'platform-services-' + ENV
KNATIVE_VERSION = 'v1.17.0'
KOURIER_VERSION = 'v1.17.0'

allow_k8s_contexts('yoizen-arch')
update_settings(max_parallel_updates=3)

# ---------------------------------------------------------------------------
# Knative bootstrap (idempotent — skipped when CRDs already exist)
# ---------------------------------------------------------------------------
knative_crd = str(local(
    'kubectl get crd services.serving.knative.dev -o name 2>/dev/null || true',
    quiet=True,
)).strip()

if not knative_crd:
    local('kubectl apply -f https://github.com/knative/serving/releases/download/knative-{v}/serving-crds.yaml'.format(v=KNATIVE_VERSION))
    local('kubectl apply -f https://github.com/knative/serving/releases/download/knative-{v}/serving-core.yaml'.format(v=KNATIVE_VERSION))
    local('kubectl wait deployment --all --namespace knative-serving --for=condition=Available --timeout=300s')
    local('kubectl apply -f https://github.com/knative/net-kourier/releases/download/knative-{v}/kourier.yaml'.format(v=KOURIER_VERSION))
    local('kubectl wait deployment --all --namespace kourier-system --for=condition=Available --timeout=180s')
    local("""kubectl patch configmap/config-network \
      --namespace knative-serving --type merge \
      --patch '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}'""")

# Knative config applied on every run (idempotent patches)
local("""kubectl patch configmap/config-deployment \
  --namespace knative-serving --type merge \
  --patch '{"data":{"registries-skipping-tag-resolving":"dev.local"}}'""", quiet=True)
minikube_ip = str(local('minikube ip -p yoizen-arch', quiet=True)).strip()
local("kubectl patch configmap/config-domain --namespace knative-serving --type merge --patch '{\"data\":{\"" + minikube_ip + '.sslip.io":""}}\'' , quiet=True)

# Teach Tilt how to inject images into Knative Service CRDs
k8s_kind(
    'Service',
    api_version='serving.knative.dev/v1',
    image_json_path='{.spec.template.spec.containers[*].image}',
)

# ---------------------------------------------------------------------------
# Namespaces
# ---------------------------------------------------------------------------
k8s_yaml(blob("""
apiVersion: v1
kind: Namespace
metadata:
  name: {infra_ns}
  labels:
    app.kubernetes.io/part-of: yoizen-arch
    yoizen.io/environment: {env}
---
apiVersion: v1
kind: Namespace
metadata:
  name: {platform_ns}
  labels:
    app.kubernetes.io/part-of: yoizen-arch
    yoizen.io/environment: {env}
""".format(env=ENV, infra_ns=INFRA_NS, platform_ns=PLATFORM_NS)))

# ---------------------------------------------------------------------------
# Infrastructure (NATS, Redis, PostgreSQL, Temporal)
# ---------------------------------------------------------------------------
k8s_yaml(kustomize('infrastructure/overlays/local/' + ENV))

k8s_resource('nats', labels=['infrastructure'])
k8s_resource('redis', labels=['infrastructure'])
k8s_resource('postgres', labels=['infrastructure'])
k8s_resource('temporal', labels=['infrastructure'], resource_deps=['postgres'])

# ---------------------------------------------------------------------------
# Knative Serving config & RBAC
# ---------------------------------------------------------------------------
k8s_yaml(kustomize('knative/serving'))
k8s_yaml(kustomize('knative/services/rbac'))

# ---------------------------------------------------------------------------
# Platform services (Knative) — render kustomize, patch workflow entry points
# ---------------------------------------------------------------------------
rendered = local(
    'kubectl kustomize knative/services/overlays/local/' + ENV,
    quiet=True,
)
k8s_yaml(blob(str(rendered)))

# ---------------------------------------------------------------------------
# Dev Dockerfile template (single-stage, bun --watch for hot-reload)
# ---------------------------------------------------------------------------
DEV_DOCKERFILE = """FROM oven/bun:1.3-alpine
WORKDIR /app
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
COPY --chown=1001:1001 packages/shared ./packages/shared
COPY services/{svc}/package.json ./services/{svc}/
WORKDIR /app/services/{svc}
RUN bun install
USER 1001:1001
COPY --chown=1001:1001 services/{svc}/src ./src
COPY --chown=1001:1001 services/{svc}/tsconfig.json ./
EXPOSE 3000
CMD ["bun", "run", "--watch", "src/main.ts"]
"""

# ---------------------------------------------------------------------------
# Standard NestJS services
# ---------------------------------------------------------------------------
STANDARD_SERVICES = [
    'api-gateway',
    'auth-service',
    'audit-service',
    'cache-service',
    'event-processor',
    'metrics-service',
    'registry-service',
    'scheduler-service',
    'tenant-service',
    'webhook-service',
]

for svc in STANDARD_SERVICES:
    docker_build(
        'dev.local/' + svc,
        '.',
        dockerfile_contents=DEV_DOCKERFILE.format(svc=svc),
        only=['packages/shared', 'services/' + svc],
        live_update=[
            fall_back_on(['services/' + svc + '/package.json']),
            sync('services/' + svc + '/src', '/app/services/' + svc + '/src'),
            sync('packages/shared/src', '/app/packages/shared/src'),
        ],
    )

# ---------------------------------------------------------------------------
# workflow-service (debian for Temporal glibc; compiled JS, image rebuild on change)
# Layer order optimized: user creation cached before source copy
# ---------------------------------------------------------------------------
docker_build(
    'dev.local/workflow-service',
    '.',
    dockerfile_contents="""FROM oven/bun:1.3-debian
WORKDIR /app
COPY packages/shared ./packages/shared
COPY services/workflow-service/package.json ./services/workflow-service/
WORKDIR /app/services/workflow-service
RUN bun install
RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /bin/sh app && chown -R 1001:1001 /app/services/workflow-service
USER 1001:1001
COPY services/workflow-service/src ./src
COPY services/workflow-service/tsconfig.json ./
RUN bun run build
EXPOSE 3000
CMD ["sh", "-c", "exec bun run ${ENTRYPOINT:-dist/main.js}"]
""",
    only=['packages/shared', 'services/workflow-service'],
)

# ---------------------------------------------------------------------------
# workflow-http-worker (debian for Temporal glibc; compiled JS, image rebuild on change)
# ---------------------------------------------------------------------------
docker_build(
    'dev.local/workflow-http-worker',
    '.',
    dockerfile_contents="""FROM oven/bun:1.3-debian
WORKDIR /app
COPY packages/shared ./packages/shared
COPY services/workflow-http-worker/package.json ./services/workflow-http-worker/
WORKDIR /app/services/workflow-http-worker
RUN bun install
RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /bin/sh app && chown -R 1001:1001 /app/services/workflow-http-worker
USER 1001:1001
COPY services/workflow-http-worker/src ./src
COPY services/workflow-http-worker/tsconfig.json ./
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "dist/worker.js"]
""",
    only=['packages/shared', 'services/workflow-http-worker'],
)

# ---------------------------------------------------------------------------
# Resource labels, dependencies & port-forwards
# ---------------------------------------------------------------------------
RESOURCE_DEPS = {
    'api-gateway':          ['nats', 'redis'],
    'auth-service':         ['redis', 'postgres'],
    'audit-service':        ['nats', 'postgres'],
    'cache-service':        ['redis'],
    'event-processor':      ['nats', 'redis'],
    'metrics-service':      ['nats', 'postgres'],
    'registry-service':     ['postgres'],
    'scheduler-service':    ['postgres'],
    'tenant-service':       ['postgres'],
    'webhook-service':      ['nats'],
    'workflow-api':         ['nats', 'temporal'],
    'workflow-worker':      ['nats', 'temporal'],
    'workflow-http-worker': ['temporal'],
}

for name, deps in RESOURCE_DEPS.items():
    if name == 'api-gateway':
        k8s_resource(name, labels=['platform'], resource_deps=deps, port_forwards='3000:3000')
    else:
        k8s_resource(name, labels=['platform'], resource_deps=deps)
