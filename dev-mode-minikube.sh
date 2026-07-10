#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# dev-mode-minikube.sh — source-mounted developer mode (minikube / Linux)
# =============================================================================
#
# Minikube (docker driver) variant of dev-mode.sh. Flips a running service to
# live-reload mode: swaps its image for oven/bun:1.3.14-slim, mounts the repo
# root from the host and the pre-installed node_modules from a shared PVC.
#
# Difference vs the OrbStack dev-mode.sh:
#   - OrbStack exposes the host repo to the cluster node via VirtioFS, so
#     `bun --watch` (inotify) reloads on host edits. Minikube's docker driver
#     exposes the repo over a 9p mount (`minikube mount`); 9p propagates file
#     DATA but NOT inotify events, so `bun --watch` never reloads. This script
#     therefore (a) starts/stops a `minikube mount` of the repo into the node,
#     and (b) runs scripts/dev-poll-reload.sh (mtime polling) instead of
#     `bun --watch`. Reload latency ~1-2s.
#   - REPO_PATH is derived from the script location, so it works against any
#     clone path on the developer's Linux machine.
#
# Usage:
#   ./dev-mode-minikube.sh deps [--force]    # ensure PVC, populate node_modules
#   ./dev-mode-minikube.sh mount             # start the repo 9p mount (manual)
#   ./dev-mode-minikube.sh unmount           # stop the repo 9p mount
#   ./dev-mode-minikube.sh <service> on      # flip service to dev mode (auto-mounts)
#   ./dev-mode-minikube.sh <service> off [--overlay postgres-dev|mongo-dev]
#                                            # restore declared state
#   ./dev-mode-minikube.sh <service> status  # show dev-mode state for one service
#   ./dev-mode-minikube.sh status            # show dev-mode state for all services
#
# Supported services:
#   auth-service, tenant-service, cache-service, proxy-service,
#   registry-service, audit-service, channel-service, connector-admin,
#   usage-aggregator-service, workflow-service, connector-runtime,
#   api-gateway, agent-memory-service, agent-ai-service,
#   agent-scheduler-service, agent-admin-service, ai-agent-gateway
#
# Not supported:
#   admin-console — Angular SPA; stays on image flow.
#
# Prerequisites:
#   - minikube cluster, docker driver (kubectl context: minikube)
#   - minikube on PATH (used for `minikube mount`)
#   - jq on PATH (required for JSON patch operations)
#   - kubectl on PATH
#   - Cluster bootstrapped with ./bootstrap-minikube-linux.sh
#   - Run ./dev-mode-minikube.sh deps before first use of `on`
#   - The `minikube mount` process must stay alive while services are in dev
#     mode (this script backgrounds it and tracks its PID).
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source service list
source "${SCRIPT_DIR}/services.conf"

# ── Constants ────────────────────────────────────────────────────────────────

NS="platform-services-dev"
# Repo root = this script's directory, so the script is portable to any clone
# path on the developer's machine (no hardcoded host path).
REPO_PATH="$SCRIPT_DIR"
# slim (glibc) is required because @temporalio/core-bridge ships glibc-only binaries
# and the deps PVC is installed on a glibc image (node:24-slim); matches production
# runtime stages.
DEV_IMAGE="oven/bun:1.3.14-slim"
DEPS_PVC="dev-mode-deps"
DEV_ANNOTATION="yoizen.io/dev-mode"
STATE_CONFIGMAP="dev-mode-state"

# ── Minikube source mount (9p) ────────────────────────────────────────────────
# minikube profile and the node-side path where the repo is 9p-mounted. We mount
# at the SAME absolute path as the host so the hostPath patch stays identical to
# the OrbStack flow. The background `minikube mount` PID/log are tracked here.
MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-minikube}"
MOUNT_NODE_PATH="$REPO_PATH"
MOUNT_PIDFILE="/tmp/dev-mode-minikube-mount.pid"
MOUNT_LOG="/tmp/dev-mode-minikube-mount.log"
# In-pod reloader (mtime polling; 9p has no inotify). Lives under the mounted
# repo, visible at /app inside the dev container.
POLL_RELOADER="/app/scripts/dev-poll-reload.sh"

# Container security context values (bun user = uid/gid 1000)
CTX_RUN_AS_USER="1000"
CTX_RUN_AS_GROUP="1000"
CTX_ALLOW_PRIV_ESC="false"
CTX_POD_FS_GROUP="1000"

# Dev mode relaxed resources
RES_REQ_CPU="100m"
RES_REQ_MEM="256Mi"
RES_LIM_CPU="2"
RES_LIM_MEM="1Gi"

# ── Colour helpers (matching rebuild-redeploy.sh / bootstrap style) ──────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }

# ── Preflight checks ─────────────────────────────────────────────────────────

check_deps() {
  local missing=()
  for cmd in kubectl jq minikube; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  if (( ${#missing[@]} )); then
    err "Missing required tools: ${missing[*]}"
    err "Install on Debian/Ubuntu:  sudo apt-get install -y jq"
    err "(yq optional, only for 'off':  sudo snap install yq  |  https://github.com/mikefarah/yq)"
    err "minikube:  https://minikube.sigs.k8s.io/docs/start/"
    exit 1
  fi
}

check_context() {
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" != "$MINIKUBE_PROFILE" ]]; then
    warn "Current kubectl context is '${ctx}', expected '${MINIKUBE_PROFILE}'"
    warn "Switch with: kubectl config use-context ${MINIKUBE_PROFILE}"
    # Non-fatal: allow running against another context intentionally
  fi
}

# ── Minikube source mount (9p) lifecycle ──────────────────────────────────────
#
# The docker-driver node cannot see the host repo unless it is mounted in.
# `minikube mount` runs a 9p server and must stay alive for the mount to work,
# so we background it (nohup) and track its PID in a pidfile. Reads/writes cross
# 9p fine; only inotify does not — hence the polling reloader.

mount_is_running() {
  [[ -f "$MOUNT_PIDFILE" ]] || return 1
  local pid
  pid="$(cat "$MOUNT_PIDFILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_mount() {
  if mount_is_running; then
    log "Source mount already running (pid $(cat "$MOUNT_PIDFILE")): ${REPO_PATH} → node:${MOUNT_NODE_PATH}"
    return 0
  fi
  step "Starting minikube 9p mount: ${REPO_PATH} → node:${MOUNT_NODE_PATH}"
  : >"$MOUNT_LOG"
  nohup minikube -p "$MINIKUBE_PROFILE" mount "${REPO_PATH}:${MOUNT_NODE_PATH}" \
    >"$MOUNT_LOG" 2>&1 &
  echo $! >"$MOUNT_PIDFILE"

  local i
  for (( i = 0; i < 30; i++ )); do
    if grep -q "Successfully mounted" "$MOUNT_LOG" 2>/dev/null; then
      log "Source mount ready (pid $(cat "$MOUNT_PIDFILE"))"
      return 0
    fi
    if ! mount_is_running; then
      err "minikube mount exited early. Log:"; tail -n 20 "$MOUNT_LOG" >&2 || true
      rm -f "$MOUNT_PIDFILE"
      return 1
    fi
    sleep 1
  done
  warn "minikube mount did not confirm 'Successfully mounted' within 30s — continuing."
  warn "  Check: tail -f ${MOUNT_LOG}"
  return 0
}

stop_mount() {
  if ! mount_is_running; then
    log "No source mount running."
    rm -f "$MOUNT_PIDFILE"
    return 0
  fi
  local pid
  pid="$(cat "$MOUNT_PIDFILE")"
  step "Stopping source mount (pid ${pid})"
  kill "$pid" 2>/dev/null || true
  rm -f "$MOUNT_PIDFILE"
  log "Source mount stopped."
}

cmd_mount()   { start_mount; }
cmd_unmount() { stop_mount; }

# ── YAML field extraction ────────────────────────────────────────────────────
#
# cmd_off rebuilds the declared state of an object from the rendered kustomize
# manifest. Each field it cannot read translates into a "remove"/"skip" patch
# op against the live object, so a parser that fails SILENTLY corrupts the
# deployment (e.g. stripping the container command makes the pod boot the
# image's default CMD — the API server — instead of the Temporal worker).
# Hence: yq first, python3+PyYAML as fallback, and a hard preflight abort
# when neither is usable.

have_yaml_tool() {
  command -v yq &>/dev/null && return 0
  command -v python3 &>/dev/null && python3 -c 'import yaml' &>/dev/null && return 0
  return 1
}

require_yaml_tool() {
  if ! have_yaml_tool; then
    err "This command needs 'yq' or python3 with PyYAML to read declared manifests."
    err "Install one of them:  brew install yq   |   pip3 install pyyaml"
    err "Aborting before patching: restoring without a YAML parser would strip"
    err "declared fields (image, command, securityContext, ...) from live objects."
    exit 1
  fi
}

# Reads a single-document YAML manifest on stdin and prints the field at the
# given yq-style path as compact JSON. Prints nothing when the field is absent.
yaml_field_json() {
  local path="$1" out=""
  if command -v yq &>/dev/null; then
    out="$(yq eval -o=json -I=0 "$path" - 2>/dev/null)" || out=""
  else
    out="$(python3 -c "
import sys, yaml, json, re
node = yaml.safe_load(sys.stdin)
for part in re.findall(r'[^.\[\]]+|\[\d+\]', '''$path'''.lstrip('.')):
    if node is None:
        break
    if part.startswith('['):
        idx = int(part[1:-1])
        node = node[idx] if isinstance(node, list) and idx < len(node) else None
    else:
        node = node.get(part) if isinstance(node, dict) else None
print('' if node is None else json.dumps(node))
" 2>/dev/null)" || out=""
  fi
  [[ "$out" == "null" ]] && out=""
  printf '%s' "$out"
}

# ── Service → Kubernetes object mapping ──────────────────────────────────────
#
# Each entry specifies: ksvc targets, deployment targets, service dir under
# services/, and the bun entry point for each target.
#
# Format per service variable:
#   KSVCS="space-separated ksvc names"
#   DEPLOYS="space-separated deployment names"
#   SVC_DIR="directory name under services/"
#   KSVC_CMD="bun --watch <entrypoint>"   (same for all ksvcs of a service)
#   DEPLOY_CMD_<name>="bun --watch <entrypoint>"  (per-deployment override)
#
# This is implemented as a single dispatcher function so per-service
# overrides are one-line changes.

# Returns info for a logical service name.
# Outputs lines:   kind<TAB>object-name<TAB>entry-point<TAB>svc-dir
get_targets() {
  local svc="$1"
  case "$svc" in
    # ── Split services: ksvc *-api + deployment *-worker ──────────────────
    audit-service)
      echo "ksvc	audit-service-api	src/main.ts	audit-service"
      echo "deploy	audit-service-worker	src/main.ts	audit-service"
      ;;
    channel-service)
      echo "ksvc	channel-service-api	src/main.ts	channel-service"
      echo "deploy	channel-service-worker	src/main.ts	channel-service"
      ;;
    connector-admin)
      # NOTE: connector-admin's package.json uses tsx as the dev runner, but
      # bun --watch is expected to work because bun can execute TypeScript
      # directly. If e2e validation later shows bun --watch fails for this
      # service (e.g. tsx-specific module resolution), flip this entry to use
      # a node-based image override and tsx runner.
      echo "ksvc	connector-admin-api	src/main.ts	connector-admin"
      echo "deploy	connector-admin-worker	src/main.ts	connector-admin"
      ;;
    usage-aggregator-service)
      echo "ksvc	usage-aggregator-api	src/main.ts	usage-aggregator-service"
      echo "deploy	usage-aggregator-worker	src/main.ts	usage-aggregator-service"
      ;;
    agent-admin-service)
      echo "ksvc	agent-admin-service	src/main.ts	agent-admin-service"
      echo "deploy	agent-admin-service-worker	src/main.ts	agent-admin-service"
      ;;
    # ── workflow-service: ksvc api + NATS worker + Temporal worker ─────────
    workflow-service)
      echo "ksvc	workflow-service-api	src/main.ts	workflow-service"
      echo "deploy	workflow-service-worker	src/main.ts	workflow-service"
      echo "deploy	workflow-worker	src/temporal/worker.ts	workflow-service"
      ;;
    # ── connector-runtime: deployment only ────────────────────────────────
    connector-runtime)
      echo "deploy	connector-runtime	src/worker.ts	connector-runtime"
      ;;
    # ── tracking-ingester-service: deployment only (worker, no KSVC) ───────
    tracking-ingester-service)
      echo "deploy	tracking-ingester-worker	src/main.ts	tracking-ingester-service"
      ;;
    # ── Single-ksvc services ───────────────────────────────────────────────
    auth-service)           echo "ksvc	auth-service	src/main.ts	auth-service" ;;
    tenant-service)         echo "ksvc	tenant-service	src/main.ts	tenant-service" ;;
    cache-service)          echo "ksvc	cache-service	src/main.ts	cache-service" ;;
    proxy-service)          echo "ksvc	proxy-service	src/main.ts	proxy-service" ;;
    registry-service)       echo "ksvc	registry-service	src/main.ts	registry-service" ;;
    api-gateway)            echo "ksvc	api-gateway	src/main.ts	api-gateway" ;;
    agent-memory-service)   echo "ksvc	agent-memory-service	src/main.ts	agent-memory-service" ;;
    agent-ai-service)       echo "ksvc	agent-ai-service	src/main.ts	agent-ai-service" ;;
    agent-scheduler-service) echo "ksvc	agent-scheduler-service	src/main.ts	agent-scheduler-service" ;;
    ai-agent-gateway)       echo "ksvc	ai-agent-gateway	src/main.ts	ai-agent-gateway" ;;
    # ── Not supported ──────────────────────────────────────────────────────
    admin-console)
      err "admin-console is not supported by dev-mode."
      err "The Angular app builds to static assets; it stays on the image flow."
      err "Use ./rebuild-redeploy.sh admin-console to rebuild the image."
      exit 1
      ;;
    *)
      err "Unknown service: ${svc}"
      err "Run ./dev-mode-minikube.sh status to see supported services."
      exit 1
      ;;
  esac
}

# ── PVC lockfile hash helpers ─────────────────────────────────────────────────

local_lock_sha() {
  shasum -a 256 "${SCRIPT_DIR}/pnpm-lock.yaml" | awk '{print $1}'
}

cluster_lock_sha() {
  kubectl get configmap "$STATE_CONFIGMAP" \
    --namespace "$NS" \
    -o jsonpath='{.data.lockSha}' 2>/dev/null || true
}

warn_if_deps_stale() {
  local local_sha cluster_sha
  local_sha="$(local_lock_sha 2>/dev/null || true)"
  cluster_sha="$(cluster_lock_sha)"
  if [[ -n "$local_sha" && -n "$cluster_sha" && "$local_sha" != "$cluster_sha" ]]; then
    warn "pnpm-lock.yaml has changed since the last deps install."
    warn "node_modules in the PVC may be stale. Run: ./dev-mode-minikube.sh deps"
    warn "  Cluster lock sha: ${cluster_sha}"
    warn "  Local   lock sha: ${local_sha}"
  fi
}

# ── JSON patch builder helpers ────────────────────────────────────────────────
#
# Builds a JSON-pointer patch ops array for switching a container to dev mode.
# Works on both ksvc (spec/template/spec/containers/0) and deployment
# (spec/template/spec/containers/0) — the pod spec path is the same for both.
#
# IMPORTANT: We use --type json (RFC 6902) throughout. We never use --type merge
# on objects containing a containers array because JSON merge patch replaces
# arrays wholesale, wiping existing env vars. Knative CRDs do not support
# strategic merge patch either, so json-patch is the only safe option.

# json_escape_pointer: replace ~ → ~0 then / → ~1 (RFC 6901 JSON pointer)
json_escape_pointer() {
  local s="$1"
  s="${s//\~/~0}"
  s="${s//\//~1}"
  printf '%s' "$s"
}

# Build volumes JSON array for dev mode (source hostPath + deps PVC)
dev_volumes_json() {
  cat <<EOF
[
  {
    "name": "source",
    "hostPath": {
      "path": "${REPO_PATH}",
      "type": "Directory"
    }
  },
  {
    "name": "dev-deps",
    "persistentVolumeClaim": {
      "claimName": "${DEPS_PVC}"
    }
  }
]
EOF
}

# Build volumeMounts JSON array for a given service directory.
# NOTE (minikube): /app (the source) is mounted WRITABLE — unlike the OrbStack
# dev-mode.sh which mounts it readOnly. A fresh clone on the dev box has no
# node_modules dirs, so the container runtime must be able to CREATE the
# /app/**/node_modules mountpoints before the deps PVC is layered on top; a
# readOnly /app makes mountpoint creation fail with "read-only file system".
dev_volume_mounts_json() {
  local svc_dir="$1"
  cat <<EOF
[
  {
    "name": "source",
    "mountPath": "/app",
    "readOnly": false
  },
  {
    "name": "dev-deps",
    "mountPath": "/app/node_modules",
    "subPath": "node_modules"
  },
  {
    "name": "dev-deps",
    "mountPath": "/app/services/${svc_dir}/node_modules",
    "subPath": "services/${svc_dir}/node_modules"
  },
  {
    "name": "dev-deps",
    "mountPath": "/app/packages/shared/node_modules",
    "subPath": "packages/shared/node_modules"
  },
  {
    "name": "dev-deps",
    "mountPath": "/app/packages/database/node_modules",
    "subPath": "packages/database/node_modules"
  },
  {
    "name": "dev-deps",
    "mountPath": "/app/packages/observability/node_modules",
    "subPath": "packages/observability/node_modules"
  }
]
EOF
}

# Build the container securityContext JSON for the dev bun container
dev_security_context_json() {
  cat <<EOF
{
  "runAsNonRoot": false,
  "runAsUser": ${CTX_RUN_AS_USER},
  "runAsGroup": ${CTX_RUN_AS_GROUP},
  "allowPrivilegeEscalation": ${CTX_ALLOW_PRIV_ESC},
  "capabilities": {
    "drop": ["ALL"]
  },
  "seccompProfile": {
    "type": "RuntimeDefault"
  }
}
EOF
}

# Build the resources JSON for dev mode
dev_resources_json() {
  cat <<EOF
{
  "requests": {
    "cpu": "${RES_REQ_CPU}",
    "memory": "${RES_REQ_MEM}"
  },
  "limits": {
    "cpu": "${RES_LIM_CPU}",
    "memory": "${RES_LIM_MEM}"
  }
}
EOF
}

# Emit a single JSON patch op.
# Usage: patch_op <op> <path> <value-json>
patch_op() {
  local op="$1" path="$2" value="$3"
  printf '{"op":"%s","path":"%s","value":%s}' "$op" "$path" "$value"
}

# ── Build patch ops for a target object ──────────────────────────────────────
#
# Inspects the live object, decides add vs replace for each field, and emits
# a complete JSON patch array.

build_patch_ops() {
  local kind="$1"       # "ksvc" or "deploy"
  local name="$2"       # object name
  local entrypoint="$3" # e.g. src/main.ts
  local svc_dir="$4"    # e.g. channel-service

  # All targets use the single DEV_IMAGE (slim/glibc)
  local target_image="$DEV_IMAGE"

  # Fetch live object once
  local obj
  if [[ "$kind" == "ksvc" ]]; then
    obj="$(kubectl get ksvc "$name" --namespace "$NS" -o json 2>/dev/null)" || {
      warn "ksvc/${name} not found in ${NS} — skipping"
      return 1
    }
  else
    obj="$(kubectl get deployment "$name" --namespace "$NS" -o json 2>/dev/null)" || {
      warn "deployment/${name} not found in ${NS} — skipping"
      return 1
    }
  fi

  local ops=()

  # Helper: does a jq path exist (not null) in the object?
  field_exists() { [[ "$(echo "$obj" | jq -r "$1 // empty")" != "" ]]; }

  # ── metadata.annotations ──
  local ann_path
  ann_path="/metadata/annotations"
  if ! field_exists '.metadata.annotations'; then
    ops+=("$(patch_op add "$ann_path" '{}')")
  fi
  local ann_key_ptr
  ann_key_ptr="$(json_escape_pointer "${DEV_ANNOTATION}")"
  ops+=("$(patch_op add "${ann_path}/${ann_key_ptr}" '"true"')")

  # ── spec.template.metadata.annotations (forces new revision / rollout) ──
  local tmpl_ann_path
  if [[ "$kind" == "ksvc" ]]; then
    tmpl_ann_path="/spec/template/metadata/annotations"
  else
    tmpl_ann_path="/spec/template/metadata/annotations"
  fi
  if ! field_exists '.spec.template.metadata.annotations'; then
    ops+=("$(patch_op add "$tmpl_ann_path" '{}')")
  fi
  ops+=("$(patch_op add "${tmpl_ann_path}/${ann_key_ptr}" '"true"')")

  # From here on, all container-level paths are under spec/template/spec
  local base="/spec/template/spec"

  # ── spec.template.spec.securityContext (fsGroup) ──
  local pod_sc_path="${base}/securityContext"
  if ! field_exists '.spec.template.spec.securityContext'; then
    ops+=("$(patch_op add "$pod_sc_path" "{\"fsGroup\":${CTX_POD_FS_GROUP}}")")
  else
    local fg_ptr="${pod_sc_path}/fsGroup"
    if ! field_exists '.spec.template.spec.securityContext.fsGroup'; then
      ops+=("$(patch_op add "$fg_ptr" "${CTX_POD_FS_GROUP}")")
    else
      ops+=("$(patch_op replace "$fg_ptr" "${CTX_POD_FS_GROUP}")")
    fi
  fi

  # ── volumes ──
  local vol_path="${base}/volumes"
  local volumes_json
  volumes_json="$(dev_volumes_json)"
  if ! field_exists '.spec.template.spec.volumes'; then
    ops+=("$(patch_op add "$vol_path" "$volumes_json")")
  else
    ops+=("$(patch_op replace "$vol_path" "$volumes_json")")
  fi

  # Container 0 path
  local c="${base}/containers/0"

  # ── image ──
  ops+=("$(patch_op replace "${c}/image" "\"${target_image}\"")")

  # ── command ──
  # Minikube/9p has no inotify, so we run the polling reloader instead of
  # `bun --watch`. It restarts `bun <entrypoint>` on source mtime change.
  local cmd_json
  cmd_json="$(printf '["sh","%s","%s","%s"]' "$POLL_RELOADER" "$svc_dir" "$entrypoint")"
  if ! field_exists '.spec.template.spec.containers[0].command'; then
    ops+=("$(patch_op add "${c}/command" "$cmd_json")")
  else
    ops+=("$(patch_op replace "${c}/command" "$cmd_json")")
  fi

  # ── workingDir ──
  local workdir="/app/services/${svc_dir}"
  local workdir_json
  workdir_json="\"${workdir}\""
  if ! field_exists '.spec.template.spec.containers[0].workingDir'; then
    ops+=("$(patch_op add "${c}/workingDir" "$workdir_json")")
  else
    ops+=("$(patch_op replace "${c}/workingDir" "$workdir_json")")
  fi

  # ── volumeMounts ──
  local vm_json
  vm_json="$(dev_volume_mounts_json "$svc_dir")"
  if ! field_exists '.spec.template.spec.containers[0].volumeMounts'; then
    ops+=("$(patch_op add "${c}/volumeMounts" "$vm_json")")
  else
    ops+=("$(patch_op replace "${c}/volumeMounts" "$vm_json")")
  fi

  # ── securityContext (container level) ──
  local sc_json
  sc_json="$(dev_security_context_json)"
  if ! field_exists '.spec.template.spec.containers[0].securityContext'; then
    ops+=("$(patch_op add "${c}/securityContext" "$sc_json")")
  else
    ops+=("$(patch_op replace "${c}/securityContext" "$sc_json")")
  fi

  # ── resources ──
  local res_json
  res_json="$(dev_resources_json)"
  if ! field_exists '.spec.template.spec.containers[0].resources'; then
    ops+=("$(patch_op add "${c}/resources" "$res_json")")
  else
    ops+=("$(patch_op replace "${c}/resources" "$res_json")")
  fi

  # ── readinessProbe.failureThreshold: bump to 12 to tolerate cold bun start ──
  if field_exists '.spec.template.spec.containers[0].readinessProbe'; then
    local ft_path="${c}/readinessProbe/failureThreshold"
    if ! field_exists '.spec.template.spec.containers[0].readinessProbe.failureThreshold'; then
      ops+=("$(patch_op add "$ft_path" "12")")
    else
      local current_ft
      current_ft="$(echo "$obj" | jq -r '.spec.template.spec.containers[0].readinessProbe.failureThreshold // 3')"
      if (( current_ft < 12 )); then
        ops+=("$(patch_op replace "$ft_path" "12")")
      fi
    fi
  fi

  # Emit final JSON array
  local joined
  joined="$(printf '%s,' "${ops[@]}")"
  joined="${joined%,}"  # strip trailing comma
  printf '[%s]' "$joined"
}

# ── Wait helpers ──────────────────────────────────────────────────────────────

wait_for_ksvc() {
  local name="$1"
  step "Waiting for ksvc/${name} to become Ready (timeout 180s)..."
  if kubectl wait ksvc/"$name" --namespace "$NS" \
      --for=condition=Ready --timeout=180s 2>/dev/null; then
    log "ksvc/${name} is Ready"
  else
    warn "Timed out waiting for ksvc/${name} — check pods in ${NS}"
    warn "  kubectl get pods -n ${NS} -l app.kubernetes.io/name=${name}"
  fi
}

wait_for_deployment() {
  local name="$1"
  step "Waiting for deployment/${name} to finish rolling out..."
  if kubectl rollout status deployment/"$name" --namespace "$NS" --timeout=180s; then
    log "deployment/${name} is Ready"
  else
    warn "Timed out waiting for deployment/${name} — check pods in ${NS}"
  fi
}

# ── Object annotation check ───────────────────────────────────────────────────

object_is_dev_mode() {
  local kind="$1" name="$2"
  # Escape dots in the annotation key for jsonpath bracket notation (e.g. yoizen.io → yoizen\.io)
  local ann_key_escaped="${DEV_ANNOTATION//./\\.}"
  local ann
  if [[ "$kind" == "ksvc" ]]; then
    ann="$(kubectl get ksvc "$name" --namespace "$NS" \
      -o jsonpath="{.metadata.annotations['${ann_key_escaped}']}" 2>/dev/null || true)"
  else
    ann="$(kubectl get deployment "$name" --namespace "$NS" \
      -o jsonpath="{.metadata.annotations['${ann_key_escaped}']}" 2>/dev/null || true)"
  fi
  [[ "$ann" == "true" ]]
}

# ── Subcommand: deps ──────────────────────────────────────────────────────────

cmd_deps() {
  local force="false"
  while (( $# > 0 )); do
    case "$1" in
      --force) force="true"; shift ;;
      *) err "Unknown option for deps: $1"; usage; exit 1 ;;
    esac
  done

  step "Ensuring PVC ${DEPS_PVC}..."
  kubectl apply -f "${SCRIPT_DIR}/knative/dev-mode/deps-pvc-minikube.yaml"

  # Staleness check
  local local_sha cluster_sha
  local_sha="$(local_lock_sha)"
  cluster_sha="$(cluster_lock_sha)"

  log "Local   pnpm-lock.yaml sha256: ${local_sha}"
  log "Cluster recorded sha256:       ${cluster_sha:-<none>}"

  if [[ "$force" != "true" && -n "$cluster_sha" && "$local_sha" == "$cluster_sha" ]]; then
    log "node_modules in PVC are up to date (sha matches). Use --force to reinstall."
    return 0
  fi

  if [[ "$force" == "true" ]]; then
    log "--force: running install unconditionally"
  else
    log "Lock sha mismatch or no prior install — running deps install Job"
  fi

  # The deps Job mounts the repo source via hostPath; on minikube the node only
  # sees it while `minikube mount` is running, so ensure the mount is up first.
  if ! start_mount; then
    err "Could not start the source mount — aborting deps."
    exit 1
  fi

  step "Creating deps install Job..."
  local job_output
  # Substitute the repo path into the hostPath of the minikube deps Job template.
  job_output="$(sed "s#__REPO_PATH__#${REPO_PATH}#g" \
    "${SCRIPT_DIR}/knative/dev-mode/deps-install-job-minikube.yaml" | kubectl create -f -)"
  local job_name
  job_name="$(printf '%s' "$job_output" | grep -oE 'dev-deps-install-[a-z0-9]+'  | head -n1)"

  if [[ -z "$job_name" ]]; then
    err "Could not parse job name from kubectl create output: ${job_output}"
    exit 1
  fi

  log "Job created: ${job_name}"
  step "Waiting for Job to complete (timeout 900s)..."
  kubectl wait --for=condition=complete "job/${job_name}" \
    --namespace "$NS" \
    --timeout=900s

  log "Job ${job_name} completed. Last log lines:"
  kubectl logs "job/${job_name}" --namespace "$NS" --tail=20 2>/dev/null || true

  # Upsert the state ConfigMap with the new lock sha
  step "Recording lockfile sha in ConfigMap ${STATE_CONFIGMAP}..."
  kubectl create configmap "$STATE_CONFIGMAP" \
    --namespace "$NS" \
    --from-literal="lockSha=${local_sha}" \
    --dry-run=client -o yaml \
    | kubectl apply -f -

  log "deps: node_modules ready, lock sha recorded: ${local_sha}"
}

# ── Subcommand: on ────────────────────────────────────────────────────────────

cmd_on() {
  local svc="$1"

  # Warn if deps might be stale
  warn_if_deps_stale

  # Ensure the host repo is mounted into the node (9p) before patching, so the
  # hostPath source volume resolves. Safe to call repeatedly.
  if ! start_mount; then
    err "Could not start the source mount — aborting 'on' for ${svc}."
    exit 1
  fi

  local targets
  targets="$(get_targets "$svc")"

  while IFS=$'\t' read -r kind name entrypoint svc_dir; do
    [[ -z "$name" ]] && continue

    step "Enabling dev mode on ${kind}/${name} (${svc_dir} → ${entrypoint})"

    if object_is_dev_mode "$kind" "$name"; then
      warn "${kind}/${name} is already in dev mode — re-patching (use 'off' first to fully reset)"
    fi

    local ops
    if ! ops="$(build_patch_ops "$kind" "$name" "$entrypoint" "$svc_dir")"; then
      continue
    fi

    log "Applying JSON patch to ${kind}/${name}..."
    if [[ "$kind" == "ksvc" ]]; then
      kubectl patch ksvc "$name" \
        --namespace "$NS" \
        --type json \
        --patch "$ops"
      wait_for_ksvc "$name"
    else
      kubectl patch deployment "$name" \
        --namespace "$NS" \
        --type json \
        --patch "$ops"
      wait_for_deployment "$name"
    fi

    log "${kind}/${name} is in dev mode. Logs: kubectl logs -f -n ${NS} -l app.kubernetes.io/name=${name}"
  done <<< "$targets"

  echo ""
  log "==============================="
  log " Dev mode ON: ${svc}"
  log "==============================="
  echo ""
  echo "  Edit source files under services/${svc} — polling reloader restarts bun (~1-2s)."
  echo "  Keep the source mount alive (backgrounded; pid in ${MOUNT_PIDFILE})."
  echo "  Logs: kubectl logs -f -n ${NS} -l app.kubernetes.io/name=<target-name>"
  echo "  To restore: ./dev-mode-minikube.sh ${svc} off"
  echo ""
}

# ── Subcommand: off ───────────────────────────────────────────────────────────

cmd_off() {
  local svc="$1"
  local overlay="postgres-dev"

  shift || true
  while (( $# > 0 )); do
    case "$1" in
      --overlay) overlay="${2:-}"; [[ -z "$overlay" ]] && { err "--overlay needs a value"; exit 1; }; shift 2 ;;
      --overlay=*) overlay="${1#*=}"; shift ;;
      *) err "Unknown option: $1"; usage; exit 1 ;;
    esac
  done

  local overlay_path="${SCRIPT_DIR}/knative/services/overlays/local/${overlay}"
  if [[ ! -d "$overlay_path" ]]; then
    err "Overlay path not found: ${overlay_path}"
    err "Valid overlays: postgres-dev, mongo-dev"
    exit 1
  fi

  require_yaml_tool

  local targets
  targets="$(get_targets "$svc")"

  # Render the full overlay once
  step "Rendering overlay: ${overlay_path##*/}"
  local rendered
  rendered="$(kubectl kustomize "$overlay_path")"

  while IFS=$'\t' read -r kind name entrypoint svc_dir; do
    [[ -z "$name" ]] && continue

    if ! object_is_dev_mode "$kind" "$name"; then
      log "${kind}/${name} is not in dev mode — nothing to do"
      continue
    fi

    step "Restoring ${kind}/${name} from overlay ${overlay}..."

    # Extract the single object from the kustomize output.
    # yq is preferred; fall back to a Python3 approach if available; otherwise awk.
    local obj_yaml=""

    if [[ "$kind" == "ksvc" ]]; then
      local k8s_kind="Service"
    else
      local k8s_kind="Deployment"
    fi

    if command -v yq &>/dev/null; then
      obj_yaml="$(printf '%s' "$rendered" \
        | yq eval "select(.kind == \"${k8s_kind}\" and .metadata.name == \"${name}\")" -)"
    elif command -v python3 &>/dev/null; then
      obj_yaml="$(printf '%s' "$rendered" | python3 -c "
import sys, yaml
docs = list(yaml.safe_load_all(sys.stdin))
for d in docs:
    if d and d.get('kind') == '${k8s_kind}' and d.get('metadata', {}).get('name') == '${name}':
        print(yaml.dump(d, default_flow_style=False))
        break
" 2>/dev/null || true)"
    fi

    if [[ -z "$obj_yaml" ]]; then
      # Fallback: split on '---' and grep for the right document
      obj_yaml="$(printf '%s' "$rendered" \
        | awk -v kind="${k8s_kind}" -v name="${name}" '
          /^---/ { if (block != "" && found) { print block }; block=""; found=0 }
          /kind:/ && $0 ~ kind { maybe_kind=1 }
          /name:/ && $0 ~ name && maybe_kind { found=1 }
          { block = block $0 "\n" }
          END { if (block != "" && found) { print block } }
        ')"
    fi

    if [[ -z "$obj_yaml" ]]; then
      err "Could not find ${k8s_kind}/${name} in kustomize output for overlay ${overlay}"
      err "Check that the service exists in this overlay."
      continue
    fi

    # Build a JSON patch that removes dev-mode fields and restores declared values.
    # We cannot use `kubectl replace` (Knative rejects immutable creator annotation) or
    # `kubectl apply` (strategic merge leaves orphaned volumes that fail Knative validation).
    # JSON patch (RFC 6902) is the only reliable option.
    local restore_ops=()
    local c="/spec/template/spec/containers/0"
    local ann_key_ptr
    ann_key_ptr="$(json_escape_pointer "${DEV_ANNOTATION}")"

    # Remove dev-mode annotations
    restore_ops+=("{\"op\":\"remove\",\"path\":\"/metadata/annotations/${ann_key_ptr}\"}")
    # Remove template annotation if it exists
    local live_obj
    if [[ "$kind" == "ksvc" ]]; then
      live_obj="$(kubectl get ksvc "$name" --namespace "$NS" -o json 2>/dev/null)"
    else
      live_obj="$(kubectl get deployment "$name" --namespace "$NS" -o json 2>/dev/null)"
    fi
    if echo "$live_obj" | jq -e ".spec.template.metadata.annotations[\"${DEV_ANNOTATION}\"]" &>/dev/null; then
      restore_ops+=("{\"op\":\"remove\",\"path\":\"/spec/template/metadata/annotations/${ann_key_ptr}\"}")
    fi

    # Restore image from kustomize manifest
    local declared_image
    declared_image="$(printf '%s' "$obj_yaml" \
      | yaml_field_json '.spec.template.spec.containers[0].image')"
    if [[ -z "$declared_image" ]]; then
      err "Could not read declared image for ${kind}/${name} — skipping restore"
      continue
    fi
    restore_ops+=("{\"op\":\"replace\",\"path\":\"${c}/image\",\"value\":${declared_image}}")

    # Restore or remove command: if the declared manifest has a command, restore it;
    # otherwise remove the dev-mode command (which wasn't there before).
    local declared_cmd
    declared_cmd="$(printf '%s' "$obj_yaml" \
      | yaml_field_json '.spec.template.spec.containers[0].command')"
    if echo "$live_obj" | jq -e '.spec.template.spec.containers[0].command' &>/dev/null; then
      if [[ -n "$declared_cmd" ]]; then
        restore_ops+=("{\"op\":\"replace\",\"path\":\"${c}/command\",\"value\":${declared_cmd}}")
      else
        restore_ops+=("{\"op\":\"remove\",\"path\":\"${c}/command\"}")
      fi
    fi

    # workingDir: always remove (it is only added by dev mode)
    if echo "$live_obj" | jq -e '.spec.template.spec.containers[0].workingDir' &>/dev/null; then
      restore_ops+=("{\"op\":\"remove\",\"path\":\"${c}/workingDir\"}")
    fi
    if echo "$live_obj" | jq -e '.spec.template.spec.containers[0].volumeMounts' &>/dev/null; then
      restore_ops+=("{\"op\":\"remove\",\"path\":\"${c}/volumeMounts\"}")
    fi
    if echo "$live_obj" | jq -e '.spec.template.spec.volumes' &>/dev/null; then
      restore_ops+=("{\"op\":\"remove\",\"path\":\"/spec/template/spec/volumes\"}")
    fi

    # Restore securityContext, resources, and readinessProbe from declared manifest
    local declared_sc declared_res declared_probe
    declared_sc="$(printf '%s' "$obj_yaml" \
      | yaml_field_json '.spec.template.spec.containers[0].securityContext')"
    declared_res="$(printf '%s' "$obj_yaml" \
      | yaml_field_json '.spec.template.spec.containers[0].resources')"
    declared_probe="$(printf '%s' "$obj_yaml" \
      | yaml_field_json '.spec.template.spec.containers[0].readinessProbe')"

    [[ -n "$declared_sc" ]] && \
      restore_ops+=("{\"op\":\"replace\",\"path\":\"${c}/securityContext\",\"value\":${declared_sc}}")
    [[ -n "$declared_res" ]] && \
      restore_ops+=("{\"op\":\"replace\",\"path\":\"${c}/resources\",\"value\":${declared_res}}")
    [[ -n "$declared_probe" ]] && \
      restore_ops+=("{\"op\":\"replace\",\"path\":\"${c}/readinessProbe\",\"value\":${declared_probe}}")

    # Remove pod-level securityContext (fsGroup) added by dev mode if it wasn't there before
    local declared_pod_sc
    declared_pod_sc="$(printf '%s' "$obj_yaml" \
      | yaml_field_json '.spec.template.spec.securityContext')"
    if [[ -z "$declared_pod_sc" ]]; then
      if echo "$live_obj" | jq -e '.spec.template.spec.securityContext' &>/dev/null; then
        restore_ops+=("{\"op\":\"remove\",\"path\":\"/spec/template/spec/securityContext\"}")
      fi
    fi

    local joined_ops
    joined_ops="$(printf '%s,' "${restore_ops[@]}")"
    joined_ops="${joined_ops%,}"
    local patch_json="[${joined_ops}]"

    if [[ "$kind" == "ksvc" ]]; then
      kubectl patch ksvc "$name" --namespace "$NS" --type json --patch "$patch_json"
    else
      kubectl patch deployment "$name" --namespace "$NS" --type json --patch "$patch_json"
    fi

    if [[ "$kind" == "ksvc" ]]; then
      wait_for_ksvc "$name"
    else
      wait_for_deployment "$name"
    fi

    log "${kind}/${name} restored to declared state (image: dev.local/${svc}:local)"
  done <<< "$targets"

  echo ""
  log "==============================="
  log " Dev mode OFF: ${svc}"
  log "==============================="
  echo ""
  echo "  NOTE: 'off' restores to the LAST BUILT image (dev.local/${svc}:local)."
  echo "  If you need a fresh build: ./rebuild-redeploy.sh ${svc}"
  echo ""
}

# ── Subcommand: status ────────────────────────────────────────────────────────

cmd_status() {
  local filter_svc="${1:-}"

  echo ""
  step "Dev mode status — namespace: ${NS}"
  echo ""

  # Deps freshness
  local local_sha cluster_sha
  local_sha="$(local_lock_sha 2>/dev/null || true)"
  cluster_sha="$(cluster_lock_sha)"
  if [[ -z "$cluster_sha" ]]; then
    warn "Deps: not installed (run ./dev-mode-minikube.sh deps)"
  elif [[ "$local_sha" == "$cluster_sha" ]]; then
    log "Deps: up to date (sha: ${cluster_sha:0:12}...)"
  else
    warn "Deps: STALE — lock sha changed (run ./dev-mode-minikube.sh deps)"
    warn "  Cluster: ${cluster_sha:0:12}...  Local: ${local_sha:0:12}..."
  fi
  echo ""

  # Collect all objects in dev mode from the cluster
  local dev_ksvcs dev_deploys
  dev_ksvcs="$(kubectl get ksvc --namespace "$NS" \
    -o jsonpath="{range .items[?(@.metadata.annotations['${DEV_ANNOTATION}']=='true')]}{.metadata.name}{'\n'}{end}" \
    2>/dev/null || true)"
  dev_deploys="$(kubectl get deployment --namespace "$NS" \
    -o jsonpath="{range .items[?(@.metadata.annotations['${DEV_ANNOTATION}']=='true')]}{.metadata.name}{'\n'}{end}" \
    2>/dev/null || true)"

  if [[ -z "$dev_ksvcs" && -z "$dev_deploys" ]]; then
    log "No objects currently in dev mode."
    echo ""
    return 0
  fi

  # Map back to logical service names
  local found_svcs=()

  local all_svcs
  # Build list from YZ_SERVICES (excluding admin-console)
  all_svcs="$(printf '%s' "$YZ_SERVICES" | tr ' ' '\n' | grep -v '^admin-console$')"

  while IFS= read -r svc; do
    [[ -z "$svc" ]] && continue
    if [[ -n "$filter_svc" && "$svc" != "$filter_svc" ]]; then
      continue
    fi

    local targets
    targets="$(get_targets "$svc" 2>/dev/null || true)"
    [[ -z "$targets" ]] && continue

    local svc_in_dev=false
    while IFS=$'\t' read -r kind name entrypoint svc_dir; do
      [[ -z "$name" ]] && continue
      if [[ "$kind" == "ksvc" ]] && printf '%s\n' "$dev_ksvcs" | grep -qx "$name"; then
        svc_in_dev=true
        break
      elif [[ "$kind" == "deploy" ]] && printf '%s\n' "$dev_deploys" | grep -qx "$name"; then
        svc_in_dev=true
        break
      fi
    done <<< "$targets"

    if $svc_in_dev; then
      found_svcs+=("$svc")
    fi
  done <<< "$all_svcs"

  if (( ${#found_svcs[@]} == 0 )); then
    if [[ -n "$filter_svc" ]]; then
      log "${filter_svc}: not in dev mode"
    else
      log "No services currently in dev mode."
    fi
    echo ""
    return 0
  fi

  for svc in "${found_svcs[@]}"; do
    printf "  ${GREEN}●${NC} %-30s ${CYAN}[dev mode ON]${NC}\n" "$svc"
    local targets
    targets="$(get_targets "$svc" 2>/dev/null || true)"
    while IFS=$'\t' read -r kind name entrypoint svc_dir; do
      [[ -z "$name" ]] && continue
      if [[ "$kind" == "ksvc" ]] && printf '%s\n' "$dev_ksvcs" | grep -qx "$name"; then
        printf "      ksvc/%-30s  poll-reload %s\n" "$name" "$entrypoint"
      elif [[ "$kind" == "deploy" ]] && printf '%s\n' "$dev_deploys" | grep -qx "$name"; then
        printf "      deploy/%-28s  poll-reload %s\n" "$name" "$entrypoint"
      fi
    done <<< "$targets"
  done

  echo ""
}

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $0 <command> [arguments]

Commands:
  deps [--force]
      Ensure deps PVC, run pnpm install Job if lockfile changed.
      --force  reinstall even if sha matches.

  mount | unmount
      Start / stop the minikube 9p mount of the repo into the node.
      'on' starts it automatically; use these for manual control.

  <service> on
      Switch service to source-mounted dev mode (polling reloader; 9p has no inotify).

  <service> off [--overlay postgres-dev|mongo-dev]
      Restore service to declared state from overlay (default: postgres-dev).
      NOTE: restores to the LAST BUILT image, not a fresh build.

  <service> status
      Show dev-mode state for a specific service.

  status
      Show dev-mode state for all services + deps freshness.

Supported services:
  $(printf '%s' "$YZ_SERVICES" | tr ' ' '\n' | grep -v 'admin-console' | paste -sd' ' -)

Not supported:
  admin-console  (Angular SPA — stays on image flow)

Examples:
  $0 deps
  $0 mount
  $0 channel-service on
  $0 channel-service off
  $0 workflow-service on
  $0 status
  $0 channel-service status
  $0 unmount
EOF
}

# ── Main dispatch ─────────────────────────────────────────────────────────────

main() {
  check_deps
  check_context

  if (( $# == 0 )); then
    usage
    exit 0
  fi

  case "$1" in
    -h|--help|help) usage; exit 0 ;;

    deps)
      shift
      cmd_deps "$@"
      ;;

    mount)
      cmd_mount
      ;;

    unmount)
      cmd_unmount
      ;;

    status)
      # Global status — no service filter
      cmd_status ""
      ;;

    *)
      local svc="$1"
      shift

      if (( $# == 0 )); then
        err "Expected a subcommand after service name: on | off | status"
        usage
        exit 1
      fi

      local subcmd="$1"
      shift

      case "$subcmd" in
        on)
          cmd_on "$svc"
          ;;
        off)
          cmd_off "$svc" "$@"
          ;;
        status)
          cmd_status "$svc"
          ;;
        *)
          err "Unknown subcommand: ${subcmd}"
          usage
          exit 1
          ;;
      esac
      ;;
  esac
}

main "$@"
