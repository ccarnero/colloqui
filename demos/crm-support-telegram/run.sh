#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# run.sh — end-to-end proof for the crm-support-telegram demo (SPEC T07)
# =============================================================================
#
# Thin bash wrapper over src/06-run-e2e.ts (mirrors sdk/examples/reference-pattern
# and this demo's own 0N-*.sh convention — see their header comments). All
# driver logic (contact/deal seeding, simulated inbound x2, execution
# polling, assertions, HubSpot cleanup, admin-console run-view URLs) lives
# there; this script only resolves env and execs the TypeScript entrypoint.
#
# PREREQUISITE: `./setup.sh` must have completed successfully at least once
# — 06-run-e2e.ts resolves every platform artifact (telegram account,
# demo-hubspot connector, crm-support-agent, priority-scorer service,
# crm-support-telegram workflow) BY NAME and fails fast naming the missing
# 0N-*.sh if any is absent, exactly like 05-workflow.ts already does.
#
# Env sourcing (SPEC T07): same convention as setup.sh — see
# lib/resolve-demo-env.sh.
#
# E2E CLEANUP (SPEC): every HubSpot artifact this run creates directly
# (seeded contact, seeded VIP deals) is tagged "[E2E] ..." and deleted in a
# trap-guarded (SIGINT/SIGTERM) `finally` block inside 06-run-e2e.ts, even on
# a failed assertion — idempotent, 404s tolerated. The VIP ticket the
# WORKFLOW itself creates (via priority-scorer's async create-ticket invoke)
# is identified by its returned invocationId instead of a subject tag — see
# 06-run-e2e.ts's header comment for why (SPEC deviation, documented there
# and in manual-loops/crm-support-telegram.md "Findings (T07)"). Provisioned
# PLATFORM artifacts (channel, connector, agent, workflow, service) are
# NEVER torn down — they ARE the demo.
# =============================================================================
# shellcheck source=lib/resolve-demo-env.sh
# shellcheck disable=SC1091  # resolvable only relative to this script's cwd (see `cd` above), not shellcheck's invocation dir
. lib/resolve-demo-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[run] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/06-run-e2e.ts
else
  exec npx tsx src/06-run-e2e.ts
fi
