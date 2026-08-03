#!/usr/bin/env bash
#
# doc-code-guards.sh — static guard locking documented invariants against the code.
#
# Fails (non-zero exit) the moment code drifts from an invariant a doc asserts.
# Each failure prints the failing guard's ID and a human-readable reason so a
# broken run points straight at the doc or the code that needs fixing.
#
# Guard families actually registered in main() below (the K-numbers are
# historical labels, not a contiguous series):
#   K6a..K6g  the 2026-07-07 doc-vs-code audit's K6 findings
#             (cowork/DOC-VS-CODE-AUDIT.md) — service inventory, no
#             ScaledObject, autoscaling table, referenced script paths, alert
#             names, archive-runbook banners, no per-component AGENTS.md.
#   K7        NATS durable-consumer ackWait census (same audit).
#   K8        agent-call timeout ceiling (same audit).
#   K9        type-only constructor-injection check; delegates to the sibling
#             scripts/checks/check-di-imports.mjs. Added after the audit.
#   K9b       numeric claims in docs vs the artifact they describe. Added
#             after the audit; second guard in the K9 family, hence K9b.
#   K10       relative markdown links resolve. Added after the audit.
#   K11       dual-backend services document DB_ENGINE. Added after the audit.
#
# Usage:
#   scripts/checks/doc-code-guards.sh          # run all guards
#   scripts/checks/doc-code-guards.sh -v        # verbose: also print PASS lines
#
# Requires: bash 3.2+ (macOS's default /bin/bash — several guards note this
# explicitly and use case statements instead of associative arrays for it),
# ripgrep (rg, built with PCRE2 — K6d uses `-oP`), fd, yq (mikefarah v4+), and
# node (K9 runs check-di-imports.mjs through it; the guard fails loudly if node
# is not on PATH). All are already used elsewhere in scripts/ and
# DOCS/guides/doc-code-validation-tests.md.
#
# Verify with: /bin/bash scripts/checks/doc-code-guards.sh
#
# Standalone by design: there is no lefthook.yml or CI pipeline yaml in this
# repo yet (checked at implementation time), so this script is not wired into
# an existing aggregate. Run it manually, from a future CI job, or from a
# lefthook hook once one exists.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

VERBOSE=0
[[ "${1:-}" == "-v" ]] && VERBOSE=1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FAILURES=0

pass() { [[ "$VERBOSE" -eq 1 ]] && printf "${GREEN}[PASS]${NC} %s\n" "$*"; return 0; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$*" >&2; FAILURES=$((FAILURES + 1)); }
note() { printf "${YELLOW}[NOTE]${NC} %s\n" "$*"; }

# ---------------------------------------------------------------------------
# K6a — Service inventory: overview.md's Service Roles table vs services/*
# ---------------------------------------------------------------------------
k6a_service_inventory() {
  local guard="K6a(service-inventory)"
  local overview="DOCS/architecture/overview.md"

  # Extract documented service names from the "## Service Roles" table
  # (rows are `| \`name\` | Platform | ... |`).
  local doc_services
  doc_services=$(awk '/^## Service Roles/{f=1;next} /^## /{f=0} f' "$overview" \
    | rg -o '^\| `([a-z0-9-]+)`' -r '$1' \
    | sort -u)

  local dir_services
  dir_services=$(fd -t d -d 1 . services | xargs -n1 basename | sort -u)

  # workflow-service is split in docs into workflow-service-api /
  # workflow-service-worker, both backed by the single services/workflow-service
  # directory. Normalize before comparing.
  local doc_normalized
  doc_normalized=$(echo "$doc_services" \
    | sed -E 's/^workflow-service-(api|worker)$/workflow-service/' \
    | sort -u)

  local missing_dirs extra_dirs
  missing_dirs=$(comm -23 <(echo "$doc_normalized") <(echo "$dir_services"))
  extra_dirs=$(comm -13 <(echo "$doc_normalized") <(echo "$dir_services"))

  if [[ -n "$missing_dirs" ]]; then
    fail "$guard: overview.md documents services with no matching services/ dir: $(echo "$missing_dirs" | tr '\n' ' ')"
  fi
  if [[ -n "$extra_dirs" ]]; then
    fail "$guard: services/ has directories not documented in overview.md's Service Roles table: $(echo "$extra_dirs" | tr '\n' ' ')"
  fi
  [[ -z "$missing_dirs" && -z "$extra_dirs" ]] && pass "$guard: doc/dir service names match"
}

# ---------------------------------------------------------------------------
# K6b — No ScaledObject anywhere (KEDA removed)
# ---------------------------------------------------------------------------
k6b_no_scaledobject() {
  local guard="K6b(no-scaledobject)"
  local hits
  hits=$(rg -l '^kind:\s*ScaledObject\s*$' knative/ infrastructure/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "$guard: found a live ScaledObject resource (KEDA was removed): $(echo "$hits" | tr '\n' ' ')"
  else
    pass "$guard: no ScaledObject resource under knative/ or infrastructure/"
  fi
}

# ---------------------------------------------------------------------------
# K6c — Knative autoscaling: overview.md's table vs annotations in yaml
# ---------------------------------------------------------------------------
k6c_autoscaling() {
  local guard="K6c(autoscaling)"
  local overview="DOCS/architecture/overview.md"
  local base="knative/services/base"

  # doc-row-label -> one or more yaml basenames (without .yaml). Rows whose
  # doc value is "—" (plain Deployment, not Knative) are intentionally
  # omitted here; K6c only pins the numeric Knative rows.
  #
  # Implemented as a case statement (not an associative array) so this
  # script runs under macOS's default /bin/bash 3.2, which has no -A support.
  row_files_for() {
    case "$1" in
      "API Gateway") echo "api-gateway" ;;
      "Auth Service") echo "auth-service" ;;
      "Audit Service (API)") echo "audit-service-api" ;;
      "Cache Service") echo "cache-service" ;;
      "Channel Service (API)") echo "channel-service-api" ;;
      "Tenant Service") echo "tenant-service" ;;
      "Registry Service") echo "registry-service" ;;
      "Workflow API") echo "workflow-service-api" ;;
      "Connector Admin (API)") echo "connector-admin-api" ;;
      "Agent Admin Service") echo "agent-admin-service" ;;
      "AI Agent Gateway") echo "ai-agent-gateway" ;;
      "Agent AI / Memory / Scheduler Services") echo "agent-ai-service agent-memory-service agent-scheduler-service" ;;
      "Usage Aggregator (API)") echo "usage-aggregator-api" ;;
      "Proxy Service") echo "proxy-service" ;;
      "Admin Console") echo "admin-console" ;;
      "Provisioning Service") echo "provisioning-service" ;;
      *) echo "" ;;
    esac
  }

  local table
  table=$(awk '/^### Knative Autoscaling/{f=1;next} /^### /{f=0} f' "$overview" \
    | rg '^\| [A-Za-z]')

  local row_ok=1
  while IFS='|' read -r _ name min max _target _; do
    name=$(echo "$name" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
    min=$(echo "$min" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
    max=$(echo "$max" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
    [[ "$name" == "Service" || "$name" == "---------" ]] && continue
    [[ "$min" == "—" ]] && continue # plain Deployment row, not Knative-scaled

    local files
    files=$(row_files_for "$name")
    if [[ -z "$files" ]]; then
      fail "$guard: doc row '$name' has no known knative/services/base/*.yaml mapping in this guard (update ROW_FILES)"
      row_ok=0
      continue
    fi

    for f in $files; do
      local yaml_path="$base/$f.yaml"
      if [[ ! -f "$yaml_path" ]]; then
        fail "$guard: $yaml_path referenced by doc row '$name' does not exist"
        row_ok=0
        continue
      fi
      local actual_min actual_max
      actual_min=$(yq '.spec.template.metadata.annotations."autoscaling.knative.dev/min-scale"' "$yaml_path")
      actual_max=$(yq '.spec.template.metadata.annotations."autoscaling.knative.dev/max-scale"' "$yaml_path")
      if [[ "$actual_min" != "$min" || "$actual_max" != "$max" ]]; then
        fail "$guard: '$name' ($yaml_path) has min=$actual_min/max=$actual_max, doc says min=$min/max=$max"
        row_ok=0
      fi
    done
  done <<<"$table"

  [[ "$row_ok" -eq 1 ]] && pass "$guard: all documented min/max-scale rows match knative yaml annotations"
}

# ---------------------------------------------------------------------------
# K6d — scripts/... and e2e/... paths referenced in README.md / DOCS/README.md exist
# ---------------------------------------------------------------------------
k6d_referenced_scripts_exist() {
  local guard="K6d(referenced-script-paths)"
  local ok=1
  local refs
  refs=$(rg --no-filename -oP '(?:[\w.-]+/)*(?:scripts|e2e)(?:/[\w.-]+)+' README.md DOCS/README.md 2>/dev/null \
    | sort -u)

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ ! -e "$path" ]]; then
      fail "$guard: referenced path '$path' does not exist on disk"
      ok=0
    fi
  done <<<"$refs"

  [[ "$ok" -eq 1 ]] && pass "$guard: all scripts/... and e2e/... paths referenced in README.md / DOCS/README.md exist"
}

# ---------------------------------------------------------------------------
# K6e — Alert names in observability.md §4 exist in alerts.yaml (and
# TemporalHistoryShardImbalance does NOT).
# ---------------------------------------------------------------------------
k6e_alert_names() {
  local guard="K6e(alert-names)"
  local obs="DOCS/architecture/observability.md"
  local alerts_file="infrastructure/base/observability/prometheus/alerts.yaml"
  local ok=1

  if [[ ! -f "$alerts_file" ]]; then
    fail "$guard: $alerts_file does not exist"
    return
  fi

  local yaml_alerts
  yaml_alerts=$(rg -o '\- alert: (\w+)' -r '$1' "$alerts_file" | sort -u)

  # Only the "Implemented Alerts" section (## 4), not §4.8 ("not implemented"),
  # and only actual table rows (`| \`AlertName\` | ... |`) — prose/blockquote
  # notes (e.g. the §4.7 note explaining TemporalHistoryShardImbalance was
  # REMOVED) also mention alert names in backticks but must not count as
  # "documented as implemented".
  local doc_alerts
  doc_alerts=$(awk '/^## 4\. Implemented Alerts/{f=1;next} /^### 4\.8/{f=0} /^## 5\./{f=0} f' "$obs" \
    | rg '^\| `[A-Z]' \
    | rg -o '`([A-Z]\w+)`' -r '$1' \
    | sort -u)

  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    if ! grep -qx "$name" <<<"$yaml_alerts"; then
      fail "$guard: observability.md §4 references alert '$name' with no matching 'alert:' entry in $alerts_file"
      ok=0
    fi
  done <<<"$doc_alerts"

  if grep -qx "TemporalHistoryShardImbalance" <<<"$yaml_alerts"; then
    fail "$guard: TemporalHistoryShardImbalance must NOT exist in $alerts_file (removed per observability.md §4.7 note)"
    ok=0
  fi

  [[ "$ok" -eq 1 ]] && pass "$guard: every §4 alert name exists in alerts.yaml; TemporalHistoryShardImbalance absent"
}

# ---------------------------------------------------------------------------
# K6f — Archive runbooks keep their historical banner
# ---------------------------------------------------------------------------
k6f_archive_banner() {
  local guard="K6f(archive-runbook-banner)"
  local ok=1
  local f
  for f in DOCS/runbooks/archive/*.md; do
    [[ -e "$f" ]] || continue
    if ! head -n 10 "$f" | rg -qi 'status:?\*?\*?\s*historical'; then
      fail "$guard: $f is missing its historical-status banner in the first 10 lines"
      ok=0
    fi
  done
  [[ "$ok" -eq 1 ]] && pass "$guard: every archived runbook keeps its historical banner"
}

# ---------------------------------------------------------------------------
# K6g — No per-component AGENTS.md may exist.
#
# Drift class: per-component agent files resurrect. Every `services/*/AGENTS.md`
# and `packages/*/AGENTS.md` was absorbed into that component's README
# (manual-loops/architecture/docs-consistency.md T02/T03/T04), so the README is
# now the single descriptive doc per component. A re-created AGENTS.md
# immediately re-forks the narrative and starts drifting from the code again.
#
# Scope is `services/*` and `packages/*`, at exactly one level below each:
#   * the ROOT `AGENTS.md` is the repo constitution and MUST NOT match — the
#     globs are anchored at `services/` and `packages/`, so it never can.
#   * `packages/*` was added in T04, once `packages/shared/AGENTS.md` was
#     absorbed and deleted in the same commit (a guard must be green when it
#     lands).
# ---------------------------------------------------------------------------
k6g_no_component_agents_md() {
  local guard="K6g(no-component-agents-md)"
  local found=""
  local f
  for f in services/*/AGENTS.md packages/*/AGENTS.md; do
    [[ -e "$f" ]] || continue
    found="$found $f"
  done

  if [[ -n "$found" ]]; then
    fail "$guard: per-component AGENTS.md resurrected —$found. Absorb the content into the component's README.md (with file:line citations) and delete the file; the root AGENTS.md is the only agent file in this repo."
  else
    pass "$guard: no services/*/AGENTS.md or packages/*/AGENTS.md on disk"
  fi
}

# ---------------------------------------------------------------------------
# K7 — NATS durable consumer ackWait census.
#
# Every durable consumer registration (`new MultiTenantConsumerManager(...)`
# or `ensureDurableConsumer(...)`) must declare an explicit `ackWaitMs` in its
# config, UNLESS its file is in ACK_WAIT_ALLOWLIST below. Long-running
# handlers (LLM calls, large-file ingestion, multi-step provisioning) that
# silently inherit the 60s package default (`DEFAULT_ACK_WAIT_MS` in
# packages/database/src/nats-durable-consumer.ts) risk JetStream redelivering
# an in-flight message and duplicating side effects (see
# cowork/ASYNC-RESILIENCE-AUDIT.md F1).
#
# The allowlist below is NOT "one consumer" as a first cut of this guard
# assumed — a full repo census found registrations that omit ackWaitMs
# entirely; the allowlist has grown to 11 entries as more landed (count them
# in ack_wait_allowlist_reason below, against the 18 known_files). All have
# fast, I/O-bound handlers (Postgres/Mongo
# inserts, Redis writes, outbound HTTP sends, in-memory rule matching) with
# no LLM/embedding calls or large-file processing, so the implicit 60s
# default is safe for them today. They are allowlisted explicitly (with a
# one-line justification each) rather than silently passed, so this guard
# still catches the actual risk: a FUTURE consumer with a slow handler that
# forgets to set ackWaitMs will fail here until someone consciously adds it
# to this list (or, better, sets an explicit ackWaitMs in code).
# ---------------------------------------------------------------------------
k7_ack_wait_census() {
  local guard="K7(ack-wait-census)"
  local ok=1

  # file -> justification for relying on the implicit 60s default.
  #
  # Implemented as a case statement (not an associative array) so this
  # script runs under macOS's default /bin/bash 3.2, which has no -A support.
  ack_wait_allowlist_reason() {
    case "$1" in
      "services/channel-service/src/modules/auto-reply/auto-reply.service.ts")
        echo "in-memory rule match + egress send, fast" ;;
      "services/usage-aggregator-service/src/modules/aggregator/aggregator.engine.ts")
        echo "batch buffer enqueue, fast (both ingress + DLQ managers)" ;;
      "services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts")
        echo "webhook decode + publish, fast" ;;
      "services/workflow-service/src/modules/executions-projector/execution-projector.service.ts")
        echo "batched Postgres UPDATE, fast" ;;
      "services/ai-agent-gateway/src/modules/executions/executions.service.ts")
        echo "Redis persist of execution status, fast" ;;
      "services/channel-service/src/modules/egress/send-command-consumer.service.ts")
        echo "outbound HTTP send to channel providers, fast" ;;
      "services/audit-service/src/modules/audit/audit.service.ts")
        echo "Postgres audit insert, fast" ;;
      "services/audit-service/src/modules/channel-audit/channel-audit.service.ts")
        echo "Postgres channel-audit insert, fast" ;;
      "services/audit-service/src/modules/execution-audit/execution-audit.service.ts")
        echo "Postgres/Mongo execution-audit insert (metering foundation G1), fast" ;;
      "services/tracking-ingester-service/src/main.ts")
        echo "batched Postgres insert + claim-check resolve bounded at 2s, fast (DLQ-disabled by design)" ;;
      "services/tracking-ingester-service/src/lib/consume-events.ts")
        echo "doc-comment mention only — the real registration lives in main.ts" ;;
      *) echo "" ;;
    esac
  }

  # Full census of known registration files, kept in sync with the allowlist
  # above plus every file that DOES set an explicit ackWaitMs. If a new
  # registration shows up that isn't in this list, the guard fails and asks
  # for it to be triaged (added to the allowlist with a justification, or
  # given an explicit ackWaitMs in code).
  local known_files=(
    "services/connector-admin/src/modules/internal-sync/internal-sync.service.ts"
    "services/channel-service/src/modules/auto-reply/auto-reply.service.ts"
    "services/usage-aggregator-service/src/modules/aggregator/aggregator.engine.ts"
    "services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts"
    "services/workflow-service/src/modules/executions-projector/execution-projector.service.ts"
    "services/workflow-service/src/modules/triggers/trigger-consumer.service.ts"
    "services/ai-agent-gateway/src/modules/executions/executions.service.ts"
    "services/channel-service/src/modules/egress/send-command-consumer.service.ts"
    "services/agent-admin-service/src/modules/structured-kb/skb-ingestion-worker.service.ts"
    "services/agent-admin-service/src/modules/knowledge-bases/ingestion-worker.service.ts"
    "services/audit-service/src/modules/audit/audit.service.ts"
    "services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts"
    "services/audit-service/src/modules/channel-audit/channel-audit.service.ts"
    "services/audit-service/src/modules/execution-audit/execution-audit.service.ts"
    "services/tenant-service/src/modules/provisioning/tenant-provision-consumer.service.ts"
    "services/tracking-ingester-service/src/main.ts"
    "services/tracking-ingester-service/src/lib/consume-events.ts"
    "services/connector-runtime/src/invoke-consumer-main.ts"
  )

  # 1) Discover every actual registration site under services/ (excluding
  #    tests/specs) and fail if one isn't in known_files (undocumented
  #    consumer — the census has gone stale). packages/database itself is
  #    excluded: it only DEFINES ensureDurableConsumer/MultiTenantConsumerManager,
  #    it doesn't register a consumer.
  local discovered
  discovered=$(rg -l --type ts -g '!*.spec.ts' -g '!*/test/**' \
    '(new MultiTenantConsumerManager\(|ensureDurableConsumer\()' \
    services 2>/dev/null | sort -u)

  local f
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    local known=0
    for kf in "${known_files[@]}"; do
      [[ "$f" == "$kf" ]] && known=1 && break
    done
    if [[ "$known" -eq 0 ]]; then
      fail "$guard: undocumented durable-consumer registration in $f — add it to known_files/ACK_WAIT_ALLOWLIST in $0 (triage its ackWaitMs)"
      ok=0
    fi
  done <<<"$discovered"

  # 2) For every known registration, check whether the file declares an
  #    explicit `ackWaitMs:` anywhere (each of these files registers exactly
  #    one durable consumer — or two near-identical ones, for
  #    aggregator.engine.ts — so a whole-file check is precise enough and
  #    avoids fragile "N lines after the call" windows, since the config
  #    object is sometimes built above the registration call, not after it).
  #    Files not in the allowlist must have it explicitly.
  for f in "${known_files[@]}"; do
    if [[ ! -f "$f" ]]; then
      fail "$guard: known registration file $f no longer exists — update $0"
      ok=0
      continue
    fi
    local has_ack
    has_ack=$(rg -c 'ackWaitMs\s*:' "$f" || true)

    if [[ "${has_ack:-0}" -eq 0 ]]; then
      local reason
      reason=$(ack_wait_allowlist_reason "$f")
      if [[ -z "$reason" ]]; then
        fail "$guard: $f registers a durable consumer with no explicit ackWaitMs and is not allowlisted (long-running handlers under the 60s default cause JetStream redelivery/duplicate execution — see cowork/ASYNC-RESILIENCE-AUDIT.md F1)"
        ok=0
      else
        pass "$guard: $f relies on the 60s default (allowlisted: $reason)"
      fi
    else
      pass "$guard: $f declares an explicit ackWaitMs"
    fi
  done

  [[ "$ok" -eq 1 ]] && pass "$guard: NATS consumer ackWait census clean"
}

# ---------------------------------------------------------------------------
# K8 — Knative timeoutSeconds on ai-agent-gateway/api-gateway >= AGENT_CALL_TIMEOUT_MS
# (900s) + margin, and cluster max-revision-timeout-seconds >= the same.
# ---------------------------------------------------------------------------
k8_agent_call_timeout_ceiling() {
  local guard="K8(agent-call-timeout-ceiling)"
  local ok=1
  local min_required=960 # 900s AGENT_CALL_TIMEOUT_MS + 60s margin

  local f
  for f in knative/services/base/ai-agent-gateway.yaml knative/services/base/api-gateway.yaml; do
    if [[ ! -f "$f" ]]; then
      fail "$guard: $f does not exist"
      ok=0
      continue
    fi
    local ts
    ts=$(yq '.spec.template.spec.timeoutSeconds' "$f")
    if [[ "$ts" == "null" || -z "$ts" ]]; then
      fail "$guard: $f has no spec.template.spec.timeoutSeconds set"
      ok=0
    elif [[ "$ts" -lt "$min_required" ]]; then
      fail "$guard: $f timeoutSeconds=$ts is below the required $min_required (900s AGENT_CALL_TIMEOUT_MS + margin)"
      ok=0
    fi
  done

  local defaults="knative/serving/config-defaults.yaml"
  if [[ ! -f "$defaults" ]]; then
    fail "$guard: $defaults does not exist"
    ok=0
  else
    local max_ts
    max_ts=$(yq '.data."max-revision-timeout-seconds"' "$defaults")
    if [[ "$max_ts" == "null" || -z "$max_ts" ]]; then
      fail "$guard: $defaults has no data.max-revision-timeout-seconds set"
      ok=0
    elif [[ "$max_ts" -lt "$min_required" ]]; then
      fail "$guard: $defaults max-revision-timeout-seconds=$max_ts is below the required $min_required"
      ok=0
    fi
  fi

  [[ "$ok" -eq 1 ]] && pass "$guard: ai-agent-gateway/api-gateway timeoutSeconds and cluster ceiling >= ${min_required}s"
}

# K9: constructor-injected classes must not be imported type-only (Biome
# useImportType vs NestJS emitDecoratorMetadata — runtime DI failure invisible
# to tsc). Delegates to scripts/checks/check-di-imports.mjs (git-modified scope).
k9_di_type_imports() {
  local guard="K9-di-type-imports"
  if ! command -v node >/dev/null 2>&1; then
    fail "$guard: node not found on PATH"
    return
  fi
  if node "$(dirname "$0")/check-di-imports.mjs"; then
    pass "$guard: no type-only constructor injections in modified files"
  else
    fail "$guard: type-only constructor injection(s) found — see output above"
  fi
}

# ---------------------------------------------------------------------------
# K9b — Numeric claims in docs vs generated reality.
#
# Drift class: a number QUOTED in prose ("across the 72 audited rows") silently
# diverges from the artifact it describes. Descriptive docs are derived FROM
# the artifact — the artifact decides, so the guard recomputes it and compares.
#
# Numbering note: K9 above (k9_di_type_imports) is a different drift class
# (type-only DI imports) that already claimed the number; this is the second
# guard in the K9 family, hence K9b.
#
# Claim 1 — tracking-ingester golden row count. Three statements must agree
# with the data-row count of golden/labeled.tsv, computed exactly the way
# `loadGolden()` in services/tracking-ingester-service/test/
# classify.golden.spec.ts parses it (non-blank lines, minus the single header):
#   * services/tracking-ingester-service/README.md  "across the N audited rows"
#   * test/classify.golden.spec.ts                  it("parses N labeled data rows")
#   * test/classify.golden.spec.ts                  expect(rows.length).toBe(N)
# ---------------------------------------------------------------------------
k9b_numeric_claims() {
  local guard="K9b(numeric-claims)"
  local ok=1

  local golden="golden/labeled.tsv"
  local readme="services/tracking-ingester-service/README.md"
  local spec="services/tracking-ingester-service/test/classify.golden.spec.ts"

  local f
  for f in "$golden" "$readme" "$spec"; do
    if [[ ! -f "$f" ]]; then
      fail "$guard: $f does not exist — update $0"
      return
    fi
  done

  local nonblank actual
  nonblank=$(rg -c '\S' "$golden" || echo 0)
  actual=$((nonblank - 1))

  # claim-id -> "<human label>|<number currently stated in that file>".
  #
  # Implemented as a case statement (not an associative array) so this
  # script runs under macOS's default /bin/bash 3.2, which has no -A support.
  golden_count_claim() {
    case "$1" in
      readme-prose)
        echo "$readme \"across the N audited rows\"|$(rg -o 'across the ([0-9]+) audited rows' -r '$1' "$readme" | head -1)" ;;
      spec-test-name)
        echo "$spec it(\"parses N labeled data rows\")|$(rg -o 'parses ([0-9]+) labeled data rows' -r '$1' "$spec" | head -1)" ;;
      spec-assertion)
        echo "$spec expect(rows.length).toBe(N)|$(rg -o 'rows\.length\)\.toBe\(([0-9]+)\)' -r '$1' "$spec" | head -1)" ;;
      *) echo "|" ;;
    esac
  }

  local claim entry label claimed
  for claim in readme-prose spec-test-name spec-assertion; do
    entry=$(golden_count_claim "$claim")
    label="${entry%%|*}"
    claimed="${entry##*|}"
    if [[ -z "$claimed" ]]; then
      fail "$guard: golden row-count claim '$claim' not found — expected $label; its wording drifted, restore the phrasing or update $0"
      ok=0
    elif [[ "$claimed" != "$actual" ]]; then
      fail "$guard: $label states $claimed but $golden has $actual data rows (non-blank lines minus the header)"
      ok=0
    fi
  done

  [[ "$ok" -eq 1 ]] && pass "$guard: golden row count ($actual) matches every stated claim"
}

# ---------------------------------------------------------------------------
# K10 — Relative markdown links resolve.
#
# Drift class: docs linking deleted docs. When a document is removed or moved,
# the links pointing at it are left behind and rot silently — the
# `code-review.md` dangling row found on 2026-07-29 is the recurring instance.
# Nothing in a markdown renderer fails on a dead relative link, so only a guard
# catches it.
#
# SCOPE — the corpus is the LIVE, descriptive documentation:
#   * root `README.md`
#   * `DOCS/**/*.md`
#   * `services/*/README.md`
#   * `packages/*/README.md`  — added beyond the SPEC's three globs because
#     these are first-class component docs of exactly the same class (written
#     in T04). Today they contain zero relative .md links, so the addition is a
#     no-op that only pre-empts future rot.
#   NOT `manual-loops/**` or `cowork/**`: those are loop history, deliberately
#   frozen (SPEC decision 4), and rewriting them to satisfy a link check would
#   falsify the record.
#
# WHAT IS CHECKED — relative links whose target is a `.md` file. External
# (`http://`, `https://`, `mailto:`), absolute (`/...`) and pure-anchor (`#...`)
# targets are skipped, as are non-`.md` targets (scripts, manifests,
# directories): those are a different class and several live only in archived
# runbooks that must not be edited. Both inline `](target)` links and
# reference-style `[label]: target` definitions are scanned.
#
# ANCHORS — for `file.md#section` only the FILE part is resolved. Anchor
# validation is deliberately NOT implemented: doing it correctly requires
# reimplementing GitHub's slugging rules, and a half-correct version would
# produce false positives, which is the one failure mode that gets a guard
# disabled.
#
# FALSE-POSITIVE AVOIDANCE — the scanner skips fenced code blocks (``` / ~~~)
# entirely and strips inline code spans (`...`) before matching, so example
# links in documentation samples are never treated as real links. Indented
# code blocks are NOT skipped: 4-space indentation is ambiguous with list
# continuation, and treating it as code would silently drop real links.
# ---------------------------------------------------------------------------
k10_markdown_links_resolve() {
  local guard="K10(markdown-links-resolve)"
  local ok=1

  local scan_awk
  scan_awk='
    { line = $0
      if (line ~ /^[ \t]*(```|~~~)/) { fence = !fence; next }
      if (fence) next
      gsub(/`[^`]*`/, "", line)
      rest = line
      while (match(rest, /\]\([^)]*\)/)) {
        print FILENAME "\t" FNR "\t" substr(rest, RSTART + 2, RLENGTH - 3)
        rest = substr(rest, RSTART + RLENGTH)
      }
      if (line ~ /^[ \t]*\[[^]]+\][ \t]*:[ \t]*[^ \t]/) {
        d = line
        sub(/^[ \t]*\[[^]]+\][ \t]*:[ \t]*/, "", d)
        sub(/[ \t].*$/, "", d)
        print FILENAME "\t" FNR "\t" d
      }
    }'

  local files
  files=$( { echo "README.md"
             fd -e md . DOCS
             fd -g 'README.md' services --max-depth 2
             fd -g 'README.md' packages --max-depth 2
           } 2>/dev/null | sort -u )

  if [[ -z "$files" ]]; then
    fail "$guard: doc corpus discovery returned nothing — the globs or fd broke"
    return
  fi

  local scanned=0
  local f l t base dir
  while IFS=$'\t' read -r f l t; do
    [[ -z "$f" ]] && continue
    case "$t" in
      http://*|https://*|mailto:*|"#"*|/*|"") continue ;;
    esac
    base="${t%%#*}"
    [[ -z "$base" ]] && continue
    case "$base" in
      *.md) ;;
      *) continue ;;
    esac
    scanned=$((scanned + 1))
    dir=$(dirname "$f")
    if [[ ! -e "$dir/$base" ]]; then
      fail "$guard: $f:$l links to '$t' which does not exist (resolved: $dir/$base)"
      ok=0
    fi
  done <<<"$(awk "$scan_awk" $files)"

  [[ "$ok" -eq 1 ]] && pass "$guard: all $scanned relative .md links resolve"
}

# ---------------------------------------------------------------------------
# K11 — Storage-engine documentation.
#
# Drift class: undocumented dual-backend support. A service that calls
# `resolveStorageEngine()` (packages/database/src/engine.ts) silently supports
# BOTH Postgres and Mongo and switches on `DB_ENGINE` / `STORAGE_ENGINE` at
# bootstrap. The phase-0 audit (C9) found 11 services using it and only 2
# documenting it — so an operator reading the README had no way to know the
# knob existed, or that an invalid value throws at startup.
#
# The rule: if a service's SOURCE calls `resolveStorageEngine`, its README must
# mention `DB_ENGINE` or `STORAGE_ENGINE`. The set of services is DISCOVERED
# from the code (not hardcoded), so a new dual-backend service is caught the
# moment it lands without touching this script.
#
# Spec files are excluded from discovery: a test that imports the helper to
# assert its behaviour does not make its service dual-backend.
# ---------------------------------------------------------------------------
k11_storage_engine_documented() {
  local guard="K11(storage-engine-documented)"
  local ok=1

  # Services whose non-test source calls resolveStorageEngine(), one per line.
  local svc_dirs
  svc_dirs=$(rg -l --type ts -g '!*.spec.ts' -g '!**/test/**' \
    'resolveStorageEngine' services 2>/dev/null \
    | sed -E 's|^services/([^/]+)/.*|\1|' \
    | sort -u)

  if [[ -z "$svc_dirs" ]]; then
    fail "$guard: found no service calling resolveStorageEngine() — the discovery pattern broke, or the helper was renamed (packages/database/src/engine.ts)"
    return
  fi

  local count=0
  local s
  while IFS= read -r s; do
    [[ -z "$s" ]] && continue
    count=$((count + 1))
    local readme="services/$s/README.md"
    if [[ ! -f "$readme" ]]; then
      fail "$guard: services/$s calls resolveStorageEngine() but has no README.md to document DB_ENGINE in"
      ok=0
      continue
    fi
    if ! rg -q 'DB_ENGINE|STORAGE_ENGINE' "$readme"; then
      fail "$guard: services/$s selects its storage backend at bootstrap (resolveStorageEngine) but $readme never mentions DB_ENGINE / STORAGE_ENGINE — document the variable, its default (postgres) and that an invalid value throws"
      ok=0
    fi
  done <<<"$svc_dirs"

  [[ "$ok" -eq 1 ]] && pass "$guard: all $count dual-backend services document DB_ENGINE"
}

main() {
  k6a_service_inventory
  k6b_no_scaledobject
  k6c_autoscaling
  k6d_referenced_scripts_exist
  k6e_alert_names
  k6f_archive_banner
  k6g_no_component_agents_md
  k7_ack_wait_census
  k8_agent_call_timeout_ceiling
  k9_di_type_imports
  k9b_numeric_claims
  k10_markdown_links_resolve
  k11_storage_engine_documented

  echo
  if [[ "$FAILURES" -eq 0 ]]; then
    printf "${GREEN}All doc/code guards passed.${NC}\n"
    exit 0
  else
    printf "${RED}%d guard(s) failed.${NC}\n" "$FAILURES"
    exit 1
  fi
}

main "$@"
