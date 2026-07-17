# RUNBOOK — Temporal HA Migration (auto-setup → split services)

> **Status: Historical.** This doc captures the ONE-TIME migration from
> `temporalio/auto-setup` to a split-role HA topology applied on
> 2026-05-22. **The 4-role HA topology is no longer the active configuration.**
> The project reverted to a single `temporalio/auto-setup` Deployment (developer
> mode). For DAY-2 operations of the current cluster, see
> [`DOCS/runbooks/temporal.md`](../temporal.md).
>
> Companions for the migration context:
> - [`DOCS/runbooks/temporal-visibility-split.md`](./temporal-visibility-split.md) — visibility datastore split (also historical)
> - `post-mortem/POST-MORTEM.md` — stress run that motivated both (file deleted from repo)

## 1. What changed

Pre-migration Temporal ran a single `Deployment/temporal` using the
`temporalio/auto-setup:1.28.4` image — the four services (`frontend`,
`history`, `matching`, `worker`) bundled in **one process**, replicated
twice. That image is explicitly documented by upstream as a
dev/testing convenience: schema bootstrap runs on every pod boot and
the four roles share CPU + memory + the same shard ring.

Post-migration the cluster runs:

| Resource | Kind | Replicas (base) | Image | Role |
|---|---|---|---|---|
| `temporal-frontend` | Deployment | 2 | `temporalio/server:1.28.4` | `SERVICES=frontend` |
| `temporal-history` | Deployment | 2 | `temporalio/server:1.28.4` | `SERVICES=history` |
| `temporal-matching` | Deployment | 2 | `temporalio/server:1.28.4` | `SERVICES=matching` |
| `temporal-worker` | Deployment | 2 | `temporalio/server:1.28.4` | `SERVICES=worker` (internal) |
| `temporal-schema-setup-1-28-4` | Job | 1 | `temporalio/admin-tools:1.28.4-tctl-1.18.4-cli-1.6.2` | one-shot schema |
| `temporal-namespace-bootstrap-1-28-4` | Job | 1 | `temporalio/admin-tools:1.28.4-tctl-1.18.4-cli-1.6.2` | registers `default` namespace |
| `temporal` | Service | — | — | frontend gRPC (unchanged name) |
| `temporal-internode` | Service (headless) | — | — | per-pod DNS for ringpop |
| `temporal-{role}-metrics` | Service (headless) | — | — | per-role Prometheus targets |

Manifests live under
[`infrastructure/base/temporal/`](../../infrastructure/base/temporal/);
overlays under
[`infrastructure/overlays/{local,orbstack}/local-base/patches/postgres-temporal-resources.yaml`](../../infrastructure/overlays/local/local-base/patches/postgres-temporal-resources.yaml)
shrink the per-role sizing.

## 2. Why

Direct quotes from the post-mortem that this migration resolves:

- §10.2 (ring imbalance): "When Postgres restarted, all 16 history
  shards re-assigned to a single Temporal pod (16/0 split). One pod
  was at 1248m CPU + 12 890 `context deadline exceeded` in 5 min
  while the sibling was at 489m CPU with 222 errors — same workload."
  With roles split, only `temporal-history` pods participate in the
  shard ring — `temporal-frontend`/`-matching`/`-worker` can roll
  independently without churning shards.
- §10.1 (`VISIBILITY_POSTGRES_SEEDS` ignored by auto-setup): the
  schema bootstrap moved to a dedicated Job that explicitly targets
  both `postgres-temporal-rw` and `postgres-temporal-visibility-rw`.
  No more drift between what auto-setup wrote and what the server
  reads.
- §3.2 (no role isolation): frontend gRPC stalls under load because
  the history service in the same process is monopolising CPU
  serving `UpdateWorkflowExecution`. With roles split each one
  scales independently.

## 3. Cold cutover (dev/local — clean slate)

For overlays where workflow state is disposable (today: all of them
— the post-mortem already documented the visibility split as a cold
cutover). Procedure:

```bash
NS=support-services-dev   # adjust per env

# 1. Tear down the old single Deployment.
kubectl -n $NS delete deploy/temporal --ignore-not-found

# 2. (Optional but recommended) wipe workflow state to avoid stuck
#    workflows on the new ring. The new manifests' rbac-schema-wait
#    ServiceAccount + Job handle their own readiness; only the
#    workflow data is "stale" relative to the new topology.
./scripts/reset/purge-temporal.sh --namespace=$NS --skip-restart --yes

# 3. Apply the new manifests. Kustomize creates:
#    - ServiceAccount + Role + RoleBinding (rbac-schema-wait)
#    - ConfigMap/temporal-server-config (config_template.yaml)
#    - ConfigMap/temporal-dynamic-config (production-sql.yaml)
#    - Job/temporal-schema-setup-1-28-4
#    - Service/{temporal, temporal-internode, temporal-*-metrics}
#    - Deployment/{temporal-frontend,history,matching,worker}
kubectl apply -k infrastructure/overlays/local/dev

# 4. Wait for schema Job. Idempotent — fast if DBs already populated.
kubectl -n $NS wait --for=condition=complete \
  job/temporal-schema-setup-1-28-4 --timeout=300s

# 5. Wait for the 4 role Deployments in parallel.
for role in frontend history matching worker; do
  kubectl -n $NS rollout status deploy/temporal-${role} \
    --timeout=300s &
done
wait

# 5b. Wait for the namespace bootstrap Job. Restores 'default'
#     namespace parity with the auto-setup behaviour — required
#     for workflow-worker / connector-runtime SDK clients that
#     default to that namespace and crash on
#     `Namespace default is not found.` otherwise.
kubectl -n $NS wait --for=condition=complete \
  job/temporal-namespace-bootstrap-1-28-4 --timeout=7m

# 6. Smoke check cluster health + ring (the address that any
#    client uses — same as the workflow-service config).
kubectl -n $NS exec deploy/temporal-frontend -c temporal -- \
  tctl --address temporal:7233 cluster health
# Expect: `temporal.api.workflowservice.v1.WorkflowService: SERVING`

# Membership ring inspection (lists all hosts per role). Note: the
# CLI subcommand differs between tctl versions; this works on the
# tctl bundled with temporalio/server 1.28.4.
kubectl -n $NS exec deploy/temporal-frontend -c temporal -- \
  tctl --address temporal:7233 admin membership list-gossip 2>/dev/null \
  || kubectl -n $NS get pods -l app.kubernetes.io/name=temporal \
       -L temporal.io/role,statefulset.kubernetes.io/pod-name
# Either way, expect 8 hosts: 2 per role.
```

The bootstrap script (`bootstrap-orbstack-osx.sh`)
already do steps 3-5 for fresh environments — operators only need
to run steps 1-2 (and only step 1 on the very first cluster apply).

## 4. Hot cutover (envs with real workflow data)

Not required today since the cold path handles every overlay we
ship, but documented for future production use:

1. Drain new workflow starts. The two ways:
   - HTTP/gRPC level: route `StartWorkflowExecution` through a
     feature flag in `workflow-service` and toggle it off. Tighter
     control but requires app-side support.
   - Infra level: `kubectl -n $NS scale deploy/api-gateway --replicas=0`
     for the time of the cutover. Coarser but works without code.
2. Snapshot the current cluster: `kubectl get all -n $NS -o yaml
   > pre-migration.yaml` plus a `pg_dump -Fc -d temporal -d
   temporal_visibility` on both CNPG primaries. Recovery anchor.
3. Apply the new manifests on top of the old Deployment:
   `kubectl apply -k infrastructure/overlays/...`. The old
   `Deployment/temporal` is left alone by the apply (kustomize
   has no reference to it); coexists during the rollout.
4. Wait for the Job and the 4 new Deployments (same commands as
   §3 steps 4-5).
5. Validate via `tctl` that the new ring sees the same active
   workflows the old `Deployment/temporal` was serving:
   ```bash
   kubectl -n $NS exec deploy/temporal-frontend -- \
     tctl --address temporal:7233 workflow list --query \
     "ExecutionStatus='Running'" --print_all | head
   ```
6. Cut traffic: `kubectl -n $NS delete deploy/temporal`. The
   `temporal` Service selector already routes only to pods with
   `temporal.io/role=frontend`, so client traffic flips
   atomically when the old Deployment's pods terminate.
7. Undrain new workflow starts (reverse of step 1).

## 5. Known hazards + mitigations

### 5.1 Shard claim race (post-§10.2 of post-mortem + 2026-05-23 stress)

When both `temporal-history` pods boot simultaneously after a
Postgres restart, the first to register in `cluster_membership`
can claim all 16 shards. The second pod stays idle until a host-
churn event because **Temporal's ringpop only rebalances shards on
host LEAVE, never on host JOIN**.

Under sustained stress the imbalance is self-perpetuating: the
loaded pod's per-shard `range_id` CAS updates always win against
the idle pod's acquire attempts, because the loaded pod is in the
hot path and its `range_id` cache is warm. The idle pod loses every
acquisition race and stays idle.

**Observed blast radius** (2026-05-23 stress §3, 10k workflows over
~3.5 min @ 500rps):

- 1 history pod served all 16 shards → 14,585 `Update workflow
  execution operation failed` errors with `context deadline exceeded`
- Other history pod logged **0** errors (completely idle)
- Workflow + activity tasks accumulated 4+ min schedule-to-start
  while SDK workers used only 15% of their slots (100/600)
- 57,338 workflows TimedOut (54% of total), with `executionDuration`
  values of 2,200-4,100 seconds vs configured `WORKFLOW_DEFAULT_TIMEOUT_MS = 600s`
- Postgres itself was healthy throughout (0 errors, 42 checkpoints
  only) — the bottleneck was history compute saturation, not
  persistence

### Defence in depth: 3 layers

The platform has three layers of protection against shard imbalance,
each handling a different failure mode:

| Layer | What it covers | Mechanism |
|---|---|---|
| **L1 — Bootstrap rolling-restart** | Fresh cluster boot, every `kubectl apply -k` | `bootstrap-{minikube,orbstack}.sh` ends `apply_infrastructure()` with `kubectl rollout restart deployment/temporal-history` |
| **L2 — Auto-healer CronJob** | Post-bootstrap re-skew (Postgres restart, pod restart under load, anything else) | `cronjob-shard-rebalancer.yaml` polls Prometheus every 2 min, restarts history if alert is `firing` |
| **L3 — Alert + manual fallback** | L2 disabled or broken | `TemporalHistoryShardImbalance` Prometheus alert + manual procedure (see below) |

#### L1 — Bootstrap rolling-restart

[`bootstrap-orbstack-osx.sh`](../../bootstrap-orbstack-osx.sh) does a
`kubectl rollout restart deployment/temporal-history` at the end of
`apply_infrastructure()` (after the schema + namespace bootstrap
Jobs complete). This forces a churn that distributes shards via the
hash-based assignment: each pod leaves once, the survivor takes all
16 shards, and on rejoin the new pod acquires its hash-assigned half
under low post-restart load (where CAS races are winnable).

This handles the **fresh-cluster** case deterministically. Zero
runtime overhead — runs once per deploy.

#### L2 — Auto-healer CronJob

`infrastructure/base/temporal/cronjob-shard-rebalancer.yaml` (removed with the HA teardown)
runs every 2 min:

1. Queries the in-cluster Prometheus `/api/v1/alerts` endpoint.
2. If the `TemporalHistoryShardImbalance` alert is in state
   `firing` (not just `pending`), executes
   `kubectl rollout restart deployment/temporal-history` +
   `rollout status --timeout=300s`.
3. Otherwise: logs `no action` and exits in <1s.

**Why this is not a dumb cron**: the decision lives in the alert
(`for: 5m` sustained + `total_rate > 10` ops/s guard), not in the
CronJob. The CronJob is a thin executor that only acts on
high-confidence alert state. If the alert never fires, the CronJob
costs ~5s of CPU per run.

**Worst-case time-to-remediate** (alert start → balanced cluster):

- Alert pending window: up to 5 min (`for: 5m`)
- CronJob tick: up to 2 min (`schedule: */2 * * * *`)
- `rollout restart` + status: ~30-90s
- **Total: ~7-8 min** from imbalance start

**Natural debounce**: after a successful restart, the alert clears
within ~30s as the persistence_latency_count rate rebalances. The
alert cannot fire again for at least another 5 min (the `for: 5m`
clause). So the minimum time between two auto-restarts is ~7 min —
well below any runaway restart-storm threshold.

**Concurrency control**: `concurrencyPolicy: Forbid` on the
CronJob ensures only one rollout is in flight at any time. If a
previous run is mid-rollout when the next tick fires, the tick is
skipped — the next one (2 min later) will catch up.

**Observability**: every run logs to its Job pod, retained for
~3 successful + 3 failed runs (`successfulJobsHistoryLimit: 3`,
`failedJobsHistoryLimit: 3`). To see recent decisions:

```bash
kubectl -n support-services-dev logs -l \
  app.kubernetes.io/component=shard-rebalancer --tail=200 --prefix
```

Expected steady-state output: `[rebalancer] 'TemporalHistoryShardImbalance' is inactive — no action.` (every 2 min).

When the alert is firing: `[rebalancer] '...' is FIRING (1 instance(s)).` followed by the rollout output.

**Disabling auto-remediation**: scale the CronJob's suspend flag
if you need to temporarily disable it (e.g., during a manual
shard migration):

```bash
kubectl patch cronjob/temporal-shard-rebalancer \
  -p '{"spec":{"suspend":true}}'
# Re-enable:
kubectl patch cronjob/temporal-shard-rebalancer \
  -p '{"spec":{"suspend":false}}'
```

#### L3 — Manual fallback

Use only if L2 is suspended or broken (CronJob pod can't reach
Prometheus, image pull failures, RBAC misconfig, etc.):

```bash
# 1. Confirm the imbalance via direct metric query:
kubectl -n support-services-dev exec deploy/prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum%20by%20(instance)%20(rate(persistence_latency_count%7Btemporal_role%3D%22history%22%7D%5B5m%5D))' \
  | python3 -c "
import json,sys
for r in json.load(sys.stdin)['data']['result']:
  print(f\"  {r['metric'].get('instance','?')}: {float(r['value'][1]):.0f} ops/s\")
"
# Expect to see one pod at ~all the load, the other ≈0.

# 2. Force a rolling restart — this is the SAME thing L1 and L2
#    do, just replayable on demand:
kubectl rollout restart deployment/temporal-history -n support-services-dev
kubectl rollout status   deployment/temporal-history -n support-services-dev --timeout=300s

# 3. Verify the new balance (~2 min after restart, after load picks
#    up again):
kubectl -n support-services-dev exec deploy/prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum%20by%20(instance)%20(rate(persistence_latency_count%7Btemporal_role%3D%22history%22%7D%5B5m%5D))'
# Expect both pods within ~30% of each other.
```

### 5.2 `temporal-schema-setup-<version>` Job ageing

The Job is named with the image tag suffix (`-1-28-4`). On a
Temporal version bump, the OLD Job's `ttlSecondsAfterFinished: 600`
garbage-collects it after 10 minutes. If you're rolling back to an
older version within the same window, the apply tries to re-create
a Job with the same name + different spec and **kubernetes rejects
the spec change as immutable**.

**Mitigation:** delete the stale Job before reapplying:
```bash
kubectl -n $NS delete job/temporal-schema-setup-1-28-4 --ignore-not-found
kubectl apply -k infrastructure/overlays/...
```

### 5.3 `dockerize` template malformation

The `temporalio/server` image entrypoint runs
`dockerize -template /etc/temporal/config/config_template.yaml:/etc/temporal/config/docker.yaml`.
A typo in
`infrastructure/base/temporal/configmap-docker.yaml` (removed with the HA teardown)
surfaces as a hard pod crash with `template: config_template.yaml:N: ...`
in the container logs.

**Mitigation:** dry-run the template locally before applying:
```bash
docker run --rm \
  -v "$(pwd)/infrastructure/base/temporal/configmap-docker.yaml:/tmp/cm.yaml" \
  -e SERVICES=frontend \
  -e POSTGRES_SEEDS=fake \
  -e POSTGRES_USER=fake \
  -e POSTGRES_PWD=fake \
  -e VISIBILITY_POSTGRES_SEEDS=fake \
  -e VISIBILITY_POSTGRES_USER=fake \
  -e VISIBILITY_POSTGRES_PWD=fake \
  -e BIND_ON_IP=0.0.0.0 \
  -e PROMETHEUS_ENDPOINT=0.0.0.0:9090 \
  --entrypoint sh \
  temporalio/server:1.28.4 \
  -c 'awk "/config_template.yaml: \\|/{p=1;next} /^[a-z]/{p=0} p" /tmp/cm.yaml > /etc/temporal/config/config_template.yaml && dockerize -template /etc/temporal/config/config_template.yaml:/tmp/out.yaml && cat /tmp/out.yaml'
```

### 5.4 Worker role does NOT open its declared gRPC port

The four roles all declare `services.<role>.rpc.grpcPort` in
`configmap-docker.yaml` (removed with the HA teardown)
but the internal `worker` role is the odd one out: its `:7239` is
**reserved but never bound**. The worker is a pure SDK client — it
polls system task queues (`temporal-sys-tq-scanner-taskqueue-0`,
etc.) against the frontend. It only opens:

- Membership: ringpop on `:6939`
- Metrics: prometheus exporter on `:9090`

Consequence: `tcpSocket: { port: 7239 }` probes will ALWAYS fail
with `connection refused`. The
[`deployment-worker.yaml` (removed with the HA teardown)
manifest uses `httpGet: { path: /metrics, port: metrics }` instead,
which double-duties as a liveness signal (process up) and metrics-
exporter-up signal. The other 3 roles keep their TCP probes on
their respective gRPC ports (those DO bind).

### 5.5 Client compatibility

`Service/temporal` keeps its name and port (`7233`). The selector
changed to require `temporal.io/role=frontend` so traffic only
reaches the frontend pods. Clients that hardcoded the Service
name (every consumer: `workflow-service`, `workflow-worker`,
`connector-runtime`, `temporal-ui`) need **no env-var change**.

If a future client picks up the per-role internal Service names
(`temporal-internode`, `temporal-*-metrics`), it MUST go through
the `temporal` Service for the gRPC frontend.

## 6. Validation gates

In addition to the gates in
`post-mortem/POST-MORTEM.md` (file deleted from repo) §10.6:

| Signal | Where | Target |
|---|---|---|
| Member count per role | `tctl admin cluster membership list` | exactly N per role (N=base replicas) |
| Shard ownership balance | `tctl admin cluster membership list --role history` then cross-reference with `host:port` | ±2 of even split (8/8 with 2 history pods, 16 shards) |
| Frontend CPU < history CPU under stress | `kubectl top pod -l app.kubernetes.io/name=temporal` | proves the roles are decoupled — previously they moved together |
| `temporal_role` label present | `curl http://temporal:9090/metrics \| grep temporal_role` | every metric carries the new label |
| Schema Job idempotent | `kubectl apply -k ...` (re-run) | no new Job created (name pinned to imageTag) |

## 7. Rollback

If the new topology behaves badly:

```bash
NS=support-services-dev

# 1. Restore the legacy single-Deployment manifests from git.
git checkout <pre-migration-sha> -- \
  infrastructure/base/temporal/ \
  infrastructure/overlays/local/local-base/patches/postgres-temporal-resources.yaml \
  infrastructure/overlays/orbstack/orbstack-base/patches/postgres-temporal.yaml \
  infrastructure/scripts/ensure-temporal-visibility-schema.sh \
  bootstrap-orbstack-osx.sh scripts/reset/purge-temporal.sh

# 2. Drop the new resources, leaving Postgres + secrets alone.
kubectl -n $NS delete deploy/temporal-frontend deploy/temporal-history \
  deploy/temporal-matching deploy/temporal-worker --ignore-not-found
kubectl -n $NS delete svc/temporal-internode --ignore-not-found
kubectl -n $NS delete svc/temporal-frontend-metrics svc/temporal-history-metrics \
  svc/temporal-matching-metrics svc/temporal-worker-metrics --ignore-not-found
kubectl -n $NS delete job/temporal-schema-setup-1-28-4 --ignore-not-found
kubectl -n $NS delete job/temporal-namespace-bootstrap-1-28-4 --ignore-not-found
kubectl -n $NS delete cm/temporal-server-config --ignore-not-found
kubectl -n $NS delete rolebinding/temporal-schema-wait \
  role/temporal-schema-wait sa/temporal-schema-wait --ignore-not-found

# 3. Re-apply the (now restored) legacy manifests.
kubectl apply -k infrastructure/overlays/local/dev

# 4. Run the legacy visibility-schema helper (now back from git).
#    Note: infrastructure/scripts/ was deleted; restore this file from
#    the pre-migration git commit referenced in step 1.
./infrastructure/scripts/ensure-temporal-visibility-schema.sh $NS

# 5. Wait for the legacy Deployment.
kubectl -n $NS rollout status deploy/temporal --timeout=300s
```

Postgres state survives because we never drop the CNPG clusters in
this flow. The legacy `auto-setup` will detect the schema is
already at the right version and proceed straight to running the
server.
