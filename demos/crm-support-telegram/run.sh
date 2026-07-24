#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# run.sh — end-to-end proof for the crm-support-telegram demo
# =============================================================================
#
# Thin bash wrapper over src/06-run-e2e.ts (mirrors sdk/examples/reference-pattern
# and this demo's own bootstrap.sh/run.sh convention — see their header
# comments). All driver logic (contact/deal seeding, simulated inbound x2,
# execution polling, assertions, HubSpot cleanup, admin-console run-view
# URLs) lives there; this script only resolves env and execs the TypeScript
# entrypoint.
#
# PREREQUISITE (T06): the manifest must have been applied at least once —
# `./bootstrap.sh` -> `yoizen manifests apply -f manifest.yaml
# --secrets-from-env` -> `./run.sh`. 06-run-e2e.ts verifies this itself as
# its first real stage (workflow + service present by name) and fails fast
# with this exact order if either is missing, before drilling into any
# individual artifact resolution.
#
# Env sourcing: same convention as bootstrap.sh — see lib/resolve-demo-env.sh.
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
