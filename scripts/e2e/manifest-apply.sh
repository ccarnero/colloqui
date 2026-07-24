#!/usr/bin/env bash
set -euo pipefail

# Auto-load scripts/e2e/.env if present (same convention as scripts/reset/):
# every var below has a script-level ${VAR:-default} fallback, so anything
# set in .env wins over the hardcoded default. See scripts/e2e/README.md.
E2E_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${E2E_SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${E2E_SCRIPT_DIR}/.env"
  set +a
fi

# T05 (manual-loops/provisioning-manifest-gaps-4.md) — REQUIRED, NO DEFAULT.
# Unlike every other E2E_* var above (which has a script-level ${VAR:-default}
# fallback), these two have NO fallback and NO hardcoded value anywhere in
# this repo: provisioning-manifest-gaps-4.md's Human boundaries are explicit
# ("T05's live-verification env values are loaded by the human ... never
# fabricated in the repo"). Set both — e.g. in `scripts/e2e/.env` (gitignored,
# auto-loaded above) — to throwaway test values before running Stage 9; the
# script fails loud, naming both vars, if either is missing/empty.
#   E2E_T05_SECRET_EMAIL_VALUE=<throwaway test value, never a real credential>
#   E2E_T05_SECRET_PASSWORD_VALUE=<throwaway test value, never a real credential>

# End-to-end check of the T04 declarative-provisioning apply engine
# (manual-loops/declarative-provisioning.md): plan -> apply -> re-plan
# (all-noop) -> re-apply (no-op) -> teardown, driven directly against the
# deployed provisioning-service.
#
# No api-gateway route exists yet (that lands in T07), so this script talks
# to the Knative ingress hostnames of the services directly — the SAME
# transport pattern every other e2e script uses (see http-workflow.sh:
# dev.local base URLs + Host header + --resolve for macOS mDNS). Knative
# ksvc Services are activator/ingress-routed, so `kubectl port-forward`
# does NOT work on them — hence direct ingress URLs, never port-forward.
#
#   1. PUT a minimal manifest (one inbound `http` channel + one `jsFunction`
#      workflow — the smallest shape satisfying the T01 structural rules:
#      >=1 inbound channel, >=1 process) under an e2e-prefixed,
#      account-scoped name.
#   2. POST .../plan: expect BOTH resources verdict `create`.
#   3. POST .../apply: expect BOTH resources applied (`create`), HTTP 200.
#   4. POST .../plan again: expect BOTH resources verdict `noop` (idempotent
#      convergence — the exact criterion SPEC.md requires).
#   5. POST .../apply again: expect an all-noop apply (appliedCount 0),
#      proving re-apply is a true no-op.
#   6. (T06) Add a `knowledgeBases` section (one inline document + one
#      `file:` document shipped in a tar bundle) to the SAME manifest, PUT
#      it as revision 2, plan (expect 2 documents to embed), apply with the
#      bundle attached (base64 tar in the JSON body — see apply.controller.ts
#      for why this is base64-JSON and not true multipart), then change the
#      inline document's content and re-apply: plan/apply must show EXACTLY
#      ONE re-embed (the changed document only).
#   7. Teardown: delete the channel account, the workflow definition, and
#      the knowledge base created above, directly via their owning services
#      (provisioning-service has no delete/prune route by design —
#      decision 8). Runs via an EXIT trap, idempotent (resolves by
#      e2e-prefixed NAME as a fallback, safe to rerun after a crashed prior
#      run).
#   8. (T09 + this task's T1 coverage-maximization pass) The FULL showcase
#      manifest — telegram-style channel (`http` fallback for CI, real
#      Telegram creds don't exist in dev), a connector with `auth`
#      (secretRef-resolved bearer token), `endpoints`, and `tags: ["llm"]`,
#      an mcpServer with a `{ secretRef }` header, a minimal skill, a plain
#      systemVariable, an agent (KB refs, enabledMcpServerRefs/
#      enabledMcpTools/toolDescriptionOverrides, and a
#      `model_config.llm.connectorId` SCALAR symbolic-ref substitution), a
#      knowledge base, and a workflow whose `trigger.config.accountIds` (ARRAY
#      substitution) and `endpointCall.adapterId` (SCALAR substitution) both
#      resolve to real ids — applied through the REAL SDK, not raw curl.
#      Delegated to `scripts/e2e/manifest-showcase-driver.ts` (`bun run`,
#      imports `sdk/src/index.ts` directly) because "apply via the SDK" is
#      this task's explicit ask; this bash script still owns cluster
#      reachability, teardown, the tracking-ingester Postgres assertions, and
#      the post-apply workflow-definition UUID check the driver has no
#      access to. Round trip: plan (all-create, 7 resources) -> apply
#      (appliedCount=7) -> plan again (all-noop) -> apply again (no-op) -> a
#      NEGATIVE broker test (a consumer presenting a MISMATCHED secret
#      binding, called directly against provisioning-service's internal-only
#      route, never through the gateway) is DENIED and audited
#      (`secret_access_denied`) -> ROUND 2 (a mini `kind: LibraryManifest`
#      with ONE connector: put -> plan(create 1) -> apply(1) -> apply-noop)
#      -> ROUND 3 (three plan-only negative tests against a SEPARATE
#      throwaway manifest: `unallowlisted_symbolic_ref`,
#      `mismatched_symbolic_ref`, `invalid_array_substitution_shape` — all
#      three fail-loud kinds only surface at APPLY time, never at plan time,
#      see the driver's header comment).
#      Both the `apply_*` audit events and the `secret_access_denied` event
#      are asserted present in `tracking.tracked_events` (queried the same
#      way `http-workflow.sh` does: `kubectl exec` + `psql` against the
#      tracking-ingester's Postgres store — this service has no other public
#      query surface for arbitrary event lookups by manifest name).
#      Teardown: the driver's created channel/connector/mcpServer/skill/
#      systemVariable/agent/KB/workflow are deleted directly via their owning
#      services (same pattern as stage 7), as are the LibraryManifest's
#      connector and the negative-test manifest's throwaway channel/connector
#      (its workflow is asserted NEVER created, so there is nothing to delete
#      for it); the four k8s Secrets it created (`psec-channel-*`,
#      `psec-connector-*`, `psec-mcpserver-*`) have no delete API (write-only,
#      decision 4) so they are removed with `kubectl delete secret` directly.
#
#      OUT OF SCOPE for this coverage pass (documented, not an oversight):
#      `services[]` (hosted services / registry routes — a heavier Knative
#      reconciliation stage this task's "no heavy stages" constraint
#      excludes), `route_collision` preconditions (only reachable with
#      `services[]`), and `knowledgeBases[].documents[].source.type: "url"`
#      (network-fetched KB ingestion, likewise heavier than this task's
#      scope).
#
# Exit code 0 = full round trip verified; 1 = any stage failed.

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
TENANT="${E2E_TENANT:-acme}"

# Knative ingress hostnames (dev.local), each env-overridable. The three
# services this script touches are separate ksvc, so each carries its own
# Host header (the ingress routes by Host, not path).
PROVISIONING_URL="${E2E_PROVISIONING_URL:-http://provisioning-service.platform-services-dev.dev.local}"
PROVISIONING_HOST="${E2E_PROVISIONING_HOST:-provisioning-service.platform-services-dev.dev.local}"
CHANNEL_URL="${E2E_CHANNEL_URL:-http://channel-service-api.platform-services-dev.dev.local}"
CHANNEL_HOST="${E2E_CHANNEL_HOST:-channel-service-api.platform-services-dev.dev.local}"
WORKFLOW_URL="${E2E_WORKFLOW_URL:-http://workflow-service-api.platform-services-dev.dev.local}"
WORKFLOW_HOST="${E2E_WORKFLOW_HOST:-workflow-service-api.platform-services-dev.dev.local}"
AGENT_ADMIN_URL="${E2E_AGENT_ADMIN_URL:-http://agent-admin-service.platform-services-dev.dev.local}"
AGENT_ADMIN_HOST="${E2E_AGENT_ADMIN_HOST:-agent-admin-service.platform-services-dev.dev.local}"
# T09: teardown of the showcase manifest's connector goes straight to
# connector-admin (same dev.local ingress convention as every other ksvc
# this script already talks to).
CONNECTOR_ADMIN_URL="${E2E_CONNECTOR_ADMIN_URL:-http://connector-admin-api.platform-services-dev.dev.local}"
CONNECTOR_ADMIN_HOST="${E2E_CONNECTOR_ADMIN_HOST:-connector-admin-api.platform-services-dev.dev.local}"
# T05 (provisioning-manifest-gaps-4.md): registry-service's own dev.local
# ingress hostname (ksvc name is literally "registry-service", same
# `<ksvc>.<namespace>.dev.local` convention every other ksvc here uses) — used
# to teardown the T05 hosted-service fixture and (structural verification
# only) to cross-check the registered service's knativeName/namespace via
# `GET /services/:id`.
REGISTRY_URL="${E2E_REGISTRY_URL:-http://registry-service.platform-services-dev.dev.local}"
REGISTRY_HOST="${E2E_REGISTRY_HOST:-registry-service.platform-services-dev.dev.local}"

POLL_TIMEOUT_S="${E2E_POLL_TIMEOUT_S:-60}"

# T09: tracking-ingester's Postgres store, queried directly the same way
# http-workflow.sh does (kubectl exec + psql) — tracking-ingester-service
# has no public query surface for "every apply_* event for manifest X" or
# "the secret_access_denied event for correlation Y" beyond raw SQL.
TRACKING_PG_NAMESPACE="${E2E_TRACKING_PG_NAMESPACE:-support-services-dev}"
TRACKING_PG_POD="${E2E_TRACKING_PG_POD:-postgres-0}"
TRACKING_PG_USER="${E2E_TRACKING_PG_USER:-yoizen}"
TRACKING_PG_DB="${E2E_TRACKING_PG_DB:-yoizen}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

command -v curl >/dev/null 2>&1 || { err "curl not found in PATH"; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq not found in PATH"; exit 1; }
# T05 (provisioning-manifest-gaps-4.md): structural Knative-spec inspection
# and the pod runtime-env count check both go straight through kubectl —
# required from here on, not just an opportunistic teardown convenience like
# the unchecked `kubectl` calls already in cleanup() below.
command -v kubectl >/dev/null 2>&1 || { err "kubectl not found in PATH — required for T05 live verification"; exit 1; }

# macOS mDNS resolves *.dev.local in ~5s even with /etc/hosts entries;
# --resolve skips DNS. Override/disable via E2E_RESOLVE_IP (set empty to let
# curl resolve the hostname itself, e.g. in-cluster runners). Every dev.local
# ksvc shares the same ingress IP, so one resolve IP covers all three hosts.
E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"

# Port is derived from each URL's scheme; all three use plain http:80 by
# default, but keep the derivation generic so an https or :PORT override works.
url_port() {
  local url="$1" scheme host_port
  scheme="${url%%://*}"
  host_port="${url#*://}"
  host_port="${host_port%%/*}"
  if [[ "$host_port" == *:* ]]; then
    echo "${host_port##*:}"
  elif [[ "$scheme" == "https" ]]; then
    echo 443
  else
    echo 80
  fi
}

PROVISIONING_PORT="$(url_port "$PROVISIONING_URL")"
CHANNEL_PORT="$(url_port "$CHANNEL_URL")"
WORKFLOW_PORT="$(url_port "$WORKFLOW_URL")"
AGENT_ADMIN_PORT="$(url_port "$AGENT_ADMIN_URL")"
CONNECTOR_ADMIN_PORT="$(url_port "$CONNECTOR_ADMIN_URL")"
REGISTRY_PORT="$(url_port "$REGISTRY_URL")"

# Per-host --resolve args, appended only when E2E_RESOLVE_IP is set.
PROVISIONING_RESOLVE=()
CHANNEL_RESOLVE=()
WORKFLOW_RESOLVE=()
AGENT_ADMIN_RESOLVE=()
CONNECTOR_ADMIN_RESOLVE=()
REGISTRY_RESOLVE=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  PROVISIONING_RESOLVE=(--resolve "${PROVISIONING_HOST}:${PROVISIONING_PORT}:${E2E_RESOLVE_IP}")
  CHANNEL_RESOLVE=(--resolve "${CHANNEL_HOST}:${CHANNEL_PORT}:${E2E_RESOLVE_IP}")
  WORKFLOW_RESOLVE=(--resolve "${WORKFLOW_HOST}:${WORKFLOW_PORT}:${E2E_RESOLVE_IP}")
  AGENT_ADMIN_RESOLVE=(--resolve "${AGENT_ADMIN_HOST}:${AGENT_ADMIN_PORT}:${E2E_RESOLVE_IP}")
  CONNECTOR_ADMIN_RESOLVE=(--resolve "${CONNECTOR_ADMIN_HOST}:${CONNECTOR_ADMIN_PORT}:${E2E_RESOLVE_IP}")
  REGISTRY_RESOLVE=(--resolve "${REGISTRY_HOST}:${REGISTRY_PORT}:${E2E_RESOLVE_IP}")
fi

# Thin curl wrappers: each pins the correct Host header + --resolve for its
# target service. All args after the method/path are forwarded to curl.
prov_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${PROVISIONING_RESOLVE[@]}" -X "$method" \
    -H "Host: ${PROVISIONING_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${PROVISIONING_URL}${path}"
}
channel_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${CHANNEL_RESOLVE[@]}" -X "$method" \
    -H "Host: ${CHANNEL_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${CHANNEL_URL}${path}"
}
workflow_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${WORKFLOW_RESOLVE[@]}" -X "$method" \
    -H "Host: ${WORKFLOW_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${WORKFLOW_URL}${path}"
}
agent_admin_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${AGENT_ADMIN_RESOLVE[@]}" -X "$method" \
    -H "Host: ${AGENT_ADMIN_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${AGENT_ADMIN_URL}${path}"
}
connector_admin_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${CONNECTOR_ADMIN_RESOLVE[@]}" -X "$method" \
    -H "Host: ${CONNECTOR_ADMIN_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${CONNECTOR_ADMIN_URL}${path}"
}
registry_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${REGISTRY_RESOLVE[@]}" -X "$method" \
    -H "Host: ${REGISTRY_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${REGISTRY_URL}${path}"
}

NONCE="e2e-$(date +%s)-$RANDOM"

# Regression-test hook (scripts/e2e/teardown-regression.sh): when set, this
# run's NONCE is written to the given file BEFORE anything else can fail, so
# a caller that expects THIS script to fail mid-run can still discover which
# nonce to sweep-check for leaked residue afterwards.
if [[ -n "${E2E_NONCE_OUT_FILE:-}" ]]; then
  printf '%s' "$NONCE" > "$E2E_NONCE_OUT_FILE"
fi

MANIFEST_NAME="e2e-manifest-apply-${NONCE}"
CHANNEL_NAME="e2e-http-${NONCE}"
WORKFLOW_NAME="e2e-flow-${NONCE}"
KB_NAME="e2e-kb-${NONCE}"

CHANNEL_EXTERNAL_ID=""
WORKFLOW_EXTERNAL_ID=""
KB_EXTERNAL_ID=""

# T09 showcase driver state — populated once the driver's JSON summary is
# parsed (stage 8). Kept separate from the T04-06 variables above (different
# manifest, different resource names) so the two stages never collide.
SHOWCASE_JSON=""
SHOWCASE_CHANNEL_EXTERNAL_ID=""
SHOWCASE_CONNECTOR_EXTERNAL_ID=""
SHOWCASE_AGENT_EXTERNAL_ID=""
SHOWCASE_WORKFLOW_EXTERNAL_ID=""
SHOWCASE_KB_EXTERNAL_ID=""
SHOWCASE_CHANNEL_NAME=""
SHOWCASE_CONNECTOR_NAME=""
SHOWCASE_AGENT_NAME=""
SHOWCASE_WORKFLOW_NAME=""
SHOWCASE_KB_NAME=""
SHOWCASE_MANIFEST_NAME=""
SHOWCASE_SECRET_A_NAME=""
SHOWCASE_SECRET_A_OWNER=""
SHOWCASE_SECRET_B_NAME=""
SHOWCASE_SECRET_B_OWNER=""
SHOWCASE_DENY_CORRELATION_ID=""

# T1 coverage-maximization additions — mcpServer/skill/systemVariable
# resources + the two extra secrets bound to them, plus the LibraryManifest
# (ROUND 2) and negative-test manifest (ROUND 3) state. Same
# resolve-by-name-fallback idempotent teardown pattern as the T09 vars above.
SHOWCASE_MCP_SERVER_NAME=""
SHOWCASE_MCP_SERVER_EXTERNAL_ID=""
SHOWCASE_SKILL_NAME=""
SHOWCASE_SKILL_EXTERNAL_ID=""
SHOWCASE_SYSTEM_VARIABLE_NAME=""
SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID=""
SHOWCASE_SECRET_C_NAME=""
SHOWCASE_SECRET_C_OWNER=""
SHOWCASE_SECRET_D_NAME=""
SHOWCASE_SECRET_D_OWNER=""
LIB_MANIFEST_NAME=""
LIB_CONNECTOR_NAME=""
LIB_CONNECTOR_EXTERNAL_ID=""
NEG_MANIFEST_NAME=""
NEG_CHANNEL_NAME=""
NEG_CHANNEL_EXTERNAL_ID=""
NEG_CONNECTOR_NAME=""
NEG_CONNECTOR_EXTERNAL_ID=""
NEG_WORKFLOW_NAME=""

# T05 (provisioning-manifest-gaps-4.md) — the exact crm-support-telegram T04
# use case: a `kind: LibraryManifest` with one connector (3 endpoints) and one
# hosted service whose `env[]` carries the 6-entry shape (2 secretRef + 1
# connectorRef + 3 connectorRef/endpointMethod/endpointPath refs). Kept
# entirely separate from every manifest above (own NONCE-suffixed names, own
# teardown block) so a T05 failure never touches T04/T06/T09 state.
T05_MANIFEST_NAME="e2e-manifest-t05-${NONCE}"
T05_CONNECTOR_NAME="e2e-t05-hubspot-${NONCE}"
T05_SERVICE_NAME="e2e-t05-crm-svc-${NONCE}"
T05_SECRET_EMAIL_NAME="e2e-t05-yoizen-email-${NONCE}"
T05_SECRET_PASSWORD_NAME="e2e-t05-yoizen-password-${NONCE}"
T05_CONNECTOR_EXTERNAL_ID=""
T05_SERVICE_EXTERNAL_ID=""
T05_TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"
T05_KSVC_NAME="${T05_SERVICE_NAME}-${TENANT}"
T05_SECRET_K8S_NAME="psec-service-${T05_SERVICE_NAME}"

wait_for_health() {
  local svc="$1"
  local deadline=$((SECONDS + POLL_TIMEOUT_S))
  until "${svc}_curl" GET /health >/dev/null 2>&1; do
    if [[ $SECONDS -ge $deadline ]]; then
      err "${svc} did not respond on /health within ${POLL_TIMEOUT_S}s"
      exit 1
    fi
    sleep 2
  done
  log "${svc} is reachable"
}

cleanup() {
  local status=$?
  log "Cleanup: tearing down e2e-created resources (idempotent)"
  [[ -n "${BUNDLE_DIR:-}" && -d "${BUNDLE_DIR:-}" ]] && rm -rf "$BUNDLE_DIR"

  # Resolve by e2e-prefixed NAME as a fallback when no externalId was
  # captured yet (e.g. the script failed before the first apply).
  if [[ -z "$CHANNEL_EXTERNAL_ID" ]]; then
    CHANNEL_EXTERNAL_ID="$(channel_curl GET /channels/accounts 2>/dev/null \
      | jq -r --arg n "$CHANNEL_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
  fi
  if [[ -n "$CHANNEL_EXTERNAL_ID" ]]; then
    channel_curl DELETE "/channels/accounts/${CHANNEL_EXTERNAL_ID}" >/dev/null 2>&1 || true
    log "deleted channel account externalId=${CHANNEL_EXTERNAL_ID}"
  fi

  if [[ -z "$WORKFLOW_EXTERNAL_ID" ]]; then
    WORKFLOW_EXTERNAL_ID="$(workflow_curl GET /workflows 2>/dev/null \
      | jq -r --arg n "$WORKFLOW_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
  fi
  if [[ -n "$WORKFLOW_EXTERNAL_ID" ]]; then
    workflow_curl DELETE "/workflows/${WORKFLOW_EXTERNAL_ID}" >/dev/null 2>&1 || true
    log "deleted workflow definition externalId=${WORKFLOW_EXTERNAL_ID}"
  fi

  if [[ -z "$KB_EXTERNAL_ID" ]]; then
    KB_EXTERNAL_ID="$(agent_admin_curl GET /admin/knowledge-bases 2>/dev/null \
      | jq -r --arg n "$KB_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
  fi
  if [[ -n "$KB_EXTERNAL_ID" ]]; then
    agent_admin_curl DELETE "/admin/knowledge-bases/${KB_EXTERNAL_ID}" >/dev/null 2>&1 || true
    log "deleted knowledge base externalId=${KB_EXTERNAL_ID}"
  fi

  # T09: teardown of the showcase driver's resources — same
  # fallback-by-name idempotent pattern as above, scoped to the
  # SHOWCASE_* names (a different manifest than the T04-06 one).
  if [[ -n "$SHOWCASE_CHANNEL_NAME" ]]; then
    if [[ -z "$SHOWCASE_CHANNEL_EXTERNAL_ID" ]]; then
      SHOWCASE_CHANNEL_EXTERNAL_ID="$(channel_curl GET /channels/accounts 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_CHANNEL_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_CHANNEL_EXTERNAL_ID" ]]; then
      channel_curl DELETE "/channels/accounts/${SHOWCASE_CHANNEL_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase channel account externalId=${SHOWCASE_CHANNEL_EXTERNAL_ID}"
    fi
  fi

  if [[ -n "$SHOWCASE_CONNECTOR_NAME" ]]; then
    if [[ -z "$SHOWCASE_CONNECTOR_EXTERNAL_ID" ]]; then
      SHOWCASE_CONNECTOR_EXTERNAL_ID="$(connector_admin_curl GET /connectors 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_CONNECTOR_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_CONNECTOR_EXTERNAL_ID" ]]; then
      connector_admin_curl DELETE "/connectors/${SHOWCASE_CONNECTOR_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase connector externalId=${SHOWCASE_CONNECTOR_EXTERNAL_ID}"
    fi
  fi

  if [[ -n "$SHOWCASE_AGENT_NAME" ]]; then
    if [[ -z "$SHOWCASE_AGENT_EXTERNAL_ID" ]]; then
      SHOWCASE_AGENT_EXTERNAL_ID="$(agent_admin_curl GET /admin/agents 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_AGENT_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_AGENT_EXTERNAL_ID" ]]; then
      agent_admin_curl DELETE "/admin/agents/${SHOWCASE_AGENT_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase agent externalId=${SHOWCASE_AGENT_EXTERNAL_ID}"
    fi
  fi

  if [[ -n "$SHOWCASE_WORKFLOW_NAME" ]]; then
    if [[ -z "$SHOWCASE_WORKFLOW_EXTERNAL_ID" ]]; then
      SHOWCASE_WORKFLOW_EXTERNAL_ID="$(workflow_curl GET /workflows 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_WORKFLOW_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_WORKFLOW_EXTERNAL_ID" ]]; then
      workflow_curl DELETE "/workflows/${SHOWCASE_WORKFLOW_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase workflow definition externalId=${SHOWCASE_WORKFLOW_EXTERNAL_ID}"
    fi
  fi

  if [[ -n "$SHOWCASE_KB_NAME" ]]; then
    if [[ -z "$SHOWCASE_KB_EXTERNAL_ID" ]]; then
      SHOWCASE_KB_EXTERNAL_ID="$(agent_admin_curl GET /admin/knowledge-bases 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_KB_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_KB_EXTERNAL_ID" ]]; then
      agent_admin_curl DELETE "/admin/knowledge-bases/${SHOWCASE_KB_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase knowledge base externalId=${SHOWCASE_KB_EXTERNAL_ID}"
    fi
  fi

  # T1 coverage-maximization additions — mcpServer/skill/systemVariable,
  # same resolve-by-name-fallback idempotent pattern as above.
  if [[ -n "$SHOWCASE_MCP_SERVER_NAME" ]]; then
    if [[ -z "$SHOWCASE_MCP_SERVER_EXTERNAL_ID" ]]; then
      SHOWCASE_MCP_SERVER_EXTERNAL_ID="$(agent_admin_curl GET /admin/mcp-servers 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_MCP_SERVER_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_MCP_SERVER_EXTERNAL_ID" ]]; then
      agent_admin_curl DELETE "/admin/mcp-servers/${SHOWCASE_MCP_SERVER_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase mcpServer externalId=${SHOWCASE_MCP_SERVER_EXTERNAL_ID}"
    fi
  fi

  if [[ -n "$SHOWCASE_SKILL_NAME" ]]; then
    if [[ -z "$SHOWCASE_SKILL_EXTERNAL_ID" ]]; then
      SHOWCASE_SKILL_EXTERNAL_ID="$(agent_admin_curl GET /admin/skills 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_SKILL_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_SKILL_EXTERNAL_ID" ]]; then
      agent_admin_curl DELETE "/admin/skills/${SHOWCASE_SKILL_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase skill externalId=${SHOWCASE_SKILL_EXTERNAL_ID}"
    fi
  fi

  if [[ -n "$SHOWCASE_SYSTEM_VARIABLE_NAME" ]]; then
    if [[ -z "$SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID" ]]; then
      SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID="$(agent_admin_curl GET /admin/system-variables 2>/dev/null \
        | jq -r --arg n "$SHOWCASE_SYSTEM_VARIABLE_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID" ]]; then
      agent_admin_curl DELETE "/admin/system-variables/${SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted showcase systemVariable externalId=${SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID}"
    fi
  fi

  # ROUND 2 (LibraryManifest) — its one connector, same pattern.
  if [[ -n "$LIB_CONNECTOR_NAME" ]]; then
    if [[ -z "$LIB_CONNECTOR_EXTERNAL_ID" ]]; then
      LIB_CONNECTOR_EXTERNAL_ID="$(connector_admin_curl GET /connectors 2>/dev/null \
        | jq -r --arg n "$LIB_CONNECTOR_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$LIB_CONNECTOR_EXTERNAL_ID" ]]; then
      connector_admin_curl DELETE "/connectors/${LIB_CONNECTOR_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted LibraryManifest connector externalId=${LIB_CONNECTOR_EXTERNAL_ID}"
    fi
  fi

  # ROUND 3 (negative-test manifest) — its throwaway channel + connector are
  # created on the FIRST negative revision's apply attempt (before the
  # deliberately-broken workflow is ever reached); its workflow is asserted
  # NEVER created across all three revisions by stage 8c. That assertion is
  # the guarantee — but as belt-and-suspenders (so a FUTURE regression that
  # DID leak it cannot leave a live resource behind), teardown ALSO attempts
  # a best-effort delete-by-name of NEG_WORKFLOW_NAME below.
  if [[ -n "$NEG_WORKFLOW_NAME" ]]; then
    NEG_WORKFLOW_LEAKED_ID="$(workflow_curl GET /workflows 2>/dev/null \
      | jq -r --arg n "$NEG_WORKFLOW_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    if [[ -n "$NEG_WORKFLOW_LEAKED_ID" ]]; then
      workflow_curl DELETE "/workflows/${NEG_WORKFLOW_LEAKED_ID}" >/dev/null 2>&1 || true
      log "deleted LEAKED negative-test workflow definition externalId=${NEG_WORKFLOW_LEAKED_ID} (regression: it should never have been created — see stage 8c)"
    fi
  fi
  if [[ -n "$NEG_CHANNEL_NAME" ]]; then
    if [[ -z "$NEG_CHANNEL_EXTERNAL_ID" ]]; then
      NEG_CHANNEL_EXTERNAL_ID="$(channel_curl GET /channels/accounts 2>/dev/null \
        | jq -r --arg n "$NEG_CHANNEL_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$NEG_CHANNEL_EXTERNAL_ID" ]]; then
      channel_curl DELETE "/channels/accounts/${NEG_CHANNEL_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted negative-test channel account externalId=${NEG_CHANNEL_EXTERNAL_ID}"
    fi
  fi
  if [[ -n "$NEG_CONNECTOR_NAME" ]]; then
    if [[ -z "$NEG_CONNECTOR_EXTERNAL_ID" ]]; then
      NEG_CONNECTOR_EXTERNAL_ID="$(connector_admin_curl GET /connectors 2>/dev/null \
        | jq -r --arg n "$NEG_CONNECTOR_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$NEG_CONNECTOR_EXTERNAL_ID" ]]; then
      connector_admin_curl DELETE "/connectors/${NEG_CONNECTOR_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted negative-test connector externalId=${NEG_CONNECTOR_EXTERNAL_ID}"
    fi
  fi

  # T05 (provisioning-manifest-gaps-4.md) — hosted-service fixture + its
  # connector, same resolve-by-name-fallback idempotent pattern as above.
  # Service teardown goes straight to registry-service (`DELETE /services/:id`
  # — this script's first direct registry-service teardown, see
  # `registry_curl` above); registry-service itself deletes the underlying
  # Knative `Service` object (`ServicesService.remove`), so no separate
  # `kubectl delete ksvc` is needed here.
  if [[ -n "$T05_SERVICE_NAME" ]]; then
    if [[ -z "$T05_SERVICE_EXTERNAL_ID" ]]; then
      T05_SERVICE_EXTERNAL_ID="$(registry_curl GET /services 2>/dev/null \
        | jq -r --arg n "$T05_SERVICE_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$T05_SERVICE_EXTERNAL_ID" ]]; then
      registry_curl DELETE "/services/${T05_SERVICE_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted T05 hosted service externalId=${T05_SERVICE_EXTERNAL_ID} (registry-service also removed its Knative ksvc '${T05_KSVC_NAME}')"
    fi
  fi

  if [[ -n "$T05_CONNECTOR_NAME" ]]; then
    if [[ -z "$T05_CONNECTOR_EXTERNAL_ID" ]]; then
      T05_CONNECTOR_EXTERNAL_ID="$(connector_admin_curl GET /connectors 2>/dev/null \
        | jq -r --arg n "$T05_CONNECTOR_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
    fi
    if [[ -n "$T05_CONNECTOR_EXTERNAL_ID" ]]; then
      connector_admin_curl DELETE "/connectors/${T05_CONNECTOR_EXTERNAL_ID}" >/dev/null 2>&1 || true
      log "deleted T05 connector externalId=${T05_CONNECTOR_EXTERNAL_ID}"
    fi
  fi

  # T05's two service-scoped secrets share ONE k8s Secret
  # (`psec-service-<serviceName>`, per `secret-resource-name.ts` — both
  # bindings' OWNER is the same service name) — same write-only-API,
  # kubectl-direct-delete pattern as the showcase driver's four secrets below.
  if [[ -n "$T05_SERVICE_NAME" ]]; then
    kubectl delete secret "$T05_SECRET_K8S_NAME" \
      -n "$T05_TENANT_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    log "deleted k8s Secret ${T05_SECRET_K8S_NAME} (namespace ${T05_TENANT_NAMESPACE})"
  fi

  # T09 + T1: the four k8s Secrets the showcase driver wrote have no delete
  # API (write-only Secret API, SPEC.md decision 4) — removed directly via
  # kubectl. Idempotent (--ignore-not-found), safe to rerun. Secret names
  # are recomputed from the SHOWCASE_SECRET_*_OWNER vars — never from a
  # value, only names/owners ever cross this script.
  if [[ -n "$SHOWCASE_SECRET_A_OWNER" ]]; then
    TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"
    kubectl delete secret "psec-channel-${SHOWCASE_SECRET_A_OWNER}" \
      -n "$TENANT_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    log "deleted k8s Secret psec-channel-${SHOWCASE_SECRET_A_OWNER} (namespace ${TENANT_NAMESPACE})"
  fi
  if [[ -n "$SHOWCASE_SECRET_B_OWNER" ]]; then
    TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"
    kubectl delete secret "psec-channel-${SHOWCASE_SECRET_B_OWNER}" \
      -n "$TENANT_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    log "deleted k8s Secret psec-channel-${SHOWCASE_SECRET_B_OWNER} (namespace ${TENANT_NAMESPACE})"
  fi
  if [[ -n "$SHOWCASE_SECRET_C_OWNER" ]]; then
    TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"
    kubectl delete secret "psec-connector-${SHOWCASE_SECRET_C_OWNER}" \
      -n "$TENANT_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    log "deleted k8s Secret psec-connector-${SHOWCASE_SECRET_C_OWNER} (namespace ${TENANT_NAMESPACE})"
  fi
  if [[ -n "$SHOWCASE_SECRET_D_OWNER" ]]; then
    TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"
    kubectl delete secret "psec-mcpserver-${SHOWCASE_SECRET_D_OWNER}" \
      -n "$TENANT_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    log "deleted k8s Secret psec-mcpserver-${SHOWCASE_SECRET_D_OWNER} (namespace ${TENANT_NAMESPACE})"
  fi

  # --- Best-effort NAME-PREFIX SWEEP (independent of driver JSON) ---------
  # The gap the JSON-driven teardown above can't cover: when
  # manifest-showcase-driver.ts (stage 8) dies BEFORE printing its final JSON
  # summary line (crash, connection failure, ctrl-c, or the
  # E2E_SIMULATE_DRIVER_DEATH=1 regression hook below), every SHOWCASE_*/
  # LIB_*/NEG_* variable above stays empty and every JSON-driven teardown
  # block above is skipped entirely — leaking every resource the driver
  # already created before it died (confirmed live incident: ~16 leaked
  # workflows plus ~20 each of channels/connectors/agents/KBs/mcpServers/
  # skills/systemVariables and 69 psec-* k8s Secrets from crashed debug
  # runs). This sweep does NOT depend on SHOWCASE_JSON at all: it re-lists
  # each admin API this script already talks to and deletes any resource
  # whose name ends with THIS run's nonce ("${NONCE}") — every e2e-created
  # resource in this script (T04-06 AND the showcase driver's) is named
  # "e2e-<kind>-${NONCE}", so matching by nonce SUFFIX uniquely scopes the
  # sweep to this run, safe to run unconditionally alongside the (now
  # redundant-but-harmless) JSON-driven deletes above.
  #
  # E2E_SWEEP_STALE=1 (opt-in, e.g. from run-all.sh or CI cleanup jobs):
  # widens the match to ANY e2e-* prefixed name, reclaiming residue from
  # PRIOR crashed runs too. Off by default here — a concurrently-running e2e
  # invocation's still-in-progress resources share the same "e2e-*" prefix,
  # so broadening the match is only safe when the caller knows nothing else
  # is running.
  # NOTE: NOT every admin list endpoint returns a bare JSON array — verified
  # live against the actual dev cluster while writing this sweep:
  #   /channels/accounts, /connectors, /admin/mcp-servers, /workflows -> `[...]`
  #   /admin/agents           -> `{ agents: [...], total }`
  #   /admin/skills           -> `{ skills: [...], total }`
  #   /admin/system-variables -> `{ variables: [...], total }`
  #   /admin/knowledge-bases  -> `{ knowledge_bases: [...] }`
  # An earlier version of this sweep assumed `.[]?` everywhere, which on the
  # wrapped-object shapes silently iterates the object's VALUES (the array
  # itself, `total`, ...) instead of its items — `.name` on a bare number
  # throws, the whole jq pipeline aborts, "names" comes back empty, and the
  # sweep silently reports every wrapped-object kind (agent/skill/
  # systemVariable/knowledgeBase) as clean even when it is NOT. Caught live:
  # a driver-death regression run leaked exactly those four kinds while this
  # sweep's log line never mentioned deleting any of them. Each call below
  # now passes the correct items-selector for its endpoint's actual shape.
  sweep_by_name() {
    local kind_label="$1" curl_fn="$2" list_path="$3" delete_path_prefix="$4" items_expr="$5"
    local list_json names name id filter
    list_json="$("${curl_fn}" GET "$list_path" 2>/dev/null || true)"
    [[ -z "$list_json" ]] && return 0
    if [[ "${E2E_SWEEP_STALE:-0}" == "1" ]]; then
      filter="[${items_expr}] | .[] | select(.name != null and (.name | startswith(\"e2e-\"))) | \"\(.name)\t\(.id)\""
      names="$(echo "$list_json" | jq -r "$filter" 2>/dev/null || true)"
    else
      filter="[${items_expr}] | .[] | select(.name != null and (.name | endswith(\$n))) | \"\(.name)\t\(.id)\""
      names="$(echo "$list_json" | jq -r --arg n "$NONCE" "$filter" 2>/dev/null || true)"
    fi
    [[ -z "$names" ]] && return 0
    while IFS=$'\t' read -r name id; do
      [[ -z "$name" || -z "$id" ]] && continue
      "${curl_fn}" DELETE "${delete_path_prefix}${id}" >/dev/null 2>&1 || true
      log "sweep: deleted ${kind_label} name='${name}' externalId=${id}"
    done <<< "$names"
  }

  log "Cleanup sweep: name-prefix residue check across every e2e admin API (independent of driver JSON availability)$( [[ "${E2E_SWEEP_STALE:-0}" == "1" ]] && echo ' [E2E_SWEEP_STALE=1: sweeping ALL e2e-* residue, not just this run]' )"
  sweep_by_name "channel account"     channel_curl         "/channels/accounts"       "/channels/accounts/"       ".[]?"
  sweep_by_name "connector"           connector_admin_curl "/connectors"              "/connectors/"              ".[]?"
  sweep_by_name "mcpServer"           agent_admin_curl     "/admin/mcp-servers"       "/admin/mcp-servers/"       ".[]?"
  sweep_by_name "skill"               agent_admin_curl     "/admin/skills"            "/admin/skills/"            ".skills[]?"
  sweep_by_name "systemVariable"      agent_admin_curl     "/admin/system-variables"  "/admin/system-variables/"  ".variables[]?"
  sweep_by_name "agent"               agent_admin_curl     "/admin/agents"            "/admin/agents/"            ".agents[]?"
  sweep_by_name "knowledge base"      agent_admin_curl     "/admin/knowledge-bases"   "/admin/knowledge-bases/"   ".knowledge_bases[]?"
  sweep_by_name "workflow definition" workflow_curl        "/workflows"               "/workflows/"               ".[]?"
  # T05 (provisioning-manifest-gaps-4.md) — registry-service's own list shape
  # is a bare array (`ServicesService.list` -> `IRegisteredService[]`, no
  # wrapper object, verified against `services.controller.ts`/
  # `services.service.ts`), so this is the SAME `.[]?` items-selector as the
  # channel/connector/mcpServer/workflow rows above.
  sweep_by_name "hosted service"      registry_curl        "/services"                "/services/"                ".[]?"

  # k8s Secrets: named `psec-<kind>-<owner>` where <owner> is the e2e-prefixed
  # resource NAME it's bound to (see secret-resource-name.ts) — every owner
  # name ends with this run's nonce, so a Secret name ending with the nonce
  # (or, under --sweep-stale, any psec-*-e2e-* secret) is this run's residue.
  # Sweeps by Secret NAME directly since a driver crash before its JSON means
  # SHOWCASE_SECRET_*_OWNER above is never populated.
  SWEEP_TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"
  SWEEP_SECRET_NAMES="$(kubectl get secrets -n "$SWEEP_TENANT_NAMESPACE" \
    -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$SWEEP_SECRET_NAMES" ]]; then
    for secret_name in $SWEEP_SECRET_NAMES; do
      case "$secret_name" in
        psec-*)
          if { [[ "${E2E_SWEEP_STALE:-0}" == "1" ]] && [[ "$secret_name" == psec-*-e2e-* ]]; } \
             || [[ "$secret_name" == *"-${NONCE}" ]]; then
            kubectl delete secret "$secret_name" -n "$SWEEP_TENANT_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
            log "sweep: deleted k8s Secret ${secret_name} (namespace ${SWEEP_TENANT_NAMESPACE})"
          fi
          ;;
      esac
    done
  fi

  if [[ $status -eq 0 ]]; then
    log "e2e-manifest-apply: PASSED"
  else
    err "e2e-manifest-apply: FAILED (exit=$status)"
  fi
  exit "$status"
}
trap cleanup EXIT

# --- 0. reachability -----------------------------------------------------

log "Targeting provisioning-service at ${PROVISIONING_URL} (Host: ${PROVISIONING_HOST})"
wait_for_health prov
wait_for_health channel
wait_for_health workflow
wait_for_health agent_admin
wait_for_health connector_admin
wait_for_health registry

# --- 1. PUT the minimal manifest ----------------------------------------

MANIFEST_JSON="$(jq -n \
  --arg name "$MANIFEST_NAME" \
  --arg channel "$CHANNEL_NAME" \
  --arg workflow "$WORKFLOW_NAME" \
  '{
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: $name },
    spec: {
      channels: [
        { name: $channel, type: "http", direction: "inbound" }
      ],
      connectors: [],
      agents: [],
      knowledgeBases: [],
      services: [],
      workflows: [
        {
          name: $workflow,
          definition: {
            application: $name,
            actions: [
              {
                activity: "jsFunction",
                name: "log-e2e-nonce",
                args: { code: "(ctx) => ({ ok: true })" }
              }
            ]
          }
        }
      ],
      secrets: []
    }
  }')"

log "PUT /manifests/${MANIFEST_NAME}"
prov_curl PUT "/manifests/${MANIFEST_NAME}" \
  -H "content-type: application/json" \
  -d "$MANIFEST_JSON" | jq -e '.revision == 1' >/dev/null \
  || { err "manifest PUT did not return revision 1"; exit 1; }

# --- 2. first plan: both resources must be 'create' ---------------------

log "POST /manifests/${MANIFEST_NAME}/plan (expect all-create)"
FIRST_PLAN="$(prov_curl POST "/manifests/${MANIFEST_NAME}/plan")"

FIRST_VERDICTS="$(echo "$FIRST_PLAN" | jq -r '.resources[].verdict' | sort -u)"
if [[ "$FIRST_VERDICTS" != "create" ]]; then
  err "expected all-create plan, got verdicts: ${FIRST_VERDICTS}"
  echo "$FIRST_PLAN" | jq .
  exit 1
fi
log "first plan: all resources verdict=create (OK)"

# --- 3. first apply: both resources applied ------------------------------

log "POST /manifests/${MANIFEST_NAME}/apply (expect appliedCount=2)"
FIRST_APPLY="$(prov_curl POST "/manifests/${MANIFEST_NAME}/apply")"

APPLIED_COUNT="$(echo "$FIRST_APPLY" | jq -r '.appliedCount')"
if [[ "$APPLIED_COUNT" != "2" ]]; then
  err "expected appliedCount=2, got: ${APPLIED_COUNT}"
  echo "$FIRST_APPLY" | jq .
  exit 1
fi
log "first apply: appliedCount=2 (OK)"

CHANNEL_EXTERNAL_ID="$(echo "$FIRST_APPLY" | jq -r --arg n "$CHANNEL_NAME" '.resources[] | select(.name == $n) | .externalId')"
WORKFLOW_EXTERNAL_ID="$(echo "$FIRST_APPLY" | jq -r --arg n "$WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
log "created channel externalId=${CHANNEL_EXTERNAL_ID} workflow externalId=${WORKFLOW_EXTERNAL_ID}"

# --- 4. second plan: both resources must be 'noop' (idempotent) ---------

log "POST /manifests/${MANIFEST_NAME}/plan again (expect all-noop)"
SECOND_PLAN="$(prov_curl POST "/manifests/${MANIFEST_NAME}/plan")"

SECOND_VERDICTS="$(echo "$SECOND_PLAN" | jq -r '.resources[].verdict' | sort -u)"
if [[ "$SECOND_VERDICTS" != "noop" ]]; then
  err "expected all-noop plan on re-plan, got verdicts: ${SECOND_VERDICTS}"
  echo "$SECOND_PLAN" | jq .
  exit 1
fi
log "second plan: all resources verdict=noop (OK — converged)"

# --- 5. second apply: no-op (appliedCount=0) ----------------------------

log "POST /manifests/${MANIFEST_NAME}/apply again (expect appliedCount=0)"
SECOND_APPLY="$(prov_curl POST "/manifests/${MANIFEST_NAME}/apply")"

SECOND_APPLIED_COUNT="$(echo "$SECOND_APPLY" | jq -r '.appliedCount')"
SECOND_NOOP_COUNT="$(echo "$SECOND_APPLY" | jq -r '.noopCount')"
if [[ "$SECOND_APPLIED_COUNT" != "0" || "$SECOND_NOOP_COUNT" != "2" ]]; then
  err "expected second apply to be a no-op (appliedCount=0 noopCount=2), got appliedCount=${SECOND_APPLIED_COUNT} noopCount=${SECOND_NOOP_COUNT}"
  echo "$SECOND_APPLY" | jq .
  exit 1
fi
log "second apply: no-op (appliedCount=0, noopCount=2) — idempotent apply verified (OK)"

# --- 6. T06: add a knowledgeBases section (inline + file sources) --------

BUNDLE_DIR="$(mktemp -d)"
FILE_DOC_CONTENT="e2e file-sourced KB document — ${NONCE}"
printf '%s' "$FILE_DOC_CONTENT" > "${BUNDLE_DIR}/manual.txt"
FILE_DOC_SHA256="$(shasum -a 256 "${BUNDLE_DIR}/manual.txt" | awk '{print $1}')"
TAR_BASE64="$(tar -cf - -C "$BUNDLE_DIR" manual.txt | base64 | tr -d '\n')"

INLINE_DOC_CONTENT_V1="e2e inline KB document, version 1 — ${NONCE}"

manifest_with_kb() {
  local inline_content="$1"
  jq -n \
    --arg name "$MANIFEST_NAME" \
    --arg channel "$CHANNEL_NAME" \
    --arg workflow "$WORKFLOW_NAME" \
    --arg kb "$KB_NAME" \
    --arg inlineContent "$inline_content" \
    --arg fileSha "$FILE_DOC_SHA256" \
    '{
      apiVersion: "yoizen.io/v1",
      kind: "IntegrationManifest",
      metadata: { name: $name },
      spec: {
        channels: [
          { name: $channel, type: "http", direction: "inbound" }
        ],
        connectors: [],
        agents: [],
        knowledgeBases: [
          {
            name: $kb,
            documents: [
              { name: "faq", source: { type: "inline", content: $inlineContent } },
              { name: "manual", source: { type: "file", path: "manual.txt", sha256: $fileSha } }
            ]
          }
        ],
        services: [],
        workflows: [
          {
            name: $workflow,
            definition: {
              application: $name,
              actions: [
                {
                  activity: "jsFunction",
                  name: "log-e2e-nonce",
                  args: { code: "(ctx) => ({ ok: true })" }
                }
              ]
            }
          }
        ],
        secrets: []
      }
    }'
}

log "PUT /manifests/${MANIFEST_NAME} (revision 2 — adds knowledgeBases)"
manifest_with_kb "$INLINE_DOC_CONTENT_V1" > "${BUNDLE_DIR}/manifest.json"
prov_curl PUT "/manifests/${MANIFEST_NAME}" \
  -H "content-type: application/json" \
  --data-binary @"${BUNDLE_DIR}/manifest.json" | jq -e '.revision == 2' >/dev/null \
  || { err "manifest PUT (with KB) did not return revision 2"; exit 1; }

log "POST /manifests/${MANIFEST_NAME}/plan (expect 2 documents to embed — both never-applied)"
KB_FIRST_PLAN="$(prov_curl POST "/manifests/${MANIFEST_NAME}/plan")"
KB_FIRST_REEMBED="$(echo "$KB_FIRST_PLAN" | jq -r '.knowledgeBases[0].reembedCount')"
if [[ "$KB_FIRST_REEMBED" != "2" ]]; then
  err "expected plan.knowledgeBases[0].reembedCount == 2, got: ${KB_FIRST_REEMBED}"
  echo "$KB_FIRST_PLAN" | jq .
  exit 1
fi
log "first KB plan: reembedCount=2 (OK — both documents never applied before)"

log "POST /manifests/${MANIFEST_NAME}/apply with bundle (expect 2 documents create'd)"
KB_FIRST_APPLY_BODY="$(jq -n --arg b "$TAR_BASE64" '{ bundle: { contentBase64: $b } }')"
KB_FIRST_APPLY="$(prov_curl POST "/manifests/${MANIFEST_NAME}/apply" \
  -H "content-type: application/json" -d "$KB_FIRST_APPLY_BODY")"

KB_FIRST_APPLY_ACTIONS="$(echo "$KB_FIRST_APPLY" | jq -r '.knowledgeBases[0].documents[].action' | sort -u)"
if [[ "$KB_FIRST_APPLY_ACTIONS" != "create" ]]; then
  err "expected both KB documents action=create on first apply, got: ${KB_FIRST_APPLY_ACTIONS}"
  echo "$KB_FIRST_APPLY" | jq .
  exit 1
fi
KB_EXTERNAL_ID="$(echo "$KB_FIRST_APPLY" | jq -r '.knowledgeBases[0].kbExternalId')"
log "first KB apply: both documents created, kb externalId=${KB_EXTERNAL_ID} (OK)"

# --- 7. re-apply with ONE changed document: exactly one re-embed ---------

INLINE_DOC_CONTENT_V2="e2e inline KB document, version 2 (CHANGED) — ${NONCE}"
manifest_with_kb "$INLINE_DOC_CONTENT_V2" > "${BUNDLE_DIR}/manifest-v2.json"
prov_curl PUT "/manifests/${MANIFEST_NAME}" \
  -H "content-type: application/json" \
  --data-binary @"${BUNDLE_DIR}/manifest-v2.json" | jq -e '.revision == 3' >/dev/null \
  || { err "manifest PUT (changed doc) did not return revision 3"; exit 1; }

log "POST /manifests/${MANIFEST_NAME}/plan (expect exactly 1 document to re-embed)"
KB_SECOND_PLAN="$(prov_curl POST "/manifests/${MANIFEST_NAME}/plan")"
KB_SECOND_REEMBED="$(echo "$KB_SECOND_PLAN" | jq -r '.knowledgeBases[0].reembedCount')"
if [[ "$KB_SECOND_REEMBED" != "1" ]]; then
  err "expected plan.knowledgeBases[0].reembedCount == 1 after changing one document, got: ${KB_SECOND_REEMBED}"
  echo "$KB_SECOND_PLAN" | jq .
  exit 1
fi
KB_SECOND_PLAN_ACTIONS="$(echo "$KB_SECOND_PLAN" | jq -r '.knowledgeBases[0].documents[] | "\(.documentName)=\(.action)"')"
log "second KB plan: reembedCount=1 (OK — unchanged document stays skip): ${KB_SECOND_PLAN_ACTIONS}"

log "POST /manifests/${MANIFEST_NAME}/apply with bundle (expect exactly 1 document reembed'd)"
KB_SECOND_APPLY_BODY="$(jq -n --arg b "$TAR_BASE64" '{ bundle: { contentBase64: $b } }')"
KB_SECOND_APPLY="$(prov_curl POST "/manifests/${MANIFEST_NAME}/apply" \
  -H "content-type: application/json" -d "$KB_SECOND_APPLY_BODY")"

KB_REEMBED_COUNT="$(echo "$KB_SECOND_APPLY" | jq -r '[.knowledgeBases[0].documents[] | select(.action == "reembed")] | length')"
KB_SKIP_COUNT="$(echo "$KB_SECOND_APPLY" | jq -r '[.knowledgeBases[0].documents[] | select(.action == "skip")] | length')"
if [[ "$KB_REEMBED_COUNT" != "1" || "$KB_SKIP_COUNT" != "1" ]]; then
  err "expected exactly one reembed and one skip on second apply, got reembed=${KB_REEMBED_COUNT} skip=${KB_SKIP_COUNT}"
  echo "$KB_SECOND_APPLY" | jq .
  exit 1
fi
log "second KB apply: exactly 1 document re-embedded, 1 unchanged (skip) — checksum reconciliation verified (OK)"

# --- 8. T09 + T1: full showcase manifest, applied via the SDK -------------

log "Stage 8 (T09 + T1 coverage pass): full showcase manifest — applied via the real SDK driver"

command -v bun >/dev/null 2>&1 || { err "bun not found in PATH — required for the T09/T1 SDK driver"; exit 1; }

E2E_EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
E2E_PASSWORD="${E2E_PASSWORD:-admin123}"

SHOWCASE_DRIVER_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/manifest-showcase-driver.ts"
SHOWCASE_WALL_START=$SECONDS
if ! SHOWCASE_JSON="$(
  E2E_NONCE="$NONCE" \
  E2E_TENANT="$TENANT" \
  E2E_EMAIL="$E2E_EMAIL" \
  E2E_PASSWORD="$E2E_PASSWORD" \
  E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}" \
  E2E_DIE_AFTER_APPLY="${E2E_SIMULATE_DRIVER_DEATH:-0}" \
  bun run "$SHOWCASE_DRIVER_PATH"
)"; then
  err "T09 showcase driver FAILED (see stderr above for the failed assertion)"
  exit 1
fi
SHOWCASE_WALL_ELAPSED_S=$((SECONDS - SHOWCASE_WALL_START))
log "T09 showcase driver completed in ~${SHOWCASE_WALL_ELAPSED_S}s wall time"

echo "$SHOWCASE_JSON" | jq -e '.ok == true' >/dev/null \
  || { err "T09 showcase driver did not report ok:true"; echo "$SHOWCASE_JSON" | jq .; exit 1; }

SHOWCASE_MANIFEST_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.manifestName')"
SHOWCASE_CHANNEL_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.channelName')"
SHOWCASE_CONNECTOR_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.connectorName')"
SHOWCASE_MCP_SERVER_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.mcpServerName')"
SHOWCASE_SKILL_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.skillName')"
SHOWCASE_SYSTEM_VARIABLE_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.systemVariableName')"
SHOWCASE_AGENT_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.agentName')"
SHOWCASE_WORKFLOW_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.workflowName')"
SHOWCASE_KB_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.kbName')"
SHOWCASE_CHANNEL_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.channelExternalId // empty')"
SHOWCASE_CONNECTOR_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.connectorExternalId // empty')"
SHOWCASE_MCP_SERVER_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.mcpServerExternalId // empty')"
SHOWCASE_SKILL_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.skillExternalId // empty')"
SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.systemVariableExternalId // empty')"
SHOWCASE_AGENT_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.agentExternalId // empty')"
SHOWCASE_WORKFLOW_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.workflowExternalId // empty')"
SHOWCASE_KB_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.kbExternalId // empty')"
SHOWCASE_SECRET_A_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.secretAName')"
SHOWCASE_SECRET_A_OWNER="$(echo "$SHOWCASE_JSON" | jq -r '.secretAOwner')"
SHOWCASE_SECRET_B_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.secretBName')"
SHOWCASE_SECRET_B_OWNER="$(echo "$SHOWCASE_JSON" | jq -r '.secretBOwner')"
SHOWCASE_SECRET_C_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.secretCName')"
SHOWCASE_SECRET_C_OWNER="$(echo "$SHOWCASE_JSON" | jq -r '.secretCOwner')"
SHOWCASE_SECRET_D_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.secretDName')"
SHOWCASE_SECRET_D_OWNER="$(echo "$SHOWCASE_JSON" | jq -r '.secretDOwner')"
SHOWCASE_DENY_CORRELATION_ID="$(echo "$SHOWCASE_JSON" | jq -r '.denyCorrelationId')"
LIB_MANIFEST_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.libraryManifest.manifestName')"
LIB_CONNECTOR_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.libraryManifest.connectorName')"
LIB_CONNECTOR_EXTERNAL_ID="$(echo "$SHOWCASE_JSON" | jq -r '.libraryManifest.connectorExternalId // empty')"
NEG_MANIFEST_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.negativeManifest.manifestName')"
NEG_CHANNEL_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.negativeManifest.channelName')"
NEG_CONNECTOR_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.negativeManifest.connectorName')"
NEG_WORKFLOW_NAME="$(echo "$SHOWCASE_JSON" | jq -r '.negativeManifest.workflowName')"

log "showcase manifest='${SHOWCASE_MANIFEST_NAME}': channel externalId=${SHOWCASE_CHANNEL_EXTERNAL_ID} connector externalId=${SHOWCASE_CONNECTOR_EXTERNAL_ID} mcpServer externalId=${SHOWCASE_MCP_SERVER_EXTERNAL_ID} skill externalId=${SHOWCASE_SKILL_EXTERNAL_ID} systemVariable externalId=${SHOWCASE_SYSTEM_VARIABLE_EXTERNAL_ID} agent externalId=${SHOWCASE_AGENT_EXTERNAL_ID} workflow externalId=${SHOWCASE_WORKFLOW_EXTERNAL_ID} kb externalId=${SHOWCASE_KB_EXTERNAL_ID}"
log "showcase secrets (names/bindings only, value never logged): '${SHOWCASE_SECRET_A_NAME}' bound to channel/${SHOWCASE_SECRET_A_OWNER}; '${SHOWCASE_SECRET_B_NAME}' bound to channel/${SHOWCASE_SECRET_B_OWNER}; '${SHOWCASE_SECRET_C_NAME}' bound to connector/${SHOWCASE_SECRET_C_OWNER}; '${SHOWCASE_SECRET_D_NAME}' bound to mcpServer/${SHOWCASE_SECRET_D_OWNER}"
log "T09 negative broker test: httpStatus=$(echo "$SHOWCASE_JSON" | jq -r '.negativeBroker.httpStatus') ok=$(echo "$SHOWCASE_JSON" | jq -r '.negativeBroker.ok') errorKind=$(echo "$SHOWCASE_JSON" | jq -r '.negativeBroker.errorKind') (expected ok=false errorKind=binding_mismatch)"
log "ROUND 2 (LibraryManifest) '${LIB_MANIFEST_NAME}': connector '${LIB_CONNECTOR_NAME}' externalId=${LIB_CONNECTOR_EXTERNAL_ID}"
log "ROUND 3 (negative-test manifest) '${NEG_MANIFEST_NAME}': results=$(echo "$SHOWCASE_JSON" | jq -c '.negativeManifest.results')"

log "T09/T1 runtime numbers (feed the demo narrative):"
echo "$SHOWCASE_JSON" | jq -r '
  "  first plan latency:    \(.firstPlan.latencyMs)ms",
  "  first apply latency:   \(.firstApply.latencyMs)ms (server durationMs=\(.firstApply.durationMs)ms, appliedCount=\(.firstApply.appliedCount))",
  "  second plan latency:   \(.secondPlan.latencyMs)ms",
  "  second apply latency:  \(.secondApply.latencyMs)ms (server durationMs=\(.secondApply.durationMs)ms, noopCount=\(.secondApply.noopCount))"
'

# --- 8b. post-apply workflow-definition substitution check ---------------
# Fetches the CREATED workflow's stored definition (workflow-service is the
# ONE service the driver has no direct wiring to talk to — see the driver's
# header comment) and asserts it carries REAL ids for `accountIds`/
# `adapterId`, never the symbolic `channelRef`/`connectorRef` strings the
# manifest declared — proving the apply engine's scalar AND array
# symbolic-ref substitution both actually ran before workflow-service ever
# saw this definition.

log "Stage 8b: fetching created workflow definition -> asserting real UUIDs, no symbolic refs remain"
SHOWCASE_WORKFLOW_DEFINITION="$(workflow_curl GET "/workflows/${SHOWCASE_WORKFLOW_EXTERNAL_ID}")"

# Scoped to the TWO fields the apply engine actually substitutes
# (`trigger.config.accountIds` — ARRAY channelRef substitution;
# `actions[].args.adapterId` — SCALAR connectorRef substitution). NOT a
# whole-document grep for the strings "channelRef"/"connectorRef": this
# workflow's `definition.variables.channelRef`/`.agentRef` are a SEPARATE,
# deliberately-unsubstituted NAME-keyed wiring field (see the driver's
# manifest comment) — a plain `{ channelRef: "<name>" }` STRING value, not
# the `{ channelRef: <name> }` ref-OBJECT shape the substitution walker
# recognizes, so it legitimately keeps the symbolic name verbatim.
SUBSTITUTED_FIELDS_JSON="$(echo "$SHOWCASE_WORKFLOW_DEFINITION" | jq -c '{accountIds: .trigger.config.accountIds, adapterId: ([.actions[] | select(.activity == "endpointCall")][0].args.adapterId // empty)}')"
if echo "$SUBSTITUTED_FIELDS_JSON" | grep -qE 'channelRef|connectorRef'; then
  err "expected trigger.config.accountIds/endpointCall.args.adapterId to carry NO symbolic ref strings (channelRef/connectorRef), found one in: ${SUBSTITUTED_FIELDS_JSON}"
  exit 1
fi

STORED_ACCOUNT_ID="$(echo "$SHOWCASE_WORKFLOW_DEFINITION" | jq -r '.trigger.config.accountIds[0] // empty')"
STORED_ADAPTER_ID="$(echo "$SHOWCASE_WORKFLOW_DEFINITION" | jq -r '[.actions[] | select(.activity == "endpointCall")][0].args.adapterId // empty')"
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

if [[ ! "$STORED_ACCOUNT_ID" =~ $UUID_RE ]]; then
  err "expected trigger.config.accountIds[0] to be a real UUID (channelRef substituted), got: '${STORED_ACCOUNT_ID}'"
  echo "$SHOWCASE_WORKFLOW_DEFINITION" | jq .
  exit 1
fi
if [[ ! "$STORED_ADAPTER_ID" =~ $UUID_RE ]]; then
  err "expected the endpointCall action's args.adapterId to be a real UUID (connectorRef substituted), got: '${STORED_ADAPTER_ID}'"
  echo "$SHOWCASE_WORKFLOW_DEFINITION" | jq .
  exit 1
fi
log "stored workflow definition: accountIds[0]='${STORED_ACCOUNT_ID}' adapterId='${STORED_ADAPTER_ID}' — both real UUIDs, no symbolic ref strings remain (OK)"

# --- 8c. ROUND 3 negative-manifest workflow ABSENCE check ----------------
# The driver's three ROUND 3 negative revisions each embed a deliberately
# broken symbolic ref in NEG_WORKFLOW_NAME's definition; the apply engine
# must fail-loud DURING substitution, BEFORE the workflow writer ever runs
# (RESOURCE_KIND_ORDER ranks "workflow" last). This is the independent
# assertion of that invariant the driver itself cannot make (it has no
# workflow-service wiring): a REAL name lookup against workflow-service. A
# regression that let the broken workflow reach the writer would BOTH pass
# the driver's error-kind assertions AND leak an untorn-down workflow — this
# check catches exactly that. Mirrors the resolve-by-name pattern cleanup()
# uses for NEG_CHANNEL_EXTERNAL_ID/LIB_CONNECTOR_EXTERNAL_ID.
log "Stage 8c: asserting the negative-test workflow '${NEG_WORKFLOW_NAME}' was NEVER created (broken ref must fail before the writer)"
NEG_WORKFLOW_LEAKED_ID="$(workflow_curl GET /workflows 2>/dev/null \
  | jq -r --arg n "$NEG_WORKFLOW_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
if [[ -n "$NEG_WORKFLOW_LEAKED_ID" ]]; then
  err "expected NO workflow named '${NEG_WORKFLOW_NAME}' to exist (every ROUND 3 apply must fail during substitution, before the workflow writer), but found one: externalId=${NEG_WORKFLOW_LEAKED_ID}"
  exit 1
fi
log "Stage 8c: no workflow named '${NEG_WORKFLOW_NAME}' exists — broken refs fail before the writer, nothing leaked (OK)"

# --- 8a. tracking-ingester assertions (async NATS ingestion, so polled) ---

tracking_count_apply_events() {
  local kind="$1"
  kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
    psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
    "select count(*) from tracking.tracked_events where kind = '${kind}' and envelope->'data'->'payload'->>'manifestName' = '${SHOWCASE_MANIFEST_NAME}';" \
    2>/dev/null
}

tracking_count_secret_denied() {
  kubectl exec -n "$TRACKING_PG_NAMESPACE" "$TRACKING_PG_POD" -- \
    psql -U "$TRACKING_PG_USER" -d "$TRACKING_PG_DB" -Atc \
    "select count(*) from tracking.tracked_events where kind = 'secret_access_denied' and correlation_id = '${SHOWCASE_DENY_CORRELATION_ID}';" \
    2>/dev/null
}

log "Stage 8a: polling tracking.tracked_events for this run's apply_* and secret_access_denied audit events (timeout ${POLL_TIMEOUT_S}s)"
TRACKING_DEADLINE=$((SECONDS + POLL_TIMEOUT_S))
APPLY_STARTED_COUNT=0
RESOURCE_APPLIED_COUNT=0
APPLY_COMPLETED_COUNT=0
SECRET_DENIED_COUNT=0
while (( SECONDS < TRACKING_DEADLINE )); do
  APPLY_STARTED_COUNT="$(tracking_count_apply_events apply_started || echo 0)"
  RESOURCE_APPLIED_COUNT="$(tracking_count_apply_events resource_applied || echo 0)"
  APPLY_COMPLETED_COUNT="$(tracking_count_apply_events apply_completed || echo 0)"
  SECRET_DENIED_COUNT="$(tracking_count_secret_denied || echo 0)"
  if [[ "${APPLY_STARTED_COUNT:-0}" -ge 1 && "${RESOURCE_APPLIED_COUNT:-0}" -ge 7 \
        && "${APPLY_COMPLETED_COUNT:-0}" -ge 1 && "${SECRET_DENIED_COUNT:-0}" -ge 1 ]]; then
    break
  fi
  sleep 3
done

log "tracking.tracked_events counts for manifest='${SHOWCASE_MANIFEST_NAME}': apply_started=${APPLY_STARTED_COUNT:-0} resource_applied=${RESOURCE_APPLIED_COUNT:-0} apply_completed=${APPLY_COMPLETED_COUNT:-0}; secret_access_denied (correlation_id=${SHOWCASE_DENY_CORRELATION_ID})=${SECRET_DENIED_COUNT:-0}"

if [[ "${APPLY_STARTED_COUNT:-0}" -lt 1 ]]; then
  err "expected at least 1 apply_started event for manifest='${SHOWCASE_MANIFEST_NAME}' in tracking.tracked_events, got ${APPLY_STARTED_COUNT:-0}"
  exit 1
fi
if [[ "${RESOURCE_APPLIED_COUNT:-0}" -lt 7 ]]; then
  err "expected at least 7 resource_applied events (channel/connector/mcpServer/skill/agent/systemVariable/workflow) for manifest='${SHOWCASE_MANIFEST_NAME}', got ${RESOURCE_APPLIED_COUNT:-0}"
  exit 1
fi
if [[ "${APPLY_COMPLETED_COUNT:-0}" -lt 1 ]]; then
  err "expected at least 1 apply_completed event for manifest='${SHOWCASE_MANIFEST_NAME}', got ${APPLY_COMPLETED_COUNT:-0}"
  exit 1
fi
if [[ "${SECRET_DENIED_COUNT:-0}" -lt 1 ]]; then
  err "expected at least 1 secret_access_denied event with correlation_id='${SHOWCASE_DENY_CORRELATION_ID}', got ${SECRET_DENIED_COUNT:-0}"
  exit 1
fi
log "T09: audit events confirmed present in tracking.tracked_events (OK) — full showcase round trip verified"

# --- 9. T05 (provisioning-manifest-gaps-4.md): the exact crm-support-        -
#        telegram T04 use case, live -----------------------------------------
#
# A `kind: LibraryManifest` (no channel/workflow needed — services.forEach
# in validate-structural-rules.ts and RESOURCE_KIND_ORDER apply the same way
# regardless of manifest kind) declaring, in the SAME apply:
#   - ONE connector with 3 real endpoints (HubSpot-shaped, never actually
#     invoked — only their (method,path) identity matters for this test).
#   - ONE hosted service whose `env[]` is the EXACT 6-entry shape T04 exists
#     for: YOIZEN_EMAIL/YOIZEN_PASSWORD as `{ secretRef }` (2),
#     HUBSPOT_CONNECTOR_ID as `{ connectorRef }` (1), and
#     HUBSPOT_DEALS_ENDPOINT_ID/HUBSPOT_TICKETS_ENDPOINT_ID/
#     HUBSPOT_CREATE_TICKET_ENDPOINT_ID as `{ connectorRef, endpointMethod,
#     endpointPath }` (3), matched against the connector declared above.
#
# The two secret bindings are written via `PUT /secrets/:name` directly on
# provisioning-service (human-provided throwaway test values — see the
# REQUIRED, NO DEFAULT doc block at the top of this file — never real
# credentials, never printed anywhere below, never passed as a `curl`/`jq`
# argv argument either: `jq` reads them straight out of its own process
# environment via `env.VARNAME`, so they never appear in `ps`/argv) BEFORE
# the manifest apply — same write-only-API convention `client.secrets.set()`
# uses in the T09 driver, just over raw curl since this stage has no SDK
# dependency.

log "Stage 9 (T05, provisioning-manifest-gaps-4.md): live verification of the exact crm-support-telegram T04 env[] shape"

if [[ -z "${E2E_T05_SECRET_EMAIL_VALUE:-}" || -z "${E2E_T05_SECRET_PASSWORD_VALUE:-}" ]]; then
  err "T05 requires E2E_T05_SECRET_EMAIL_VALUE and E2E_T05_SECRET_PASSWORD_VALUE set in the environment (human-provided throwaway test values — manual-loops/provisioning-manifest-gaps-4.md's Human boundaries: 'T05's live-verification env values are loaded by the human ... never fabricated in the repo'). Set both (e.g. in scripts/e2e/.env, auto-loaded above) and re-run — this script never invents a value for either."
  exit 1
fi

log "PUT /secrets/${T05_SECRET_EMAIL_NAME} scope=service/${T05_SERVICE_NAME} (value never logged, never passed via argv)"
prov_curl PUT "/secrets/${T05_SECRET_EMAIL_NAME}" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg owner "$T05_SERVICE_NAME" \
    '{value: env.E2E_T05_SECRET_EMAIL_VALUE, scope: {kind: "service", owner: $owner}}')" >/dev/null

log "PUT /secrets/${T05_SECRET_PASSWORD_NAME} scope=service/${T05_SERVICE_NAME} (value never logged, never passed via argv)"
prov_curl PUT "/secrets/${T05_SECRET_PASSWORD_NAME}" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg owner "$T05_SERVICE_NAME" \
    '{value: env.E2E_T05_SECRET_PASSWORD_VALUE, scope: {kind: "service", owner: $owner}}')" >/dev/null

T05_CONNECTOR_BASE_URL="http://connector-admin-api.platform-services-dev.svc.cluster.local"
T05_DEALS_PATH="/crm/v3/objects/deals"
T05_TICKETS_PATH="/crm/v3/objects/tickets"

T05_MANIFEST_JSON="$(jq -n \
  --arg name "$T05_MANIFEST_NAME" \
  --arg connector "$T05_CONNECTOR_NAME" \
  --arg service "$T05_SERVICE_NAME" \
  --arg secretEmail "$T05_SECRET_EMAIL_NAME" \
  --arg secretPassword "$T05_SECRET_PASSWORD_NAME" \
  --arg baseUrl "$T05_CONNECTOR_BASE_URL" \
  --arg dealsPath "$T05_DEALS_PATH" \
  --arg ticketsPath "$T05_TICKETS_PATH" \
  '{
    apiVersion: "yoizen.io/v1",
    kind: "LibraryManifest",
    metadata: { name: $name },
    spec: {
      connectors: [
        {
          name: $connector,
          type: "http",
          config: { baseUrl: $baseUrl, context: "external" },
          endpoints: [
            { label: "hubspot deals", method: "GET", path: $dealsPath },
            { label: "hubspot tickets", method: "GET", path: $ticketsPath },
            { label: "hubspot create ticket", method: "POST", path: $ticketsPath }
          ]
        }
      ],
      services: [
        {
          name: $service,
          image: "ealen/echo-server:latest",
          port: 8080,
          minScale: 1,
          maxScale: 1,
          concurrencyTarget: 10,
          env: [
            { name: "YOIZEN_EMAIL", value: { secretRef: $secretEmail } },
            { name: "YOIZEN_PASSWORD", value: { secretRef: $secretPassword } },
            { name: "HUBSPOT_CONNECTOR_ID", value: { connectorRef: $connector } },
            { name: "HUBSPOT_DEALS_ENDPOINT_ID", value: { connectorRef: $connector, endpointMethod: "GET", endpointPath: $dealsPath } },
            { name: "HUBSPOT_TICKETS_ENDPOINT_ID", value: { connectorRef: $connector, endpointMethod: "GET", endpointPath: $ticketsPath } },
            { name: "HUBSPOT_CREATE_TICKET_ENDPOINT_ID", value: { connectorRef: $connector, endpointMethod: "POST", endpointPath: $ticketsPath } }
          ]
        }
      ],
      secrets: [
        { name: $secretEmail, scope: { kind: "service", owner: $service } },
        { name: $secretPassword, scope: { kind: "service", owner: $service } }
      ]
    }
  }')"

log "PUT /manifests/${T05_MANIFEST_NAME}"
prov_curl PUT "/manifests/${T05_MANIFEST_NAME}" \
  -H "content-type: application/json" \
  -d "$T05_MANIFEST_JSON" | jq -e '.revision == 1' >/dev/null \
  || { err "T05 manifest PUT did not return revision 1"; exit 1; }

log "POST /manifests/${T05_MANIFEST_NAME}/plan (expect both resources verdict=create)"
T05_FIRST_PLAN="$(prov_curl POST "/manifests/${T05_MANIFEST_NAME}/plan")"
T05_FIRST_VERDICTS="$(echo "$T05_FIRST_PLAN" | jq -r '.resources[].verdict' | sort -u)"
if [[ "$T05_FIRST_VERDICTS" != "create" ]]; then
  err "T05: expected all-create plan, got verdicts: ${T05_FIRST_VERDICTS}"
  echo "$T05_FIRST_PLAN" | jq .
  exit 1
fi
log "T05 first plan: all resources verdict=create (OK)"

log "POST /manifests/${T05_MANIFEST_NAME}/apply (expect appliedCount=2)"
T05_FIRST_APPLY="$(prov_curl POST "/manifests/${T05_MANIFEST_NAME}/apply")"
T05_APPLIED_COUNT="$(echo "$T05_FIRST_APPLY" | jq -r '.appliedCount')"
if [[ "$T05_APPLIED_COUNT" != "2" ]]; then
  err "T05: expected appliedCount=2, got: ${T05_APPLIED_COUNT}"
  echo "$T05_FIRST_APPLY" | jq .
  exit 1
fi
T05_CONNECTOR_EXTERNAL_ID="$(echo "$T05_FIRST_APPLY" | jq -r --arg n "$T05_CONNECTOR_NAME" '.resources[] | select(.name == $n) | .externalId')"
T05_SERVICE_EXTERNAL_ID="$(echo "$T05_FIRST_APPLY" | jq -r --arg n "$T05_SERVICE_NAME" '.resources[] | select(.name == $n) | .externalId')"
log "T05 first apply: appliedCount=2 (OK) — connector externalId=${T05_CONNECTOR_EXTERNAL_ID} service externalId=${T05_SERVICE_EXTERNAL_ID}"

# --- 9a. verification (a): every ref resolves to the CORRECT real id -------
# Compare each env entry's resolved id against the connector THIS SAME apply
# just created — fetched live via connector-admin, never assumed.

log "Stage 9a: fetching connector '${T05_CONNECTOR_NAME}' (externalId=${T05_CONNECTOR_EXTERNAL_ID}) live to compare endpoint ids"
T05_CONNECTOR_JSON="$(connector_admin_curl GET "/connectors/${T05_CONNECTOR_EXTERNAL_ID}")"
T05_DEALS_ENDPOINT_ID="$(echo "$T05_CONNECTOR_JSON" | jq -r --arg p "$T05_DEALS_PATH" '.endpoints[] | select(.method == "GET" and .path == $p) | .id')"
T05_TICKETS_ENDPOINT_ID="$(echo "$T05_CONNECTOR_JSON" | jq -r --arg p "$T05_TICKETS_PATH" '.endpoints[] | select(.method == "GET" and .path == $p) | .id')"
T05_CREATE_TICKET_ENDPOINT_ID="$(echo "$T05_CONNECTOR_JSON" | jq -r --arg p "$T05_TICKETS_PATH" '.endpoints[] | select(.method == "POST" and .path == $p) | .id')"
if [[ -z "$T05_DEALS_ENDPOINT_ID" || -z "$T05_TICKETS_ENDPOINT_ID" || -z "$T05_CREATE_TICKET_ENDPOINT_ID" ]]; then
  err "T05: expected all 3 live endpoint ids resolvable from connector '${T05_CONNECTOR_NAME}', got deals='${T05_DEALS_ENDPOINT_ID}' tickets='${T05_TICKETS_ENDPOINT_ID}' createTicket='${T05_CREATE_TICKET_ENDPOINT_ID}'"
  echo "$T05_CONNECTOR_JSON" | jq .
  exit 1
fi
log "T05: live connector endpoint ids — deals=${T05_DEALS_ENDPOINT_ID} tickets=${T05_TICKETS_ENDPOINT_ID} createTicket=${T05_CREATE_TICKET_ENDPOINT_ID}"

# --- 9b. verification (b): Knative spec structural inspection --------------
# NEVER reads a secret value — only env[].name / env[].value /
# env[].valueFrom.secretKeyRef.{name,key} (all non-secret metadata).

log "Stage 9b: kubectl get ksvc ${T05_KSVC_NAME} -n ${T05_TENANT_NAMESPACE} -o json (structural inspection only, no value ever read)"
T05_KSVC_ENV="$(kubectl get ksvc "$T05_KSVC_NAME" -n "$T05_TENANT_NAMESPACE" -o json \
  | jq -c '.spec.template.spec.containers[0].env')"

T05_ENV_COUNT="$(echo "$T05_KSVC_ENV" | jq 'length')"
if [[ "$T05_ENV_COUNT" != "6" ]]; then
  err "T05: expected exactly 6 env[] entries in the Knative spec, got ${T05_ENV_COUNT}: $(echo "$T05_KSVC_ENV" | jq -c '[.[].name]')"
  exit 1
fi

check_secret_key_ref() {
  local envName="$1" expectedSecretName="$2" expectedKey="$3"
  local hasPlainValue actualSecretName actualKey
  hasPlainValue="$(echo "$T05_KSVC_ENV" | jq -r --arg n "$envName" '.[] | select(.name == $n) | has("value")')"
  actualSecretName="$(echo "$T05_KSVC_ENV" | jq -r --arg n "$envName" '.[] | select(.name == $n) | .valueFrom.secretKeyRef.name // empty')"
  actualKey="$(echo "$T05_KSVC_ENV" | jq -r --arg n "$envName" '.[] | select(.name == $n) | .valueFrom.secretKeyRef.key // empty')"
  if [[ "$hasPlainValue" == "true" ]]; then
    err "T05: env['${envName}'] carries a plaintext 'value' field in the Knative spec — Option B must NEVER bake a secret value into env[].value"
    exit 1
  fi
  if [[ "$actualSecretName" != "$expectedSecretName" || "$actualKey" != "$expectedKey" ]]; then
    err "T05: env['${envName}'].valueFrom.secretKeyRef expected {name: '${expectedSecretName}', key: '${expectedKey}'}, got {name: '${actualSecretName}', key: '${actualKey}'}"
    exit 1
  fi
  log "T05: env['${envName}'] -> valueFrom.secretKeyRef={name: '${actualSecretName}', key: '${actualKey}'} (OK, structural only — no value read)"
}

check_literal_value() {
  local envName="$1" expectedValue="$2" describeExpected="$3"
  local actualValue
  actualValue="$(echo "$T05_KSVC_ENV" | jq -r --arg n "$envName" '.[] | select(.name == $n) | .value // empty')"
  if [[ "$actualValue" != "$expectedValue" ]]; then
    err "T05: env['${envName}'].value expected '${expectedValue}' (${describeExpected}), got '${actualValue}'"
    exit 1
  fi
  log "T05: env['${envName}'].value='${actualValue}' matches ${describeExpected} (OK)"
}

check_secret_key_ref "YOIZEN_EMAIL"    "$T05_SECRET_K8S_NAME" "$T05_SECRET_EMAIL_NAME"
check_secret_key_ref "YOIZEN_PASSWORD" "$T05_SECRET_K8S_NAME" "$T05_SECRET_PASSWORD_NAME"
check_literal_value "HUBSPOT_CONNECTOR_ID"            "$T05_CONNECTOR_EXTERNAL_ID"     "the connector's own real id"
check_literal_value "HUBSPOT_DEALS_ENDPOINT_ID"        "$T05_DEALS_ENDPOINT_ID"         "the live (GET,${T05_DEALS_PATH}) endpoint id"
check_literal_value "HUBSPOT_TICKETS_ENDPOINT_ID"      "$T05_TICKETS_ENDPOINT_ID"       "the live (GET,${T05_TICKETS_PATH}) endpoint id"
check_literal_value "HUBSPOT_CREATE_TICKET_ENDPOINT_ID" "$T05_CREATE_TICKET_ENDPOINT_ID" "the live (POST,${T05_TICKETS_PATH}) endpoint id"

log "Stage 9b: all 6 env[] entries structurally correct — 2 secretKeyRef refs, 4 real resolved ids (OK)"

# --- 9c. verification (c): pod runtime env actually resolves ---------------
# k8s itself injects the value at pod start (Option B's whole point) — proven
# INDIRECTLY per this task's own instruction: `kubectl exec ... -- env | grep
# -c` a COUNT only, the resolved values themselves are never read or printed
# anywhere in this script.

log "Stage 9c: waiting for a Running pod backing ksvc '${T05_KSVC_NAME}' (minScale=1 keeps one alive)"
T05_POD_NAME=""
T05_POD_DEADLINE=$((SECONDS + POLL_TIMEOUT_S))
while [[ -z "$T05_POD_NAME" ]]; do
  T05_POD_NAME="$(kubectl get pods -n "$T05_TENANT_NAMESPACE" \
    -l "serving.knative.dev/service=${T05_KSVC_NAME}" --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$T05_POD_NAME" ]]; then
    if [[ $SECONDS -ge $T05_POD_DEADLINE ]]; then
      err "T05: no Running pod found for ksvc '${T05_KSVC_NAME}' in namespace '${T05_TENANT_NAMESPACE}' within ${POLL_TIMEOUT_S}s"
      exit 1
    fi
    sleep 2
  fi
done
log "T05: pod '${T05_POD_NAME}' is Running — checking runtime env (COUNT only, values NEVER read)"

T05_RUNTIME_ENV_NAME_COUNT="$(kubectl exec -n "$T05_TENANT_NAMESPACE" "$T05_POD_NAME" -c user-container -- env \
  | grep -c -E '^(YOIZEN_EMAIL|YOIZEN_PASSWORD|HUBSPOT_CONNECTOR_ID|HUBSPOT_DEALS_ENDPOINT_ID|HUBSPOT_TICKETS_ENDPOINT_ID|HUBSPOT_CREATE_TICKET_ENDPOINT_ID)=' \
  || true)"
if [[ "$T05_RUNTIME_ENV_NAME_COUNT" != "6" ]]; then
  err "T05: expected all 6 env var NAMES present in the pod's actual runtime env, got count=${T05_RUNTIME_ENV_NAME_COUNT}"
  exit 1
fi

T05_RUNTIME_SECRET_NONEMPTY_COUNT="$(kubectl exec -n "$T05_TENANT_NAMESPACE" "$T05_POD_NAME" -c user-container -- env \
  | grep -c -E '^(YOIZEN_EMAIL|YOIZEN_PASSWORD)=.+$' \
  || true)"
if [[ "$T05_RUNTIME_SECRET_NONEMPTY_COUNT" != "2" ]]; then
  err "T05: expected BOTH secretKeyRef-backed vars to resolve to a NON-EMPTY value in the pod's runtime env (proves k8s actually injected the bound secret, whole chain — not just the manifest layer), got non-empty count=${T05_RUNTIME_SECRET_NONEMPTY_COUNT}"
  exit 1
fi
log "T05: pod runtime env — 6/6 declared var NAMES present, 2/2 secretKeyRef-backed vars resolved NON-EMPTY (OK, k8s itself did the injection — no value ever read by this script)"

# --- 9d. second apply: full noop --------------------------------------------

log "POST /manifests/${T05_MANIFEST_NAME}/plan again (expect all-noop)"
T05_SECOND_PLAN="$(prov_curl POST "/manifests/${T05_MANIFEST_NAME}/plan")"
T05_SECOND_VERDICTS="$(echo "$T05_SECOND_PLAN" | jq -r '.resources[].verdict' | sort -u)"
if [[ "$T05_SECOND_VERDICTS" != "noop" ]]; then
  err "T05: expected all-noop re-plan, got verdicts: ${T05_SECOND_VERDICTS}"
  echo "$T05_SECOND_PLAN" | jq .
  exit 1
fi

log "POST /manifests/${T05_MANIFEST_NAME}/apply again (expect appliedCount=0 noopCount=2)"
T05_SECOND_APPLY="$(prov_curl POST "/manifests/${T05_MANIFEST_NAME}/apply")"
T05_SECOND_APPLIED_COUNT="$(echo "$T05_SECOND_APPLY" | jq -r '.appliedCount')"
T05_SECOND_NOOP_COUNT="$(echo "$T05_SECOND_APPLY" | jq -r '.noopCount')"
if [[ "$T05_SECOND_APPLIED_COUNT" != "0" || "$T05_SECOND_NOOP_COUNT" != "2" ]]; then
  err "T05: expected second apply to be a full no-op (appliedCount=0 noopCount=2), got appliedCount=${T05_SECOND_APPLIED_COUNT} noopCount=${T05_SECOND_NOOP_COUNT}"
  echo "$T05_SECOND_APPLY" | jq .
  exit 1
fi
log "Stage 9d: T05 second apply is a full no-op (appliedCount=0, noopCount=2) — decision 6 holds end-to-end, not just in a unit test (OK)"

log "Stage 9 (T05) PASSED — the exact crm-support-telegram T04 env[] shape applies, resolves (2 secretKeyRef + 4 real ids, verified structurally and at pod runtime, no value ever read), and noops"

log "All stages passed"
