#!/usr/bin/env bash
# purge-circuit-breakers.sh — wipe DistributedCircuitBreaker state in
# the shared Redis cluster between stress runs WITHOUT flushing other
# data (rate-limit counters, http-response cache, adapter SWR, etc.).
#
# Use case: the breakers in `connector-runtime` (HTTP + agent) and
# `channel-service` (egress) keep state in Redis with a TTL of ~ window
# + cooldown + 10 s (≈ 100 s for the HTTP breaker). After a stress run
# trips a breaker OPEN, that state survives between test runs and
# every new attempt fast-fails with `cooldown` until the TTL expires.
#
# Symptoms this script unblocks:
#
#   error: ApplicationFailure: Circuit breaker open for service
#   call '<uuid>' (cooldown)
#       at executeServiceCall ...
#
# Without any preceding HTTP 5xx in the same `kubectl logs` window —
# i.e. the breaker is OPEN from a *previous* run.
#
# What it does:
#   1. Detects CLUSTER vs STANDALONE mode via `CLUSTER INFO`. In
#      cluster mode it resolves the master endpoints via `CLUSTER
#      NODES` (skipping replicas) — each master owns only ~1/3 of the
#      slots so we MUST iterate them all. In standalone mode (dev)
#      there is a single endpoint and CLUSTER NODES is skipped.
#   2. For each requested key prefix, runs `SCAN MATCH '<prefix>:*'`
#      on every master and pipes the matches into `UNLINK` (non-
#      blocking O(1) DEL). SCAN/UNLINK are slot-local, which is why
#      we don't try to fan out a single Lua script.
#   3. Prints per-prefix and total counts. Idempotent — re-running
#      with no surviving keys is a no-op.
#
# What it preserves (NEVER touched):
#   - rate-limit counters  `ratelimit:*`   (RATE_LIMIT_KEY_PREFIX)
#   - http-response cache  `httpcache:v1:*` (connector-runtime cache-policy)
#   - adapter SWR caches   `adapter:config:*` / `adapter:internal-by-service:*`
#   - any key not matching one of the configured `--prefix` values
#
# Default prefixes (verified against every `keyPrefix:` in the code):
#   cb:workflow:http   connector-runtime                    endpoint calls
#   cb:workflow:agent  connector-runtime + workflow-service  agent/LLM calls
#   cb:channel:egress  channel-service                      outbound providers
#
# Subcommands:
#   purge   (default) UNLINK every matching key
#   count             read-only: print key counts per prefix per master
#
# Flags:
#   --namespace=NS        k8s ns where Redis lives
#                           (default: support-services-dev)
#   --pod=NAME            Bootstrap Redis pod we kubectl-exec into
#                           (default: redis-0). Any master/replica works
#                           — we only use it as a CLI host that can
#                           reach the rest of the cluster.
#   --port=PORT           Redis port (default: 6379)
#   --prefix=P            Add a prefix to purge. Repeatable. If omitted
#                           we use all three defaults above. Use this
#                           if you only want to nuke one breaker
#                           family (e.g. `--prefix=cb:workflow:http`).
#   --context=CTX         kubectl context (default: orbstack
#                           or KUBECTL_CONTEXT)
#   --dry-run             Count + print what WOULD be deleted; no
#                           UNLINK is issued.
#   --yes / -y            Skip the interactive confirmation.
#
# Exit codes:
#   0  purge/count finished. NOTE: per-master failures are swallowed by the
#      `|| true` in the main loop, so a PARTIAL sweep also exits 0 today.
#   2  bad input / preflight failed before any mutation

set -euo pipefail

# ----- defaults --------------------------------------------------------------

DEFAULT_NAMESPACE="support-services-dev"
DEFAULT_POD="redis-0"
DEFAULT_PORT="6379"
DEFAULT_CONTEXT="${KUBECTL_CONTEXT:-orbstack}"

DEFAULT_PREFIXES=(
  "cb:workflow:http"
  "cb:workflow:agent"
  "cb:channel:egress"
)

# ----- arg parsing -----------------------------------------------------------

SUBCOMMAND="purge"
NAMESPACE="${DEFAULT_NAMESPACE}"
POD="${DEFAULT_POD}"
PORT="${DEFAULT_PORT}"
CONTEXT="${DEFAULT_CONTEXT}"
PREFIXES=()
DRY_RUN=0
ASSUME_YES=0

usage() {
  sed -n '2,70p' "$0" | sed 's/^# \{0,1\}//'
}

parse_flag_value() {
  case "$1" in
    *=*) printf '%s' "${1#*=}";;
    *) printf '%s' "$2";;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    purge|count)
      SUBCOMMAND="$1"; shift;;
    --namespace=*|--namespace)
      [[ "$1" == "--namespace" ]] && { NAMESPACE="$2"; shift 2; } || { NAMESPACE="${1#*=}"; shift; };;
    --pod=*|--pod)
      [[ "$1" == "--pod" ]] && { POD="$2"; shift 2; } || { POD="${1#*=}"; shift; };;
    --port=*|--port)
      [[ "$1" == "--port" ]] && { PORT="$2"; shift 2; } || { PORT="${1#*=}"; shift; };;
    --prefix=*|--prefix)
      if [[ "$1" == "--prefix" ]]; then PREFIXES+=("$2"); shift 2; else PREFIXES+=("${1#*=}"); shift; fi;;
    --context=*|--context)
      [[ "$1" == "--context" ]] && { CONTEXT="$2"; shift 2; } || { CONTEXT="${1#*=}"; shift; };;
    --dry-run)
      DRY_RUN=1; shift;;
    --yes|-y)
      ASSUME_YES=1; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      printf 'unknown flag: %s\n\n' "$1" >&2
      usage >&2
      exit 2;;
  esac
done

if [[ ${#PREFIXES[@]} -eq 0 ]]; then
  PREFIXES=("${DEFAULT_PREFIXES[@]}")
fi

# ----- helpers ---------------------------------------------------------------

KCTL=(kubectl --context "${CONTEXT}" -n "${NAMESPACE}")

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 2; }

redis_cli_in_pod() {
  # Run redis-cli inside the bootstrap pod against an arbitrary
  # cluster master. Redirect stdin from /dev/null so kubectl-exec
  # does not eat the parent shell's stdin while we're in a pipeline.
  "${KCTL[@]}" exec -i "${POD}" -- \
    redis-cli -h "$1" -p "$2" "${@:3}" </dev/null
}

# Parse `CLUSTER NODES` and emit one `host:port` per master, one per
# line. `master` and `myself,master` are both valid roles. We strip
# the `@cluster_bus_port` suffix from the address column.
list_masters() {
  redis_cli_in_pod "127.0.0.1" "${PORT}" cluster nodes \
    | awk '/master/ { split($2, a, "@"); print a[1] }'
}

count_keys_for_prefix_on_master() {
  local host="$1" port="$2" prefix="$3"
  # `--scan` streams keys to stdout; `wc -l` counts. Empty stream → 0.
  "${KCTL[@]}" exec -i "${POD}" -- sh -c \
    "redis-cli -h '${host}' -p '${port}' --scan --pattern '${prefix}:*' | wc -l" \
    </dev/null
}

unlink_keys_for_prefix_on_master() {
  local host="$1" port="$2" prefix="$3"
  # SCAN + xargs UNLINK chunks naturally (xargs respects ARG_MAX). We
  # use UNLINK over DEL so a multi-thousand-key sweep doesn't block
  # the shard. -r → no-op on empty input.
  "${KCTL[@]}" exec -i "${POD}" -- sh -c \
    "redis-cli -h '${host}' -p '${port}' --scan --pattern '${prefix}:*' \
       | xargs -r -n 200 redis-cli -h '${host}' -p '${port}' unlink \
       | awk '{ s += \$1 } END { print s+0 }'" \
    </dev/null
}

# ----- preflight -------------------------------------------------------------

if ! command -v kubectl >/dev/null 2>&1; then
  fail "kubectl is not installed / not on PATH"
fi

if ! "${KCTL[@]}" get pod "${POD}" >/dev/null 2>&1; then
  fail "pod ${POD} not found in ${NAMESPACE} (context=${CONTEXT}). Use --pod=<existing-redis-pod>."
fi

# Detect cluster vs standalone. A standalone instance either reports
# `cluster_enabled:0` or errors outright with "cluster support disabled"
# depending on the build — capture stderr (2>&1) so we can match either.
INFO=$("${KCTL[@]}" exec -i "${POD}" -- redis-cli -p "${PORT}" cluster info </dev/null 2>&1 || true)

if grep -qiE "cluster support disabled|cluster_enabled:0" <<<"${INFO}"; then
  MODE="standalone"
elif grep -q "cluster_state:ok" <<<"${INFO}"; then
  MODE="cluster"
else
  # Cluster mode but unhealthy: an unreachable master would silently
  # lose its share of keys from the sweep, so refuse to proceed.
  log "cluster_state is NOT ok — refusing to proceed:"
  printf '%s\n' "${INFO}" >&2
  exit 2
fi

if [[ "${MODE}" == "cluster" ]]; then
  # Each master owns ~1/3 of the slots; discover and iterate them all.
  mapfile -t MASTERS < <(list_masters)
  if [[ ${#MASTERS[@]} -eq 0 ]]; then
    fail "could not discover any master from CLUSTER NODES"
  fi
else
  # Standalone (dev): a single endpoint, reachable as localhost from
  # inside the pod. Skip CLUSTER NODES / multi-master iteration; the
  # existing SCAN+UNLINK main loop runs against this one endpoint.
  MASTERS=("127.0.0.1:${PORT}")
fi

# ----- summary + confirmation ------------------------------------------------

log "Redis:            ns=${NAMESPACE} pod=${POD}:${PORT} (context=${CONTEXT}, mode=${MODE})"
log "Endpoints:        ${MASTERS[*]}"
log "Prefixes:         ${PREFIXES[*]}"
log "Subcommand:       ${SUBCOMMAND}$([[ ${DRY_RUN} -eq 1 ]] && echo ' (dry-run)')"

if [[ "${SUBCOMMAND}" == "purge" && ${DRY_RUN} -eq 0 && ${ASSUME_YES} -eq 0 ]]; then
  read -r -p "Proceed with UNLINK? [y/N] " ans
  case "${ans}" in
    y|Y|yes|YES) ;;
    *) log "aborted by user"; exit 2;;
  esac
fi

# ----- main loop -------------------------------------------------------------

declare -i grand_total=0
declare -i any_error=0

for prefix in "${PREFIXES[@]}"; do
  log "--- prefix: ${prefix} ---"
  declare -i prefix_total=0
  for endpoint in "${MASTERS[@]}"; do
    host="${endpoint%:*}"
    port="${endpoint#*:}"
    if [[ "${SUBCOMMAND}" == "count" || ${DRY_RUN} -eq 1 ]]; then
      n=$(count_keys_for_prefix_on_master "${host}" "${port}" "${prefix}" \
            | tr -d '[:space:]' || true)
      n=${n:-0}
      log "  ${host}:${port}  count=${n}"
      prefix_total+=${n}
    else
      n=$(unlink_keys_for_prefix_on_master "${host}" "${port}" "${prefix}" \
            | tr -d '[:space:]' || true)
      n=${n:-0}
      log "  ${host}:${port}  unlinked=${n}"
      prefix_total+=${n}
    fi
  done
  log "  total for ${prefix}: ${prefix_total}"
  grand_total+=${prefix_total}
done

log "==========================================================="
log "grand total ($([[ ${SUBCOMMAND} == 'count' || ${DRY_RUN} -eq 1 ]] \
  && echo 'would delete' || echo 'unlinked')): ${grand_total}"

exit "${any_error}"
