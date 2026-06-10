#!/usr/bin/env bash
# rebuild-all.sh — Build and deploy all app service images sequentially.
#
# Usage:
#   ./rebuild-all.sh                     # build + deploy all, env=dev
#   ./rebuild-all.sh qa                  # build + deploy all, env=qa
#   ./rebuild-all.sh --build-only        # only build images, skip rollouts
#   ./rebuild-all.sh --no-cache          # bust Docker layer cache on all builds
#   ./rebuild-all.sh --skip api-gateway,auth-service   # exclude specific services
#
# Infrastructure (postgres, redis, nats, temporal) is never touched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINIKUBE_PROFILE="yoizen-arch"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }
bold() { echo -e "${BOLD}$*${NC}"; }

# ── Service lists sourced from single source of truth ────────────────────────
source "${SCRIPT_DIR}/services.conf"
ORDERED_SERVICES=($YZ_SERVICES)

usage() {
  cat <<EOF
Usage: $0 [environment] [options]

Options:
  --build-only          Only build Docker images, skip Knative rollouts
  --deploy-only         Only trigger rollouts, skip Docker builds
  --no-cache            Build without Docker layer cache
  --skip <svc,svc,...>  Comma-separated list of services to skip
  -h, --help            Show this message

Environment: dev (default), qa, staging, production
EOF
}

# ── Argument parsing ──────────────────────────────────────────────────────────
ENVIRONMENT="dev"
BUILD_ONLY="false"
DEPLOY_ONLY="false"
NO_CACHE=""
declare -a SKIP_LIST=()

while (( $# > 0 )); do
  case "$1" in
    -h|--help)       usage; exit 0 ;;
    --build-only)    BUILD_ONLY="true"; shift ;;
    --deploy-only)   DEPLOY_ONLY="true"; shift ;;
    --no-cache)      NO_CACHE="--no-cache"; shift ;;
    --skip)          IFS=',' read -ra SKIP_LIST <<< "$2"; shift 2 ;;
    dev|qa|staging|production) ENVIRONMENT="$1"; shift ;;
    *) err "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

should_skip() {
  local svc="$1"
  [[ ${#SKIP_LIST[@]} -eq 0 ]] && return 1
  local s
  for s in "${SKIP_LIST[@]}"; do
    [[ "$s" == "$svc" ]] && return 0
  done
  return 1
}

# ── Docker env setup ──────────────────────────────────────────────────────────
setup_docker_env() {
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$ctx" == "$MINIKUBE_PROFILE" ]] || minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
    log "Pointing Docker to Minikube daemon (profile: ${MINIKUBE_PROFILE})"
    eval "$(minikube docker-env -p "$MINIKUBE_PROFILE")"
  else
    log "Using local Docker daemon (OrbStack / Docker Desktop)"
  fi
}

# ── Phase 1: build all images in parallel ────────────────────────────────────
build_all() {
  bold "\n── Phase 1: Building images ─────────────────────────────────────────────"
  local pids=() names=() logs=() exit_files=()

  for svc in "${ORDERED_SERVICES[@]}"; do
    if should_skip "$svc"; then
      warn "Skipping build: ${svc}"
      continue
    fi

    local logfile exitfile
    logfile="$(mktemp /tmp/build-${svc}-XXXXXX)"
    exitfile="${logfile}.exit"
    logs+=("$logfile")
    exit_files+=("$exitfile")
    names+=("$svc")

    # The subshell writes its own exit code to a file so the outer shell
    # can read it — avoids the "echo exits 0, masking real failure" trap.
    (
      "${SCRIPT_DIR}/rebuild-redeploy.sh" "$svc" "$ENVIRONMENT" \
        --build-only ${NO_CACHE} \
        >"$logfile" 2>&1
      printf '%s' $? > "$exitfile"
    ) &
    pids+=($!)
    step "Building ${svc} (pid $!)..."
  done

  bold "\nWaiting for all builds to finish..."

  # Poll until every background job has written its exit file.
  # This lets us print results as each job finishes rather than
  # waiting for the slowest in-order job (bash 3-compatible; no wait -n).
  local done_flags=()
  local i
  for i in "${!pids[@]}"; do done_flags+=(0); done

  local all_done=0 failed=() tick=0
  local total=${#pids[@]} completed=0
  while (( all_done == 0 )); do
    all_done=1
    local still_running=()
    for i in "${!pids[@]}"; do
      if [[ "${done_flags[$i]}" == "1" ]]; then continue; fi
      local exitfile="${exit_files[$i]}"
      if [[ -f "$exitfile" ]]; then
        local rc svc="${names[$i]}" logfile="${logs[$i]}"
        rc="$(cat "$exitfile")"
        done_flags[$i]=1
        (( completed++ )) || true
        if [[ "$rc" == "0" ]]; then
          log "✔ [${completed}/${total}] ${svc}"
        else
          err "✘ [${completed}/${total}] ${svc} (exit ${rc}) — last lines:"
          tail -n 20 "$logfile" >&2
          err "Full log: ${logfile}"
          failed+=("$svc")
        fi
      else
        all_done=0
        still_running+=("${names[$i]}")
      fi
    done

    if (( all_done == 0 )); then
      # Print a heartbeat every ~10 s (5 × 2 s ticks) so the terminal
      # doesn't look frozen while images are being built.
      (( tick++ )) || true
      if (( tick % 5 == 0 )); then
        printf "${CYAN}[BUILD]${NC}  still running (%d/%d done): %s\n" \
          "$completed" "$total" "${still_running[*]}"
      fi
      sleep 2
    fi
  done

  # Reap all background jobs so no zombies linger.
  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" 2>/dev/null || true
  done

  if (( ${#failed[@]} > 0 )); then
    err "\nFailed builds: ${failed[*]}"
    err "Fix the above services before running --deploy-only"
    exit 1
  fi

  log "All images built successfully."
}

# ── Phase 2: roll out sequentially ───────────────────────────────────────────
deploy_all() {
  bold "\n── Phase 2: Rolling out services ────────────────────────────────────────"
  local failed=()

  for svc in "${ORDERED_SERVICES[@]}"; do
    if should_skip "$svc"; then
      warn "Skipping rollout: ${svc}"
      continue
    fi

    step "Rolling out ${svc}..."
    if "${SCRIPT_DIR}/rebuild-redeploy.sh" "$svc" "$ENVIRONMENT" --deploy-only; then
      log "✔ ${svc}"
    else
      err "✘ ${svc} rollout failed"
      failed+=("$svc")
    fi
  done

  if (( ${#failed[@]} > 0 )); then
    warn "\nRollout failed for: ${failed[*]}"
    warn "Other services are running. Inspect the above with:"
    warn "  kubectl get pods -n platform-services-${ENVIRONMENT} | grep <service>"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  bold "\n╔══════════════════════════════════════════╗"
  bold "║       Rebuild All — Yoizen Platform      ║"
  bold "╚══════════════════════════════════════════╝"
  log "Environment : ${ENVIRONMENT}"
  log "Build only  : ${BUILD_ONLY}"
  log "Deploy only : ${DEPLOY_ONLY}"
  log "No cache    : ${NO_CACHE:-false}"
  [[ ${#SKIP_LIST[@]} -gt 0 ]] && log "Skipping    : ${SKIP_LIST[*]:-}"
  echo ""

  if [[ "$DEPLOY_ONLY" != "true" ]]; then
    setup_docker_env
    build_all
  fi

  if [[ "$BUILD_ONLY" != "true" ]]; then
    deploy_all
  fi

  bold "\n✔ Done — environment: ${ENVIRONMENT}"
}

main "$@"
