# Runbook — Splitting Temporal's `visibility` datasource onto its own Postgres

**Audience:** Platform / SRE operators.
**Status:** Historical. This describes the one-time visibility split applied
on 2026-05-22. **Developer mode has reverted** to a single `postgres-temporal`
cluster where both `temporal` and `temporal_visibility` databases live together.
The `postgres-temporal-visibility` CNPG cluster manifest still exists but is
not active in developer mode (see `DOCS/runbooks/temporal.md` §3.2).

**Why this exists:** The 2026-05-22 stress run (post-mortem deleted from repo)
showed `executions_visibility` autovacuum + insert pressure was starving the
hot `executions` write path on the shared `postgres-temporal` CNPG cluster.
Splitting `temporal_visibility` onto its own CNPG cluster (`postgres-temporal-visibility`)
removes that contention.

## What changed in code

| File | Change |
|------|--------|
| [`infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml`](../../infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml) | New CNPG cluster (2 instances in base, 1 in dev overlays). |
| [`infrastructure/base/postgres/secret.yaml`](../../infrastructure/base/postgres/secret.yaml) | New `postgres-temporal-visibility-credentials` Secret (mirrors `postgres-temporal-credentials`). |
| [`infrastructure/base/postgres/kustomization.yaml`](../../infrastructure/base/postgres/kustomization.yaml) | Registered the new cluster manifest. |
| `infrastructure/base/temporal/deployment-autosetup.yaml` | Added `VISIBILITY_POSTGRES_SEEDS` / `VISIBILITY_POSTGRES_USER` / `VISIBILITY_POSTGRES_PWD` / `VISIBILITY_DB_PORT` env vars. In developer mode these point to the same `postgres-temporal-rw` as the default datastore. |
| `infrastructure/overlays/local/local-base/patches/postgres-temporal-visibility-resources.yaml` | Dev-sized overlay for local. |
| `infrastructure/overlays/orbstack/orbstack-base/patches/postgres-temporal-visibility.yaml` | Dev-sized overlay for orbstack. |
| `infrastructure/scripts/ensure-temporal-visibility-schema.sh` (deleted from repo) | Idempotent helper that runs `temporal-sql-tool setup-schema` + `update-schema` directly against `postgres-temporal-visibility-rw`, working around an `auto-setup` bug (see "Known issue" below). |
| [`bootstrap-orbstack-osx.sh`](../../bootstrap-orbstack-osx.sh) | Wait for the new CNPG cluster in parallel with the others, then invoke `ensure-temporal-visibility-schema.sh` **before** the Temporal rollout. Means a fresh `./bootstrap-*.sh dev support-services` Just Works — no manual step. |

## Known issue — `temporalio/auto-setup` ignores `VISIBILITY_POSTGRES_SEEDS`

The stock `temporalio/auto-setup:1.28.4` ENTRYPOINT runs `setup-schema` for both `DBNAME` and `VISIBILITY_DBNAME` against **the same host** (`POSTGRES_SEEDS`) — it does not honour `VISIBILITY_POSTGRES_SEEDS` for the migration phase, even though the Temporal Server runtime *does*. Symptom on first boot after the split:

```text
sql schema version compatibility check failed:
unable to read DB schema version keyspace/database: temporal_visibility
error: pq: relation "schema_version" does not exist
```

Auto-setup happily reports `Schema setup complete` because it wrote the visibility schema to `postgres-temporal-rw`; then the server boots, connects to `postgres-temporal-visibility-rw` (correct host), finds an empty DB, and crashloops.

### Automatic fix (preferred)

Both bootstrap scripts now invoke `infrastructure/scripts/ensure-temporal-visibility-schema.sh` (deleted from repo) automatically. It:

1. Waits for `cluster/postgres-temporal-visibility` to be Ready.
2. Probes `schema_version.curr_version` on `postgres-temporal-visibility-rw/temporal_visibility`. If populated, exits in ~1 s.
3. Otherwise launches a short-lived pod (using the same `temporalio/auto-setup` image tag the live `Deployment/temporal` is pinned to, so schemas never drift) and runs:
   ```sh
   temporal-sql-tool --db temporal_visibility setup-schema -v 0.0
   temporal-sql-tool --db temporal_visibility update-schema \
     -d /etc/temporal/schema/postgresql/v12/visibility/versioned
   ```
4. Drops the orphan `temporal_visibility` from the *default* cluster (best-effort) so disk + `\l` stay clean.

### Manual fix (one-off / non-bootstrap environments)

Run the same script directly (idempotent — safe to re-run):

```bash
./infrastructure/scripts/ensure-temporal-visibility-schema.sh support-services-<env>
```

Or, if you're not on a machine with the repo checked out, inline:

```bash
NS=support-services-dev
PASSWORD="$(kubectl -n "$NS" get secret postgres-temporal-visibility-credentials \
  -o jsonpath='{.data.password}' | base64 -d)"
IMAGE="$(kubectl -n "$NS" get deploy/temporal \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="temporal")].image}')"

kubectl -n "$NS" run vis-schema-bootstrap --image="$IMAGE" --restart=Never \
  --env=SQL_PLUGIN=postgres12 \
  --env=SQL_HOST=postgres-temporal-visibility-rw \
  --env=SQL_PORT=5432 \
  --env=SQL_USER=temporal \
  --env=SQL_PASSWORD="$PASSWORD" \
  --command -- sh -c '
    temporal-sql-tool --db temporal_visibility setup-schema -v 0.0
    temporal-sql-tool --db temporal_visibility update-schema \
      -d /etc/temporal/schema/postgresql/v12/visibility/versioned
  '
kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Succeeded \
  pod/vis-schema-bootstrap --timeout=180s
kubectl -n "$NS" delete pod vis-schema-bootstrap

# Optional cleanup: drop the orphan visibility DB on the default cluster
kubectl -n "$NS" exec postgres-temporal-1 -c postgres -- \
  psql -U postgres -c "DROP DATABASE IF EXISTS temporal_visibility;"

# Restart Temporal so it stops crashlooping
kubectl -n "$NS" delete pod -l app.kubernetes.io/name=temporal
```

> The pod uses the SAME image tag the live `Deployment/temporal` is running so the bundled `schema/postgresql/v12/visibility/versioned` migrations match what the server expects.

## Two paths to cut over

### Path A — Cold cutover (dev / disposable environments)

Use this on `local`, `orbstack`, ephemeral preview environments, or any cluster where Temporal history can be discarded.

**Easiest path: re-run the bootstrap script.** `bootstrap-orbstack-osx.sh` already includes the wait for `cluster/postgres-temporal-visibility` and the call to `ensure-temporal-visibility-schema.sh`, so this is enough:

```bash
./bootstrap-orbstack-osx.sh dev support-services
```

If you want to do it by hand:

```bash
# 1. Stop the temporal Deployment so no new writes hit the old visibility DB.
kubectl scale deploy/temporal --replicas=0

# 2. Apply the new manifests. CNPG will provision the new cluster
#    in parallel with the existing one.
kustomize build infrastructure/overlays/local | kubectl apply -f -

# 3. Wait for the new cluster to be Ready and the new Secret to exist.
kubectl wait --for=condition=Ready cluster/postgres-temporal-visibility --timeout=5m
kubectl get secret postgres-temporal-visibility-credentials -o jsonpath='{.metadata.name}'

# 4. Bootstrap the visibility schema on the new cluster (works around
#    the auto-setup bug — see "Known issue" section above).
./infrastructure/scripts/ensure-temporal-visibility-schema.sh support-services-dev

# 5. Bring temporal back. The server connects to
#    postgres-temporal-visibility-rw and finds schema_version already
#    populated, so it boots cleanly.
kubectl scale deploy/temporal --replicas=2

# 6. Watch the boot:
kubectl logs -l app.kubernetes.io/name=temporal -f
#    After ~10-30 s the pods are Ready.
```

**Blast radius:** All in-flight workflow visibility (`WorkflowList`, `WorkflowQuery`) results are lost. Active workflow *executions* continue uninterrupted because they live in the `executions` table on the unchanged `postgres-temporal` cluster.

### Path B — Hot migration (any environment with non-disposable visibility history)

Use this when `temporal_visibility` already has data you cannot afford to lose (audit logs, dashboards reading from advanced visibility, etc.).

> Path B carries `pg_dump` over to the new cluster so `schema_version` lands as a side effect of `pg_restore`. You do NOT need `ensure-temporal-visibility-schema.sh` in this path — but running it afterwards is still safe (it'll detect a populated schema and skip in ~1s).

```bash
# 1. Apply the new manifests first so CNPG provisions the visibility
#    cluster in parallel. Temporal is still pointed at the old DB.
kustomize build infrastructure/overlays/<env> | kubectl apply -f -
kubectl wait --for=condition=Ready cluster/postgres-temporal-visibility --timeout=10m

# 2. Capture a baseline snapshot timestamp (used in step 5 for sanity).
SNAPSHOT_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 3. pg_dump the OLD visibility DB. This is online and does not block
#    writes. With ~50 indexes the bulk of the dump time is rebuilding
#    indexes on the new side.
kubectl exec -it postgres-temporal-1 -- \
  pg_dump -U postgres -d temporal_visibility \
  --format=custom --no-owner --no-acl --jobs=4 \
  --file=/var/lib/postgresql/data/visibility.dump

# 4. Copy the dump locally then push it into the new cluster.
kubectl cp postgres-temporal-1:/var/lib/postgresql/data/visibility.dump /tmp/visibility.dump
kubectl cp /tmp/visibility.dump postgres-temporal-visibility-1:/var/lib/postgresql/data/visibility.dump
kubectl exec -it postgres-temporal-visibility-1 -- \
  pg_restore -U postgres -d temporal_visibility --jobs=4 --no-owner --no-acl \
  /var/lib/postgresql/data/visibility.dump

# 5. Stop temporal, do a final incremental dump to catch the delta
#    written during pg_dump+restore, then flip the env vars in one apply.
#    For most workloads the delta is < 30s of inserts; copy only rows
#    where `last_modified > $SNAPSHOT_TS` if your schema has that column,
#    otherwise accept the gap (visibility is best-effort by design).
kubectl scale deploy/temporal --replicas=0

# 6. Apply the deployment patch that adds VISIBILITY_POSTGRES_* env vars.
#    The new manifests in this repo already include them.
kubectl rollout restart deploy/temporal
kubectl rollout status deploy/temporal --timeout=5m

# 7. Smoke-test: list workflows and confirm visibility entries appear.
tctl --address temporal.platform-services.svc.cluster.local:7233 \
     wf list --pagesize 5

# 8. Once happy, free the disk on the OLD cluster.
kubectl exec -it postgres-temporal-1 -- \
  psql -U postgres -c "DROP DATABASE temporal_visibility;"
```

**Blast radius:** ~1-3 minutes of read-only visibility (the API still answers but lists may be stale). `executions` writes continue throughout.

## Rollback

To revert (point Temporal back at the shared cluster):

1. Remove the `VISIBILITY_POSTGRES_*` env block from `infrastructure/base/temporal/deployment-autosetup.yaml` and set `VISIBILITY_POSTGRES_SEEDS` back to `postgres-temporal-rw` (same as `POSTGRES_SEEDS`).
2. `kustomize build … | kubectl apply -f -`.
3. `kubectl rollout restart deploy/temporal`. `auto-setup` will recreate `temporal_visibility` on the original cluster from schema (path A blast radius — visibility history is lost on the way back).
4. Optionally `kubectl delete cluster/postgres-temporal-visibility` to free the resources.

## Verification

| Signal | Where | What you expect |
|--------|-------|-----------------|
| Temporal connects to both DBs | `kubectl logs -l app.kubernetes.io/name=temporal` | `"Schema setup complete"` once per DB on boot. |
| Visibility writes land on the new cluster | `kubectl exec -it postgres-temporal-visibility-1 -- psql -U postgres -d temporal_visibility -c "SELECT count(*) FROM executions_visibility;"` | Count grows as you start workflows. |
| Old cluster no longer has visibility load | `kubectl exec -it postgres-temporal-1 -- psql -U postgres -c "\l+"` | `temporal_visibility` not present (after step 4 / 8). |
| Post-mortem regression gate | `tests/stress/` was deleted from repo — re-validate manually via workflow load against the split cluster | `postgres-temporal.log` shows no `57014 canceling statement due to user request`; duplicate-key INSERT rate stays flat. |
