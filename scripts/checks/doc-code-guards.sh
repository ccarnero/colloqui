#!/usr/bin/env bash
#
# doc-code-guards.sh — static guard locking documented invariants against the code.
#
# Fails (non-zero exit) the moment code drifts from an invariant a doc asserts.
# Each failure prints the failing guard's ID and a human-readable reason so a
# broken run points straight at the doc or the code that needs fixing.
#
# NAMING — every guard in this file carries a `G` (guard) prefix. Until
# 2026-08-04 the same guards were labelled `K…`, which collided by number with
# the K1–K10 *proposal* in DOCS/archive/audits/DOC-VS-CODE-AUDIT.md ("K9" and
# "K10" each named two different things). The docs-truth-audit loop's T09
# ruling D28 renamed the implemented family K→G, same numbers, and the audit
# RECORD keeps its K-numbers with a crosswalk table appended to it. The numbers
# are historical labels, not a contiguous series.
#
# Guard families actually registered in main() below:
#   G6a..G6g  the 2026-07-07 doc-vs-code audit's G6 findings
#             (DOCS/archive/audits/DOC-VS-CODE-AUDIT.md) — service inventory,
#             no ScaledObject, autoscaling table, referenced script paths,
#             alert names, archive banners, no per-component AGENTS.md.
#   G7        NATS durable-consumer ackWait census (same audit).
#   G8        agent-call timeout ceiling (same audit).
#   G9        type-only constructor-injection check; delegates to the sibling
#             scripts/checks/check-di-imports.mjs. Added after the audit.
#   G9b       numeric claims in docs vs the artifact they describe. Added
#             after the audit; second guard in the G9 family, hence G9b.
#   G10       relative markdown links resolve. Added after the audit.
#   G11       dual-backend services document DB_ENGINE. Added after the audit.
#   G12       doc class banner (`Class:` + `Summary:`) on every DOCS/**/*.md
#             and every service/package README. Added by T10 (D1/D24).
#   G13       doc paths cited from source resolve, and no `DOCS/**.md:NNN`
#             line cites live in source. Added by T10 (D25).
#   G14       no NEW hard-coded hex colour literals in added lines under
#             services/admin-console. Added by T10 (D32), ratchet-scoped to
#             `git diff` so the 58 grandfathered files are not re-checked.
#   G15       every literal consumer name written into a `consumer_name`
#             matcher in the Prometheus alerts is a real durable declared in
#             the code. Added by the docs-code-manda loop's T02, together with
#             the inversion of the nats-consumer-lag allow-list.
#
# Usage:
#   scripts/checks/doc-code-guards.sh          # run all guards
#   scripts/checks/doc-code-guards.sh -v        # verbose: also print PASS lines
#
# Requires: bash 3.2+ (macOS's default /bin/bash — several guards note this
# explicitly and use case statements instead of associative arrays for it),
# ripgrep (rg, built with PCRE2 — G6d uses `-oP`), fd, yq (mikefarah v4+), and
# node (G9 runs check-di-imports.mjs through it; the guard fails loudly if node
# is not on PATH). All are already used elsewhere in scripts/ and
# DOCS/guides/doc-code-guards.md.
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
# G6a — Service inventory: overview.md's Service Roles table vs services/*
# ---------------------------------------------------------------------------
g6a_service_inventory() {
  local guard="G6a(service-inventory)"
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
# G6b — No ScaledObject anywhere (KEDA removed)
# ---------------------------------------------------------------------------
g6b_no_scaledobject() {
  local guard="G6b(no-scaledobject)"
  local hits
  hits=$(rg -l '^kind:\s*ScaledObject\s*$' knative/ infrastructure/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "$guard: found a live ScaledObject resource (KEDA was removed): $(echo "$hits" | tr '\n' ' ')"
  else
    pass "$guard: no ScaledObject resource under knative/ or infrastructure/"
  fi
}

# ---------------------------------------------------------------------------
# G6c — Knative autoscaling: overview.md's table vs annotations in yaml
# ---------------------------------------------------------------------------
g6c_autoscaling() {
  local guard="G6c(autoscaling)"
  local overview="DOCS/architecture/overview.md"
  local base="knative/services/base"

  # doc-row-label -> one or more yaml basenames (without .yaml). Rows whose
  # doc value is "—" (plain Deployment, not Knative) are intentionally
  # omitted here; G6c only pins the numeric Knative rows.
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
      fail "$guard: doc row '$name' has no known knative/services/base/*.yaml mapping in this guard (update row_files_for)"
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
# G6d — scripts/... and e2e/... paths referenced in README.md / DOCS/README.md exist
# ---------------------------------------------------------------------------
g6d_referenced_scripts_exist() {
  local guard="G6d(referenced-script-paths)"
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
# G6e — Alert names in observability.md §4 exist in alerts.yaml (and
# TemporalHistoryShardImbalance does NOT).
# ---------------------------------------------------------------------------
g6e_alert_names() {
  local guard="G6e(alert-names)"
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
# G6f — Everything under DOCS/archive/ declares that it is not present truth.
#
# Widened by T10 (ruling D27) from `DOCS/runbooks/archive/*.md` to the whole
# `DOCS/archive/**` tree, which D2/D3 made the single home for every dated
# record that is not a manual-loop: the retired `cowork/` audits
# (`archive/audits/`), the change register (`archive/INDEX.md`), the run-view
# design contract, and the archived runbooks (moved to `archive/runbooks/`).
#
# TWO accepted banners, both checked in the first 10 lines:
#   * `Status: historical` — a frozen record. Everything in here is one of
#     these EXCEPT the register below.
#   * `Status: append-only` — the one live class that lives in the archive:
#     a `register` (D11) whose dated rows keep being appended to and amended in
#     place. `DOCS/archive/INDEX.md` is the only instance today. It gets its own
#     banner rather than a silent exemption, so "archived but still growing" is
#     a stated property and not a hole in the guard.
# ---------------------------------------------------------------------------
g6f_archive_banner() {
  local guard="G6f(archive-banner)"
  local ok=1
  local count=0
  local f
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    count=$((count + 1))
    if head -n 10 "$f" | rg -qi 'status:?\*?\*?\s*historical'; then
      continue
    fi
    if head -n 10 "$f" | rg -qi 'status:?\*?\*?\s*append-only'; then
      # An append-only banner is only legitimate for a register.
      if head -n 10 "$f" | rg -q '^Class: register$'; then
        continue
      fi
      fail "$guard: $f declares 'Status: append-only' but is not a 'Class: register' — only a register may keep growing inside DOCS/archive/"
      ok=0
      continue
    fi
    fail "$guard: $f is missing its archive banner in the first 10 lines — a frozen record needs 'Status: historical', a live register needs 'Status: append-only'"
    ok=0
  done <<<"$(fd -e md . DOCS/archive 2>/dev/null)"
  [[ "$ok" -eq 1 ]] && pass "$guard: all $count files under DOCS/archive/ declare their archive status"
}

# ---------------------------------------------------------------------------
# G6g — No per-component AGENTS.md may exist.
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
g6g_no_component_agents_md() {
  local guard="G6g(no-component-agents-md)"
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
# G7 — NATS durable consumer ackWait census.
#
# Every durable consumer registration (`new MultiTenantConsumerManager(...)`
# or `ensureDurableConsumer(...)`) must declare an explicit `ackWaitMs` in its
# config, UNLESS its file is in ACK_WAIT_ALLOWLIST below. Long-running
# handlers (LLM calls, large-file ingestion, multi-step provisioning) that
# silently inherit the 60s package default (`DEFAULT_ACK_WAIT_MS` in
# packages/database/src/nats-durable-consumer.ts) risk JetStream redelivering
# an in-flight message and duplicating side effects (see
# DOCS/archive/audits/ASYNC-RESILIENCE-AUDIT.md F1).
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
g7_ack_wait_census() {
  local guard="G7(ack-wait-census)"
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
        fail "$guard: $f registers a durable consumer with no explicit ackWaitMs and is not allowlisted (long-running handlers under the 60s default cause JetStream redelivery/duplicate execution — see DOCS/archive/audits/ASYNC-RESILIENCE-AUDIT.md F1)"
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
# G8 — Knative timeoutSeconds on ai-agent-gateway/api-gateway >= AGENT_CALL_TIMEOUT_MS
# (900s) + margin, and cluster max-revision-timeout-seconds >= the same.
# ---------------------------------------------------------------------------
g8_agent_call_timeout_ceiling() {
  local guard="G8(agent-call-timeout-ceiling)"
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

# G9: constructor-injected classes must not be imported type-only (Biome
# useImportType vs NestJS emitDecoratorMetadata — runtime DI failure invisible
# to tsc). Delegates to scripts/checks/check-di-imports.mjs (git-modified scope).
g9_di_type_imports() {
  local guard="G9-di-type-imports"
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
# G9b — Numeric claims in docs vs generated reality.
#
# Drift class: a number QUOTED in prose ("across the 72 audited rows") silently
# diverges from the artifact it describes. Descriptive docs are derived FROM
# the artifact — the artifact decides, so the guard recomputes it and compares.
#
# Numbering note: G9 above (g9_di_type_imports) is a different drift class
# (type-only DI imports) that already claimed the number; this is the second
# guard in the G9 family, hence G9b.
#
# Claim 1 — tracking-ingester golden row count. Three statements must agree
# with the data-row count of golden/labeled.tsv, computed exactly the way
# `loadGolden()` in services/tracking-ingester-service/test/
# classify.golden.spec.ts parses it (non-blank lines, minus the single header):
#   * services/tracking-ingester-service/README.md  "across the N audited rows"
#   * test/classify.golden.spec.ts                  it("parses N labeled data rows")
#   * test/classify.golden.spec.ts                  expect(rows.length).toBe(N)
# ---------------------------------------------------------------------------
g9b_numeric_claims() {
  local guard="G9b(numeric-claims)"
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
# G10 — Relative markdown links resolve.
#
# Drift class: docs linking deleted docs. When a document is removed or moved,
# the links pointing at it are left behind and rot silently — the
# `code-review.md` dangling row found on 2026-07-29 is the recurring instance.
# Nothing in a markdown renderer fails on a dead relative link, so only a guard
# catches it.
#
# SCOPE — the corpus is the LIVE, descriptive documentation:
#   * root `README.md`
#   * `DOCS/**/*.md` — this now includes `DOCS/archive/**`, which T10 (ruling
#     D26) folded into the corpus. The archive is frozen PROSE, but its LINKS
#     are navigation and must still resolve, so a move that orphans an archived
#     doc fails here. Repointing a dead link is not rewriting a dated claim.
#   * `services/*/README.md`
#   * `packages/*/README.md`  — added beyond the SPEC's three globs because
#     these are first-class component docs of exactly the same class (written
#     in T04).
#   * `fixtures/bus-events/README.md` — the one surviving "section U" orphan,
#     added by T10 (ruling D6). It is a co-located component doc like the ones
#     above. (`knative/services/overlays/_components/README.md`, the other
#     orphan, was deleted by the same ruling.)
#   NOT `manual-loops/**`: loop history, deliberately frozen (SPEC decision 4),
#   and rewriting it to satisfy a link check would falsify the record.
#   `cowork/` no longer exists — T10 (ruling D3) dissolved it.
#
# SECOND CHECK — lowercase `docs/…` path references (T10, ruling D26).
# The tracked directory is `DOCS/`; `git ls-files | rg -c '^docs/'` is 0. A
# `docs/messaging/envelope.md` reference resolves on macOS (APFS is
# case-insensitive) and is a DEAD path on the Linux/minikube target this repo
# documents as first-class. T09 measured 31 such refs across `TAXONOMY.md` (25),
# `SCHEMAS.md` (4) and `DRIFT.md` (2); T10 corrected all of them. Those three
# root docs are therefore scanned for this check too (they are outside the link
# corpus above — they carry almost no relative links, but they are where this
# bug lived). To stay free of false positives the check fires ONLY when the
# lowercase path is dead AND its `DOCS/`-cased twin exists on disk, so a generic
# convention path in an example (e.g. `docs/decisions/0004-…md` in a skill) can
# never trip it.
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
g10_markdown_links_resolve() {
  local guard="G10(markdown-links-resolve)"
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
             [[ -f fixtures/bus-events/README.md ]] && echo "fixtures/bus-events/README.md"
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

  # --- lowercase `docs/…` path refs (D26) --------------------------------
  local case_files case_hits lc upper
  # LIVE docs only: DOCS/archive/** is excluded here (it IS in the link check
  # above). Those files are frozen records, and two of them QUOTE the lowercase
  # paths as the evidence of the very defect this check exists to prevent —
  # `DOCS-TRUTH-LEDGER.md`'s TAXONOMY row lists `docs/messaging/envelope.md`
  # and `docs/channels/channel-service.md` verbatim as what it found. Case-
  # correcting a quotation inside a dated record would falsify the record
  # (SPEC ground rule 2 / ruling D2), so the check does not look there.
  case_files=$( { echo "$files" | rg -v '^DOCS/archive/'
                  for f in TAXONOMY.md SCHEMAS.md DRIFT.md; do [[ -f "$f" ]] && echo "$f"; done
                } | sort -u )
  case_hits=$(rg --no-heading -o -n --with-filename \
    'docs/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*\.md' $case_files 2>/dev/null \
    | awk -F: '{print $1 "\t" $2 "\t" $3}' || true)
  local cf cl
  while IFS=$'\t' read -r cf cl lc; do
    [[ -z "$lc" ]] && continue
    upper="DOCS/${lc#docs/}"
    # A REAL repo path is one git does NOT track in lowercase while the
    # DOCS-cased twin exists on disk. A generic example path (a skill's
    # `docs/decisions/0004-….md`) never satisfies the second half.
    if [[ -e "$upper" ]] && ! git ls-files --error-unmatch "$lc" >/dev/null 2>&1; then
      fail "$guard: $cf:$cl references '$lc' — the tracked path is '$upper'. Lowercase resolves on macOS (case-insensitive APFS) and is DEAD on Linux/minikube"
      ok=0
    fi
  done <<<"$case_hits"

  [[ "$ok" -eq 1 ]] && pass "$guard: all $scanned relative .md links resolve; no lowercase docs/ path refs"
}

# ---------------------------------------------------------------------------
# G11 — Storage-engine documentation.
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
g11_storage_engine_documented() {
  local guard="G11(storage-engine-documented)"
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

# ---------------------------------------------------------------------------
# G12 — Every cross-cutting doc and component README declares its class.
#
# Drift class: the reader cannot tell an as-built description from a 2026-06
# handoff. Before T10 nothing marked doc class at all, and T01 of the
# docs-truth-audit had to reclassify four files by hand just to build its
# ledger. Ruling D1 makes the class explicit and this guard makes it stick.
#
# THE BANNER — two lines, both required, inside the first 10 lines of the file:
#
#   Class: descriptive|prescriptive|future|RECORD|register
#   Summary: <one line: what this file documents>
#
# The five classes:
#   descriptive   as-built. The code decides; drift here is a doc bug.
#   prescriptive  a contract/procedure the code is expected to obey.
#   future        not implemented yet (`DOCS/v_next/` is its only home).
#   RECORD        dated, frozen, never rewritten (`DOCS/adr/`, `DOCS/archive/`).
#   register      dated rows AMENDED IN PLACE — the hybrid D11 added because
#                 three tasks independently hit the same misfit.
#
# CORPUS — `DOCS/**/*.md` plus every `services/*/README.md` and
# `packages/*/README.md`. The 27 sample READMEs under `integrations/` and
# `demos/` are deliberately EXCLUDED (D1): they are customer-facing walkthroughs
# with their own conventions, not platform documentation of record.
# ---------------------------------------------------------------------------
g12_class_banner() {
  local guard="G12(class-banner)"
  local ok=1
  local count=0

  local files
  files=$( { fd -e md . DOCS
             fd -g 'README.md' services --max-depth 2
             fd -g 'README.md' packages --max-depth 2
           } 2>/dev/null | sort -u )

  if [[ -z "$files" ]]; then
    fail "$guard: corpus discovery returned nothing — the globs or fd broke"
    return
  fi

  local f head10 class
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    count=$((count + 1))
    head10=$(head -n 10 "$f")
    class=$(echo "$head10" | rg -o '^Class: (descriptive|prescriptive|future|RECORD|register)$' -r '$1' | head -1)
    if [[ -z "$class" ]]; then
      fail "$guard: $f has no valid 'Class:' line in its first 10 lines — expected one of descriptive|prescriptive|future|RECORD|register"
      ok=0
      continue
    fi
    if ! echo "$head10" | rg -q '^Summary: \S'; then
      fail "$guard: $f declares 'Class: $class' but has no non-empty 'Summary:' line in its first 10 lines (D1 requires both)"
      ok=0
    fi
  done <<<"$files"

  [[ "$ok" -eq 1 ]] && pass "$guard: all $count docs declare Class + Summary"
}

# ---------------------------------------------------------------------------
# G13 — Doc references written INSIDE source code stay true.
#
# Drift class: a comment names a doc, the doc moves or dies, and nothing fails.
# G10 checks links in docs; nothing checked doc PATHS in source until this
# guard. The docs-truth-audit found two live instances:
#   * E6 — six files under services/ and packages/ cited METERING-FOUNDATION.md
#     under a `DOCS/cowork/` prefix, a path that has NEVER existed in any layout
#     of this repo (the file lived at the repo-root `cowork/` until T10 archived
#     it). The real path is printed by this guard on failure.
#   * E4 — seven files pinned envelope.md at line 77 / 402. Ground rule 4 of the
#     audit: line cites rot within days, and envelope.md was rewritten twice
#     during the audit itself.
#
# (The examples above are deliberately written WITHOUT a literal
# `<dir>/<file>.md` path, so this guard does not flag its own documentation.)
#
# TWO CHECKS over `services/`, `packages/`, `sdk/` and `scripts/`
# (`node_modules`/`dist` excluded by fd/rg defaults plus the globs below):
#   1. every `DOCS/…`-shaped path mentioned in source exists on disk;
#   2. no `DOCS/….md:NNN` line cite exists at all — cite by section or symbol
#      name instead, which is what the audit converted them all to.
# `cowork/…`-shaped paths are checked by (1) as well: that root was dissolved by
# ruling D3, so any survivor is by definition dead.
# ---------------------------------------------------------------------------
g13_doc_paths_resolve() {
  local guard="G13(doc-paths-in-source)"
  local ok=1
  local roots="services packages sdk scripts"

  # 1) line cites — banned outright.
  local cites
  cites=$(rg --no-heading -n -o \
    -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/.angular/**' \
    '(DOCS|cowork)/[A-Za-z0-9._/-]+\.md:[0-9]+' \
    $roots 2>/dev/null || true)
  if [[ -n "$cites" ]]; then
    local c
    while IFS= read -r c; do
      [[ -z "$c" ]] && continue
      fail "$guard: $c is a line cite into a doc — line numbers rot (audit ground rule 4). Cite the section heading or the symbol name instead"
      ok=0
    done <<<"$cites"
  fi

  # 2) doc paths that do not exist on disk.
  local refs
  refs=$(rg --no-heading -n -o --with-filename \
    -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/.angular/**' \
    '(DOCS|cowork)/[A-Za-z0-9._/-]+\.md' \
    $roots 2>/dev/null \
    | awk -F: '{print $1 "\t" $2 "\t" $3}' || true)

  local scanned=0
  local rf rl rp
  while IFS=$'\t' read -r rf rl rp; do
    [[ -z "$rp" ]] && continue
    scanned=$((scanned + 1))
    if [[ ! -f "$rp" ]]; then
      fail "$guard: $rf:$rl cites the doc path '$rp' which does not exist on disk — fix the path or drop the reference"
      ok=0
    fi
  done <<<"$refs"

  [[ "$ok" -eq 1 ]] && pass "$guard: all $scanned doc paths cited from source resolve; no line cites"
}

# ---------------------------------------------------------------------------
# G14 — No NEW hard-coded hex colour literals in the admin console.
#
# AGENTS.md forbids hard-coded hex colours (design tokens exist for this). The
# clause has never been honoured: T09 measured 58 files under
# `services/admin-console/src/app/features` carrying a `#rrggbb` literal. Ruling
# D32 resolved the contradiction as a RATCHET rather than a big-bang cleanup:
# the clause now reads "no NEW hex literals", and this guard enforces exactly
# that by looking only at ADDED lines in the working tree's diff. The 58
# existing files are grandfathered debt and are not re-checked until touched.
#
# SCOPE — added lines (`+`, not `+++`) in `git diff HEAD -- services/admin-console`
# over `.ts`/`.html`/`.scss`/`.css`. With a clean tree the diff is empty and the
# guard is a no-op, which is the intended steady state.
# ---------------------------------------------------------------------------
g14_no_new_hex_colours() {
  local guard="G14(no-new-hex-colours)"
  local hits

  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    fail "$guard: not a git work tree — this guard reads 'git diff HEAD'"
    return
  fi

  hits=$(git diff HEAD --unified=0 -- \
           'services/admin-console/**/*.ts' \
           'services/admin-console/**/*.html' \
           'services/admin-console/**/*.scss' \
           'services/admin-console/**/*.css' 2>/dev/null \
         | rg '^\+[^+]' \
         | rg -i '#[0-9a-f]{6}\b' || true)

  if [[ -n "$hits" ]]; then
    fail "$guard: new hard-coded hex colour(s) added under services/admin-console — use the design tokens (AGENTS.md, styling rules). Offending added lines:"
    printf '%s\n' "$hits" | while IFS= read -r h; do printf '        %s\n' "$h"; done
    return
  fi
  pass "$guard: no new hard-coded hex colours in the working diff"
}

# ---------------------------------------------------------------------------
# G15 — Every consumer name written into an alert matcher is a real durable.
#
# Drift class: alert filters that name consumers nobody registers. The
# `nats-consumer-lag` group used to carry a
# `consumer_name=~"workflow-triggers|channel-webhook-ingress|auto-reply|channel-egress"`
# ALLOW-LIST: 4 names against the platform's 13 real durables, so every durable
# added after the list was written was born UNMONITORED, and nothing would have
# complained if one of the 4 had been renamed or deleted either. The matcher is
# now INVERTED (alert on every consumer, subtract explicit exclusions), and this
# guard is what keeps the inversion honest: the moment somebody adds a
# `consumer_name!~"..."` exclusion, every literal name in it must resolve to a
# real durable declaration in the code, or CI fails. A typo'd or stale exclusion
# name silences nothing and hides nothing — it just rots.
#
# WHAT IS SCANNED — only the parsed `expr:` values of every rule, pulled out of
# the ConfigMap's embedded `alerts.yml` block scalar with yq. Comments and
# annotations are therefore out of scope BY CONSTRUCTION: the syntax example in
# the nats-consumer-lag group comment and the `{{ $labels.consumer_name }}`
# templates in every annotation can never be mistaken for a live matcher.
#
# CLEAN-PASS CASE — with the exclusion list empty there is no consumer_name
# matcher at all, and the guard passes. It still runs its discovery first, so a
# broken discovery pattern fails loudly today rather than the day someone adds
# the first exclusion.
#
# THE DURABLE UNIVERSE — discovered from the code (never hardcoded), in four
# declaration shapes found in this repo:
#   1. `durableName: "<name>"`                      inline at the registration
#   2. `const …DURABLE…/…CONSUMER_NAME… = "<name>"` hoisted constant
#   3. `process.env.…DURABLE… ?? "<name>"`          env-overridable default
#      (services/usage-aggregator-service/src/config.ts)
#   4. const …DURABLE… = `${SOME_PREFIX}suffix`     composed name; the prefix
#      constant is resolved from its own declaration
#      (services/tracking-ingester-service/src/lib/consume-events.ts)
# `packages/` is scanned alongside `services/`: two real durables
# (`tenant-provisioner`, `gateway-audit-writer`) are declared as shared
# constants in packages/shared and consumed by a service, and treating them as
# unknown would make the guard reject a legitimate exclusion.
#
# A matcher token that is itself a regex (e.g. `trk-.*`) cannot be compared with
# a declaration; it is reported as skipped rather than silently accepted.
# ---------------------------------------------------------------------------
g15_alert_consumer_names() {
  local guard="G15(alert-consumer-names)"
  local alerts_file="infrastructure/base/observability/prometheus/alerts.yaml"
  local ok=1

  if [[ ! -f "$alerts_file" ]]; then
    fail "$guard: $alerts_file does not exist"
    return
  fi

  # --- the durable universe, discovered from the code --------------------
  # `_PREFIX` constants are dropped: `TRK_DURABLE_PREFIX = "trk-"` is a
  # fragment, not a durable; its composed names come from shape 4 below.
  local literal_durables
  literal_durables=$(rg --no-filename -o --type ts -g '!*.spec.ts' \
      -e 'durableName[[:space:]]*:[[:space:]]*"[^"]+"' \
      -e 'const[[:space:]]+[A-Za-z0-9_]*(DURABLE|CONSUMER_NAME)[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*"[^"]+"' \
      -e 'process\.env\.[A-Z0-9_]*DURABLE[A-Z0-9_]*[[:space:]]*\?\?[[:space:]]*"[^"]+"' \
      services packages 2>/dev/null \
    | rg -v '_PREFIX' \
    | sed -E 's/.*"([^"]+)".*/\1/' || true)

  # Shape 4 — composed names: resolve `${PREFIX}` from the prefix constant.
  local composed="" tmpl prefix_var suffix prefix_val
  while IFS= read -r tmpl; do
    [[ -z "$tmpl" ]] && continue
    prefix_var=$(echo "$tmpl" | sed -E 's/.*\$\{([A-Za-z0-9_]+)\}.*/\1/')
    suffix=$(echo "$tmpl" | sed -E 's/.*\$\{[A-Za-z0-9_]+\}([^`]*)`.*/\1/')
    prefix_val=$(rg --no-filename -o --type ts \
        "const[[:space:]]+${prefix_var}[[:space:]]*=[[:space:]]*\"[^\"]+\"" \
        services packages 2>/dev/null \
      | sed -E 's/.*"([^"]+)".*/\1/' | head -1)
    if [[ -z "$prefix_val" ]]; then
      note "$guard: composed durable '$tmpl' references \$$prefix_var, whose declaration was not found — that durable's real name cannot be checked"
      continue
    fi
    composed="$composed${prefix_val}${suffix}
"
  done <<<"$(rg --no-filename -o --type ts -g '!*.spec.ts' \
      'const[[:space:]]+[A-Za-z0-9_]*DURABLE[A-Za-z0-9_]*[[:space:]]*=[[:space:]]*`[^`]+`' \
      services packages 2>/dev/null || true)"

  local durables
  durables=$(printf '%s\n%s\n' "$literal_durables" "$composed" | rg '\S' | sort -u)

  if [[ -z "$durables" ]]; then
    fail "$guard: discovered no durable-consumer declarations under services/ or packages/ — the discovery patterns in $0 broke (durableName:/DURABLE_NAME/CONSUMER_NAME were renamed?)"
    return
  fi
  local durable_count
  durable_count=$(echo "$durables" | rg -c '\S')

  # --- consumer_name matchers written into the alert expressions ---------
  local exprs matchers names
  exprs=$(yq '.data."alerts.yml"' "$alerts_file" 2>/dev/null | yq '.groups[].rules[].expr' 2>/dev/null)
  if [[ -z "$exprs" ]]; then
    fail "$guard: could not read any rule expr out of $alerts_file — the ConfigMap layout changed (data.\"alerts.yml\" / groups[].rules[].expr), update $0"
    return
  fi

  matchers=$(echo "$exprs" \
    | rg -o 'consumer_name[[:space:]]*(=~|!~|!=|=)[[:space:]]*"[^"]*"' || true)

  if [[ -z "$matchers" ]]; then
    pass "$guard: no consumer_name matcher in $alerts_file — every JetStream consumer is alerted on (inverted pattern, no exclusions); $durable_count durable declarations known"
    return
  fi

  names=$(echo "$matchers" \
    | sed -E 's/.*"([^"]*)".*/\1/' \
    | tr '|' '\n' \
    | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' \
    | rg '\S' | sort -u || true)

  local checked=0
  local n
  while IFS= read -r n; do
    [[ -z "$n" ]] && continue
    case "$n" in
      *[.*+?\(\)\[\]\{\}^\$\\]*)
        note "$guard: matcher token '$n' is a regex, not a literal consumer name — not checked against a declaration"
        continue ;;
    esac
    checked=$((checked + 1))
    if ! grep -qx "$n" <<<"$durables"; then
      fail "$guard: $alerts_file filters on consumer_name '$n', which is not declared as a durable anywhere under services/ or packages/ — a dead name in an alert matcher monitors (or excludes) nothing. Real durables: $(echo "$durables" | tr '\n' ' ')"
      ok=0
    fi
  done <<<"$names"

  [[ "$ok" -eq 1 ]] && pass "$guard: all $checked consumer name(s) in $alerts_file matchers are real durables (of $durable_count declared)"
}

# G16 — bash 3.2 compliance (AGENTS.md universal rule 9, user ruling 2026-08-07).
# Repo shell scripts must run on macOS /bin/bash (3.2): no mapfile/readarray,
# no associative arrays (declare -A / typeset -A). `case` inside $() is also
# banned by the rule but has no reliable grep signature — reviewers own that one.
# Scans tracked *.sh files at repo root and under scripts/.
g16_bash32_compliance() {
  local guard="G16(bash32-compliance)"
  local ok=1 scanned=0 f= hits=

  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    scanned=$((scanned + 1))
    hits="$(rg -n --no-heading '^[^#]*\b(mapfile|readarray)\b|^[^#]*\b(declare|typeset)[[:space:]]+-[a-zA-Z]*A' "$f" || true)"
    if [[ -n "$hits" ]]; then
      fail "$guard: $f uses bash 4+ features (bash 3.2 is the repo baseline — AGENTS.md rule 9): $hits"
      ok=0
    fi
  done <<<"$(git ls-files '*.sh' 'scripts/**/*.sh')"

  [[ "$ok" -eq 1 ]] && pass "$guard: $scanned shell script(s) are bash 3.2 clean"
}

main() {
  g6a_service_inventory
  g6b_no_scaledobject
  g6c_autoscaling
  g6d_referenced_scripts_exist
  g6e_alert_names
  g6f_archive_banner
  g6g_no_component_agents_md
  g7_ack_wait_census
  g8_agent_call_timeout_ceiling
  g9_di_type_imports
  g9b_numeric_claims
  g10_markdown_links_resolve
  g11_storage_engine_documented
  g12_class_banner
  g13_doc_paths_resolve
  g14_no_new_hex_colours
  g15_alert_consumer_names
  g16_bash32_compliance

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
