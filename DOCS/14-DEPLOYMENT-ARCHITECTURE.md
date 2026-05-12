# Kubernetes Deployment Architecture

How the platform services are deployed using Kustomize, KEDA scaling, and per-environment overlays.

## Overview

The platform uses **Kustomize** (not Helm) for Kubernetes configuration management. The architecture separates:

1. **Base manifests** (`knative/services/base/`) — Canonical resource definitions
2. **Overlays** (`knative/services/overlays/`) — Environment-specific patches
3. **Components** (`knative/services/overlays/_components/`) — Shared policies

This design enables:
- Single source of truth (base)
- Environment-specific customization (overlays)
- Reusable patterns (components)
- Minimal duplication

---

## Directory Structure

```
knative/services/
├── base/
│   ├── kustomization.yaml              # Aggregates all base resources
│   ├── http-adapter.yaml               # Plain Deployment (KEDA scaler)
│   ├── workflow-service-api.yaml       # Knative Service
│   ├── workflow-service-worker.yaml    # Plain Deployment (orchestrator)
│   ├── workflow-worker.yaml            # Legacy Temporal worker
│   ├── adapter-service-api.yaml        # Knative Service
│   ├── adapter-service-worker.yaml     # Plain Deployment
│   ├── [other services...]
│   └── scaledobjects/
│       ├── http-adapter.yaml           # KEDA ScaledObject
│       ├── workflow-service-worker.yaml
│       ├── workflow-worker.yaml
│       └── [other scalers...]
│
└── overlays/
    ├── local/
    │   ├── dev/
    │   │   ├── kustomization.yaml      # Combines base + local patches
    │   │   ├── env-patches.yaml        # Image tags, env vars, replicas
    │   │   ├── keda-min-replicas.yaml  # Min replicas override
    │   │   └── keda-scale-to-zero.yaml # Scale-to-zero config
    │   ├── qa/
    │   ├── staging/
    │   └── production/
    │
    ├── cloud/
    │   ├── dev/
    │   ├── qa/
    │   ├── staging/
    │   └── production/
    │
    └── _components/
        ├── scale-to-zero-non-prod/
        │   ├── keda-scale-to-zero.yaml
        │   └── knative-scale-to-zero.yaml
        └── scale-to-zero-staging/
            ├── keda-scale-to-zero.yaml
            └── knative-scale-to-zero.yaml
```

---

## Base Manifests

### Knative Service vs Plain Deployment Choice

| Resource | Used For | Why |
|----------|----------|-----|
| **Knative Service** | API servers (REST endpoints) | Automatic scale-to-zero, request-based autoscaling, revision management |
| **Plain Deployment + KEDA** | Workers (background jobs, event processing) | Pull-based workload scaling (task queue depth, event stream lag) |

### HTTP Adapter Deployment

**File**: `base/http-adapter.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: http-adapter
  labels:
    app: http-adapter
spec:
  replicas: 1  # Overridden by KEDA
  selector:
    matchLabels:
      app: http-adapter
  template:
    metadata:
      labels:
        app: http-adapter
    spec:
      containers:
      - name: http-adapter
        image: dev.local/http-adapter:latest  # Overridden by overlay
        ports:
        - containerPort: 3000
        env:
        - name: TEMPORAL_ADDRESS
          value: temporal:7233
        - name: TEMPORAL_NAMESPACE
          value: default
        - name: HTTP_ADAPTER_TASK_QUEUE
          value: http-adapter
        - name: ADAPTER_SERVICE_URL
          value: http://adapter-service:3000
        - name: REDIS_HOST
          value: redis
        livenessProbe:
          httpGet:
            path: /
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
```

**Why Plain Deployment?**
- Temporal uses **pull-based** task distribution (workers pull tasks from broker)
- Knative Service uses **push-based** request routing (load balancer distributes requests)
- Pull-based workloads need different scaling signals (task queue depth, not request rate)
- KEDA's Temporal scaler monitors queue depth and adjusts replicas accordingly

### Workflow Service API (Knative Service)

**File**: `base/workflow-service-api.yaml`

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: workflow-service-api
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "5"
    spec:
      containers:
      - name: workflow-service
        image: dev.local/workflow-service:latest
        env:
        - name: SERVICE_MODE
          value: api
        - name: PORT
          value: "3000"
        - name: TEMPORAL_ADDRESS
          value: temporal:7233
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
```

**Why Knative Service?**
- **REST API**: Serves HTTP requests from clients
- **Request-based autoscaling**: KPA (Knative Pod Autoscaler) scales based on request concurrency
- **Scale-to-zero**: Knative automatically scales down to zero replicas when idle (in non-prod)
- **Revision management**: Automatic traffic splitting, canary deployments

### Workflow Service Worker (Plain Deployment)

**File**: `base/workflow-service-worker.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workflow-service-worker
spec:
  replicas: 1  # Overridden by KEDA
  template:
    spec:
      containers:
      - name: workflow-service
        image: dev.local/workflow-service:latest
        env:
        - name: SERVICE_MODE
          value: worker
        - name: TEMPORAL_ADDRESS
          value: temporal:7233
        - name: WORKFLOW_ORCHESTRATOR_TASK_QUEUE
          value: workflow-orchestrator
```

**Why Plain Deployment + KEDA?**
- **Orchestrator worker**: Pulls tasks from `workflow-orchestrator` queue
- **KEDA Scaler**: Monitors queue depth and adjusts replicas (1-3 typical)
- **Independent from API**: API server and worker scale independently

### KEDA ScaledObject (Temporal Scaler)

**File**: `base/scaledobjects/http-adapter.yaml`

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: http-adapter-scaler
spec:
  scaleTargetRef:
    name: http-adapter
  minReplicaCount: 1        # Min replicas (never scale below)
  maxReplicaCount: 20       # Max replicas (never scale above)
  cooldownPeriod: 300       # Wait 300s before scale-down
  triggers:
  - type: temporalio
    metadata:
      serverAddress: temporal:7233
      taskQueue: http-adapter
      threshold: "10"       # Scale up when queue > 10 tasks per replica
```

**Scaling Logic**:
- **Queue depth 0-10**: 1 replica (idle or light load)
- **Queue depth 10-50**: 2-5 replicas (ramp up)
- **Queue depth 50+**: 5-20 replicas (high throughput)
- **Cooldown**: Wait 300s after last action before attempting scale-down

---

## Overlay Pattern

Each environment (dev, qa, staging, production) has an overlay that patches the base:

### Local Dev Overlay

**File**: `overlays/local/dev/kustomization.yaml`

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

# Include base resources
bases:
- ../../../base

# Patch specific resources
patchesStrategicMerge:
- env-patches.yaml          # Image tags, env vars, replicas
- keda-min-replicas.yaml    # Min replicas override

# Include components (shared policies)
components:
- ../../../overlays/_components/scale-to-zero-non-prod

# Namespace
namespace: default
```

**File**: `overlays/local/dev/env-patches.yaml`

This patches all service deployments with environment-specific values:

```yaml
# http-adapter patches
apiVersion: apps/v1
kind: Deployment
metadata:
  name: http-adapter
spec:
  template:
    spec:
      containers:
      - name: http-adapter
        image: dev.local/http-adapter:local  # Local image
        env:
        - name: TEMPORAL_ADDRESS
          value: temporal.default.svc.cluster.local:7233
        - name: LOG_LEVEL
          value: debug        # Dev: verbose logging
---
# workflow-service-api patches
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: workflow-service-api
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "5"
    spec:
      containers:
      - name: workflow-service
        image: dev.local/workflow-service:local
---
# workflow-service-worker patches
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workflow-service-worker
spec:
  template:
    spec:
      containers:
      - name: workflow-service
        image: dev.local/workflow-service:local
```

### Local Staging Overlay

**File**: `overlays/local/staging/env-patches.yaml`

```yaml
# Higher concurrency, strict resource limits
apiVersion: apps/v1
kind: Deployment
metadata:
  name: http-adapter
spec:
  template:
    spec:
      containers:
      - name: http-adapter
        image: registry.example.com/http-adapter:v1.2.3  # Tagged image
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        env:
        - name: LOG_LEVEL
          value: info         # Staging: normal logging
---
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: workflow-service-api
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "2"    # Min 2 for HA
        autoscaling.knative.dev/maxScale: "20"   # Higher max
```

### Cloud Production Overlay

**File**: `overlays/cloud/production/env-patches.yaml`

```yaml
# High availability, strict timeouts, versioned images
apiVersion: apps/v1
kind: Deployment
metadata:
  name: http-adapter
spec:
  replicas: 3                 # Override KEDA min
  template:
    spec:
      affinity:
        podAntiAffinity:      # Spread across nodes
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - http-adapter
              topologyKey: kubernetes.io/hostname
      containers:
      - name: http-adapter
        image: gcr.io/yoizen/http-adapter:v1.2.3@sha256:abc123...  # Pinned digest
        resources:
          requests:
            memory: "512Mi"
            cpu: "1000m"
          limits:
            memory: "1Gi"
            cpu: "2000m"
        env:
        - name: LOG_LEVEL
          value: warn         # Prod: less verbose
        - name: TEMPORAL_ADDRESS
          value: temporal.platform.svc.cluster.local:7233
```

---

## Shared Components

### Scale-to-Zero (Dev/QA)

**File**: `_components/scale-to-zero-non-prod/keda-scale-to-zero.yaml`

Applied to dev and qa environments:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: http-adapter-scaler
spec:
  minReplicaCount: 0        # Allow scale-to-zero
  idlePeriod: 300           # 5 minutes idle before scale-down
  cooldownPeriod: 60        # 1 minute between scale-down attempts
```

**File**: `_components/scale-to-zero-non-prod/knative-scale-to-zero.yaml`

Applied to Knative Services in dev and qa:

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: workflow-service-api
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"   # Scale to zero
        autoscaling.knative.dev/scaleDownPeriod: "300"
```

### Scale-to-Zero Staging

**File**: `_components/scale-to-zero-staging/keda-scale-to-zero.yaml`

More conservative than dev/qa:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: http-adapter-scaler
spec:
  minReplicaCount: 1        # Min 1 replica (no scale-to-zero)
  cooldownPeriod: 300       # Longer cooldown to prevent flapping
```

---

## Deployment Workflow

### 1. Local Development (`local/dev`)

```bash
# Apply base + dev overlays
kubectl apply -k knative/services/overlays/local/dev/

# Result:
# - http-adapter Deployment (1 replica, KEDA scale-to-zero enabled)
# - workflow-service-api Knative Service (1 replica, scale-to-zero)
# - workflow-service-worker Deployment (1 replica, KEDA)
# - All using dev.local/* images
# - Debug logging enabled
```

### 2. Staging (`local/staging`)

```bash
# Apply base + staging overlays
kubectl apply -k knative/services/overlays/local/staging/

# Result:
# - http-adapter Deployment (min 1, max 10 replicas)
# - workflow-service-api Knative Service (min 2, max 20)
# - Higher resource limits
# - Normal logging
# - No scale-to-zero (min replicas ≥ 1)
```

### 3. Production (`cloud/production`)

```bash
# Apply base + cloud production overlays
kubectl apply -k knative/services/overlays/cloud/production/

# Result:
# - http-adapter Deployment (3+ replicas, pod anti-affinity)
# - workflow-service-api Knative Service (min 2, max 50)
# - Pinned image digests (immutable)
# - High resource limits
# - Strict logging (warn level)
# - No scale-to-zero
```

---

## Adding a New Service

### Step 1: Create Base Manifest

**File**: `base/my-service.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: my-service
        image: dev.local/my-service:latest
        env:
        - name: PORT
          value: "3000"
        ports:
        - containerPort: 3000
```

### Step 2: Create KEDA ScaledObject (if applicable)

**File**: `base/scaledobjects/my-service.yaml`

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: my-service-scaler
spec:
  scaleTargetRef:
    name: my-service
  minReplicaCount: 1
  maxReplicaCount: 5
  triggers:
  - type: temporalio
    metadata:
      serverAddress: temporal:7233
      taskQueue: my-task-queue
```

### Step 3: Add to Base Kustomization

**File**: `base/kustomization.yaml`

```yaml
resources:
- my-service.yaml
- scaledobjects/my-service.yaml
```

### Step 4: Add to Environment Overlays

**File**: `overlays/local/dev/env-patches.yaml`

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  template:
    spec:
      containers:
      - name: my-service
        image: dev.local/my-service:local
        env:
        - name: LOG_LEVEL
          value: debug
```

---

## Troubleshooting

### Services Not Scaling

```bash
# Check KEDA ScaledObject status
kubectl get scaledobjects

# Check KEDA operator logs
kubectl logs -n keda deployment/keda-operator

# Check Temporal connectivity
kubectl exec -it deployment/http-adapter -- \
  curl http://temporal:7233/health
```

### Pod Not Ready

```bash
# Check pod status
kubectl get pods -l app=http-adapter

# Describe pod for events
kubectl describe pod <pod-name>

# Check logs
kubectl logs <pod-name>

# Check liveness/readiness probes
kubectl get pod <pod-name> -o yaml | grep -A5 livenessProbe
```

### Environment Variable Not Applied

```bash
# Verify patch was applied
kubectl get deployment http-adapter -o yaml | grep -A20 env:

# Check overlay kustomization.yaml
cat overlays/local/dev/kustomization.yaml

# Reapply overlay
kubectl apply -k knative/services/overlays/local/dev/
```

---

## Best Practices

### 1. Always Use Overlays

Never apply base directly to production. Always use environment overlays to ensure proper tagging and configuration.

```bash
# ❌ DON'T
kubectl apply -f knative/services/base/

# ✅ DO
kubectl apply -k knative/services/overlays/local/dev/
```

### 2. Pin Image Digests in Production

Use full image digest in production to ensure immutability:

```yaml
# ❌ Development (tag OK)
image: dev.local/http-adapter:latest

# ✅ Production (digest required)
image: gcr.io/yoizen/http-adapter:v1.2.3@sha256:abc123def456...
```

### 3. Resource Requests/Limits

Always define resource requests and limits:

```yaml
resources:
  requests:
    memory: "256Mi"      # Guaranteed
    cpu: "100m"
  limits:
    memory: "512Mi"      # Maximum
    cpu: "500m"
```

### 4. Health Probes

Define both liveness and readiness probes:

```yaml
livenessProbe:          # Restart if unhealthy
  httpGet:
    path: /
    port: 3000
  initialDelaySeconds: 10

readinessProbe:         # Remove from LB if not ready
  httpGet:
    path: /
    port: 3000
  initialDelaySeconds: 5
```

### 5. Anti-Affinity in Production

Spread pods across nodes for high availability:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
          - key: app
            operator: In
            values:
            - http-adapter
        topologyKey: kubernetes.io/hostname
```

---

## Further Reading

- [KEDA Temporal Scaler Documentation](https://keda.sh/docs/scalers/temporal/)
- [Knative Service Documentation](https://knative.dev/docs/serving/)
- [Kustomize User Guide](https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/)
- [Kubernetes Deployment Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
