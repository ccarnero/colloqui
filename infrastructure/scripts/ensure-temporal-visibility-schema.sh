#!/usr/bin/env bash
# ensure-temporal-visibility-schema.sh — idempotent bootstrap of the
# `temporal_visibility` schema on the dedicated visibility CNPG cluster.
#
# Why this exists
# ---------------
# After splitting Temporal's visibility datasource onto its own CNPG
# cluster (see DOCS/RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md +
# post-mortem/POST-MORTEM.md §P0.2), the stock `temporalio/auto-setup`
# image ENTRYPOINT ignores `VISIBILITY_POSTGRES_SEEDS` when running its
# schema migrations: it creates `temporal_visibility` on whatever host
# `POSTGRES_SEEDS` points at, then the Temporal server runtime — which
# DOES honour `VISIBILITY_POSTGRES_SEEDS` — connects to the new
# (empty) cluster and crashes with:
#
#   sql schema version compatibility check failed:
#   unable to read DB schema version keyspace/database: temporal_visibility
#   error: pq: relation "schema_version" does not exist
#
# This script closes the gap. It is idempotent: re-running on a
# fully-migrated visibility cluster is a no-op + fast (~3s).
#
# Usage
# -----
#   ensure-temporal-visibility-schema.sh <namespace>
#
# Reads:
#   - Image tag from `kubectl get deploy/temporal -o jsonpath=...image`
#   - Password from secret/postgres-temporal-visibility-credentials
#
# Side effects:
#   - May launch (and clean up) a short-lived pod `vis-schema-bootstrap`
#     in the target namespace.
#   - Runs `temporal-sql-tool setup-schema` + `update-schema` against
#     postgres-temporal-visibility-rw / database `temporal_visibility`.

set -euo pipefail

NAMESPACE="${1:-}"
if [[ -z "$NAMESPACE" ]]; then
  echo "[ERR] usage: $0 <namespace>" >&2
  exit 1
fi

CLUSTER="${VISIBILITY_CLUSTER:-postgres-temporal-visibility}"
HOST="${VISIBILITY_HOST:-postgres-temporal-visibility-rw}"
DB="${VISIBILITY_DBNAME:-temporal_visibility}"
SECRET="${VISIBILITY_SECRET:-postgres-temporal-visibility-credentials}"
DEPLOY="${TEMPORAL_DEPLOYMENT:-temporal}"
POD_NAME="vis-schema-bootstrap"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ensure-vis-schema]${NC} $*"; }
warn() { echo -e "${YELLOW}[ensure-vis-schema]${NC} $*"; }
err()  { echo -e "${RED}[ensure-vis-schema]${NC} $*" >&2; }

# Cluster + Deployment are prereqs created by the kustomize apply step.
# We tolerate missing pieces silently so callers (bootstrap-minikube /
# bootstrap-orbstack) can invoke this unconditionally without branching
# on whether the split has been rolled out yet.
if ! kubectl -n "$NAMESPACE" get cluster.postgresql.cnpg.io/"$CLUSTER" >/dev/null 2>&1; then
  warn "Cluster ${CLUSTER} not present in ${NAMESPACE}; skipping."
  exit 0
fi
if ! kubectl -n "$NAMESPACE" get deploy/"$DEPLOY" >/dev/null 2>&1; then
  warn "Deployment ${DEPLOY} not present in ${NAMESPACE}; skipping."
  exit 0
fi
if ! kubectl -n "$NAMESPACE" get secret/"$SECRET" >/dev/null 2>&1; then
  err "Secret ${SECRET} not present in ${NAMESPACE} — visibility split is half-applied."
  exit 1
fi

# Wait briefly for the CNPG cluster to become Ready; the initdb job
# creates the database itself, so the connectivity probe below would
# spin forever otherwise. 300s mirrors the wait already in the
# bootstrap scripts.
log "Waiting for cluster.postgresql.cnpg.io/${CLUSTER} Ready (max 300s)..."
if ! kubectl -n "$NAMESPACE" wait \
  cluster.postgresql.cnpg.io/"$CLUSTER" \
  --for=condition=Ready --timeout=300s >/dev/null 2>&1; then
  err "Cluster ${CLUSTER} did not reach Ready within 300s."
  exit 1
fi

# Idempotency probe: if schema_version already exists with a curr_version
# value, treat the cluster as bootstrapped and exit fast.
SCHEMA_PROBE_OUTPUT="$(kubectl -n "$NAMESPACE" exec "${CLUSTER}-1" -c postgres -- \
  psql -U postgres -d "$DB" -tAc \
  "SELECT curr_version FROM schema_version WHERE db_name = '${DB}';" \
  2>/dev/null || true)"

if [[ -n "$SCHEMA_PROBE_OUTPUT" ]] && [[ "$SCHEMA_PROBE_OUTPUT" != *"ERROR"* ]]; then
  log "schema_version already populated on ${HOST}/${DB} (curr_version=${SCHEMA_PROBE_OUTPUT}); skipping."
  exit 0
fi

log "schema_version missing on ${HOST}/${DB} — bootstrapping..."

# Resolve the auto-setup image tag from the live Deployment so the
# migration uses the EXACT same temporal-sql-tool + bundled schemas
# version the server is going to run against. Avoids drift.
AUTO_SETUP_IMAGE="$(kubectl -n "$NAMESPACE" get deploy/"$DEPLOY" \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="temporal")].image}')"
if [[ -z "$AUTO_SETUP_IMAGE" ]]; then
  err "Could not resolve auto-setup image from deploy/${DEPLOY}."
  exit 1
fi
log "Using image ${AUTO_SETUP_IMAGE} for the bootstrap pod."

PASSWORD="$(kubectl -n "$NAMESPACE" get secret "$SECRET" \
  -o jsonpath='{.data.password}' | base64 -d)"

# Best-effort cleanup of a previous failed run (idempotency).
kubectl -n "$NAMESPACE" delete pod "$POD_NAME" --ignore-not-found --wait=true \
  >/dev/null 2>&1 || true

log "Launching ${POD_NAME} pod to run setup-schema + update-schema..."
kubectl -n "$NAMESPACE" run "$POD_NAME" \
  --image="$AUTO_SETUP_IMAGE" --restart=Never \
  --env="SQL_PLUGIN=postgres12" \
  --env="SQL_HOST=${HOST}" \
  --env="SQL_PORT=5432" \
  --env="SQL_USER=temporal" \
  --env="SQL_PASSWORD=${PASSWORD}" \
  --command -- sh -c "
    set -e
    temporal-sql-tool --db ${DB} setup-schema -v 0.0
    temporal-sql-tool --db ${DB} update-schema \
      -d /etc/temporal/schema/postgresql/v12/visibility/versioned
    echo BOOTSTRAP_OK
  " >/dev/null

# Wait for pod to reach a terminal state. `kubectl wait
# --for=jsonpath='{.status.phase}'` is the closest match without
# polling manually.
if ! kubectl -n "$NAMESPACE" wait --for=jsonpath='{.status.phase}'=Succeeded \
  pod/"$POD_NAME" --timeout=180s >/dev/null 2>&1; then
  err "${POD_NAME} did not succeed within 180s. Logs:"
  kubectl -n "$NAMESPACE" logs "$POD_NAME" --tail=80 >&2 || true
  kubectl -n "$NAMESPACE" delete pod "$POD_NAME" --ignore-not-found --wait=false \
    >/dev/null 2>&1 || true
  exit 1
fi

log "Schema bootstrap complete. Cleaning up ${POD_NAME}..."
kubectl -n "$NAMESPACE" delete pod "$POD_NAME" --ignore-not-found --wait=false \
  >/dev/null 2>&1 || true

# Final sanity probe.
FINAL_VER="$(kubectl -n "$NAMESPACE" exec "${CLUSTER}-1" -c postgres -- \
  psql -U postgres -d "$DB" -tAc \
  "SELECT curr_version FROM schema_version WHERE db_name = '${DB}';" \
  2>/dev/null | tr -d '[:space:]' || true)"

if [[ -z "$FINAL_VER" ]]; then
  err "Post-bootstrap probe found no schema_version row. Something is off."
  exit 1
fi
log "OK: ${HOST}/${DB} schema_version.curr_version=${FINAL_VER}"

# Best-effort cleanup of an orphan `temporal_visibility` left on the
# DEFAULT cluster by auto-setup running pre-split (the script wrote the
# visibility schema to postgres-temporal-rw too). Dropping it frees
# disk and makes the split state observable via `\l`. Failures are
# tolerated — the orphan is harmless once Temporal is pointed at the
# new cluster.
DEFAULT_CLUSTER="${DEFAULT_TEMPORAL_CLUSTER:-postgres-temporal}"
if kubectl -n "$NAMESPACE" get cluster.postgresql.cnpg.io/"$DEFAULT_CLUSTER" \
  >/dev/null 2>&1; then
  ORPHAN_EXISTS="$(kubectl -n "$NAMESPACE" exec "${DEFAULT_CLUSTER}-1" -c postgres -- \
    psql -U postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB}';" \
    2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$ORPHAN_EXISTS" == "1" ]]; then
    warn "Orphan ${DB} found on ${DEFAULT_CLUSTER}; dropping (auto-setup wrote it pre-split)."
    kubectl -n "$NAMESPACE" exec "${DEFAULT_CLUSTER}-1" -c postgres -- \
      psql -U postgres -c "DROP DATABASE IF EXISTS ${DB};" >/dev/null 2>&1 || \
      warn "DROP DATABASE failed (database might be in use). Skipping."
  fi
fi
