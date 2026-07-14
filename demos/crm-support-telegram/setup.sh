#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# setup.sh — orchestrates 01-telegram-channel.sh -> 05-workflow.sh in order
# =============================================================================
#
# Runs every numbered provisioning script sequentially, fail-fast, with a
# numbered [N/5] stage log line before/after each one. Nothing beyond the env
# sourcing below is resolved here — each 0N-<artifact>.sh remains a
# self-contained thin wrapper (mirrors sdk/samples/http-bridge); this script
# only sequences them and enforces the fail-fast contract.
#
# RECOVERY: every child script is IDEMPOTENT (create-or-update by
# name/externalId — see each script's own header comment). If any stage
# fails, fix the reported cause (bad token, unreachable cluster, etc.) and
# just re-run `./setup.sh` from the top — already-provisioned stages
# reconcile to the same state instead of duplicating, so re-running
# setup.sh IS the recovery path. There is no separate "resume from stage N"
# flag on purpose: idempotency makes one uniform recovery command the
# correct one for the human to remember at 2am.
#
# Required env (see README.md "Environment variables" + each 0N-*.sh's own
# header comment for what it individually requires):
#   HUBSPOT_SERVICE_KEY   — HubSpot Service Key / private-app Bearer token
#   TELEGRAM_BOT_TOKEN     — from @BotFather
#   TG_PUBLIC_URL          — public HTTPS base (e.g. cloudflared tunnel) the
#                            Telegram webhook must be reachable at
#   OPENAI_API_KEY         — backing model for the support agent
#   YOIZEN_TENANT/EMAIL/PASSWORD/BASE_URL — platform login; auto-defaulted to
#                            the shared dev-seed convention by
#                            lib/resolve-demo-env.sh when not already set
# Optional: TELEGRAM_TEST_CHAT_ID (auto-discovered by 01 if unset — DM the
#   bot first), YOIZEN_HOST_HEADER, PLATFORM_ENVIRONMENT.
#
# Env sourcing (SPEC T07): loads, in order, sdk/samples/ai-agent-playground/.env,
# sdk/samples/telegram-transform-reply/.env, then this demo's own .env — see
# lib/resolve-demo-env.sh for the full rationale.
# =============================================================================
# shellcheck source=lib/resolve-demo-env.sh
# shellcheck disable=SC1091  # resolvable only relative to this script's cwd (see `cd` above), not shellcheck's invocation dir
. lib/resolve-demo-env.sh

STAGES=(
  "01-telegram-channel.sh"
  "02-hubspot-connector.sh"
  "03-ai-agent.sh"
  "04-priority-scorer.sh"
  "05-workflow.sh"
)
TOTAL=${#STAGES[@]}

for i in "${!STAGES[@]}"; do
  n=$((i + 1))
  script="${STAGES[$i]}"
  echo ""
  echo "[setup] [${n}/${TOTAL}] start: ${script}"

  output_file="$(mktemp)"

  if ! "./${script}" 2>&1 | tee "${output_file}"; then
    echo "" >&2
    echo "[setup] [${n}/${TOTAL}] FAILED: ${script}" >&2
    echo "[setup] fix the cause above, then re-run './setup.sh' from the top —" >&2
    echo "[setup] every stage is idempotent (create-or-update by name/externalId)," >&2
    echo "[setup] so re-running setup.sh IS the recovery path; already-provisioned" >&2
    echo "[setup] stages reconcile instead of duplicating." >&2
    rm -f "${output_file}"
    exit 1
  fi

  # 01-telegram-channel.sh's own output contract prints
  # "webhook_registered=<bool>" as its last diagnostic line (its
  # src/01-telegram-channel.ts `isDirectRun` block). The script still exits 0
  # in that case BY DESIGN (an unregistered webhook is a soft/best-effort
  # outcome noted there, not a thrown SDK/API error) — so setup.sh, as the
  # ONE caller allowed to read its own sibling script's documented stdout
  # contract (not a general "parse child stdout" pattern — see README.md
  # "the orchestrator and later scripts never parse this script's stdout"),
  # treats webhook_registered=false as a hard failure here: nothing else
  # downstream can detect a customer-facing bot with no working webhook.
  if [ "${script}" = "01-telegram-channel.sh" ] && ! grep -q "webhook_registered=true" "${output_file}"; then
    echo "" >&2
    echo "[setup] [${n}/${TOTAL}] ${script} reported webhook_registered=false — hard failure." >&2
    echo "[setup] Check TG_PUBLIC_URL is reachable from the internet and TELEGRAM_BOT_TOKEN" >&2
    echo "[setup] is valid, then re-run './setup.sh' (idempotent recovery)." >&2
    rm -f "${output_file}"
    exit 1
  fi

  rm -f "${output_file}"
  echo "[setup] [${n}/${TOTAL}] done:  ${script}"
done

echo ""
echo "[setup] all ${TOTAL}/${TOTAL} stages complete."
echo "[setup] run './run.sh' for the end-to-end proof (simulated inbound, execution polling, HubSpot cleanup)."
