#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# bootstrap — the ONLY provisioning script left after the manifest migration
# (manual-loops/crm-support-telegram.md T04). Carries EXCLUSIVELY the items
# the T01 audit dispositioned as genuinely out-of-band for the manifest
# engine: the priority-scorer Docker image build, the HubSpot custom contact
# property `telegram_user_id`, and Telegram webhook registration +
# TELEGRAM_TEST_CHAT_ID discovery. Everything else this demo needs lives in
# `manifest.yaml`, applied with `yoizen manifests apply -f manifest.yaml
# --secrets-from-env`.
# =============================================================================
#
# Thin bash wrapper over src/bootstrap.ts (mirrors this demo's other
# numbered scripts and integrations/http/hosted-services-api's pattern). The
# actual logic (docker build, HubSpot Properties API, Telegram Bot API) lives
# there, run via `@yoizen/platform-sdk`; this script only checks
# prerequisites and execs the TypeScript entrypoint with the caller's
# environment in scope.
#
# ORDER: bootstrap.sh -> yoizen manifests apply --secrets-from-env -> run.sh
# (the webhook-registration stage reads the manifest-created Telegram channel
# account by name, so it must run AFTER the first apply — running bootstrap.sh
# before the first apply will fail loud at that stage with a clear message,
# not silently skip it).
#
# Required env (not resolved here — see README.md "Environment variables";
# sourced the same way setup.sh/run.sh do via lib/resolve-demo-env.sh):
#   YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL
#   HUBSPOT_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TG_PUBLIC_URL
# Optional: YOIZEN_HOST_HEADER, SCORER_IMAGE_TAG, TELEGRAM_TEST_CHAT_ID,
#   TELEGRAM_CHAT_ID, TG_CHAT_ID_CACHE_FILE, PLATFORM_ENVIRONMENT
#
# IDEMPOTENT — safe to re-run: the image build is a plain re-tag, the HubSpot
# property ensure is create-if-missing, webhook registration only calls
# `setWebhook` when the live URL differs, and chat-id discovery reuses a
# cached/explicit value before polling again.
# =============================================================================
#
# DIR RESOLUTION (BASH_SOURCE-based, no cwd assumptions — mirrors the
# 0N-*.sh wrappers' own `cd "$(dirname "${BASH_SOURCE[0]}")"` pattern, widened
# to an ABSOLUTE path because this script — unlike the 0N-*.sh wrappers —
# also SOURCES lib/resolve-demo-env.sh, and that file resolves ITS OWN caller
# directory via `dirname "${BASH_SOURCE[1]}"` relative to the CURRENT cwd at
# the moment it is sourced (see its own header comment). Changing cwd with a
# relative `cd "$(dirname "${BASH_SOURCE[0]}")"` BEFORE sourcing it would make
# that second, relative resolution double-descend into the already-changed
# cwd whenever this script is invoked via a multi-segment relative path
# (e.g. `./demos/crm-support-telegram/bootstrap.sh` from the repo root) — so
# SCRIPT_DIR is resolved to an ABSOLUTE path FIRST, resolve-demo-env.sh is
# sourced BEFORE any `cd` happens (while cwd is still the caller's original,
# unmodified cwd, exactly like the 0N-*.sh wrappers never move cwd out from
# under a script they source), and only THEN does this script `cd` into
# SCRIPT_DIR for its own docker-build/node_modules/tsx invocations below.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

# shellcheck source=lib/resolve-demo-env.sh
# shellcheck disable=SC1091  # resolvable only relative to SCRIPT_DIR, not shellcheck's invocation dir
. "${SCRIPT_DIR}/lib/resolve-demo-env.sh"

cd "${SCRIPT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "[bootstrap] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[bootstrap] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[bootstrap] 'docker' was not found on PATH — required to build the priority-scorer image." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[bootstrap] node_modules missing — running npm install..."
  npm install
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/bootstrap.ts
else
  exec npx tsx src/bootstrap.ts
fi
