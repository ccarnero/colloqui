#!/usr/bin/env bash
# =============================================================================
# resolve-demo-env.sh — shared env-sourcing convention for setup.sh and run.sh
# =============================================================================
#
# SOURCE this from setup.sh / run.sh (`. lib/resolve-demo-env.sh`), never from
# a numbered 0N-*.sh script (those stay standalone thin wrappers per the
# http-bridge pattern — see each script's own header comment). This file is
# an orchestrator-only concern, not a provisioning artifact, so it is exempt
# from the "one script per artifact" rule.
#
# Per SPEC T07 ("Env: reuse the same env sourcing convention"), this loads —
# in order, later files override earlier ones — the three `.env` files the
# task names explicitly:
#   1. sdk/samples/ai-agent-playground/.env   (OPENAI_API_KEY, etc.)
#   2. sdk/samples/telegram-transform-reply/.env (TELEGRAM_BOT_TOKEN, TG_PUBLIC_URL —
#      convenient reuse if the human already set these up for that sample)
#   3. demos/crm-support-telegram/.env         (this demo's own secrets —
#      HUBSPOT_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TG_PUBLIC_URL, OPENAI_API_KEY,
#      TELEGRAM_TEST_CHAT_ID — see .env.example)
# All three are optional (`.env` is git-ignored); a missing file is skipped,
# not an error — the human may have set everything via real shell exports
# instead.
#
# YOIZEN_TENANT/EMAIL/PASSWORD/BASE_URL are NOT expected to live in any of
# those `.env` files (see ai-agent-playground/.env.example — they're commented
# out, auto-resolved). This file supplies the SAME dev-seed defaults
# `sdk/samples/lib/resolve-env.sh` computes (acme / yclawd@demo.io / admin123
# / http://api-gateway.platform-services-<env>.<domain>), so every 0N-*.ts
# script's `requireEnv("YOIZEN_*")` preflight succeeds without the human
# hand-exporting them, exactly like every other SDK sample's run.sh already
# does via that shared lib. Not sourcing `sdk/samples/lib/resolve-env.sh`
# itself here on purpose — that file derives its target `.env` from
# `BASH_SOURCE[1]` (the CALLING script's directory), which would silently
# load the wrong `.env` when sourced from this indirection layer; replicating
# the (small) default-resolution logic inline keeps the loaded-`.env` set
# exactly the three files named above.
#
# Exports: YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL,
# YOIZEN_HOST_HEADER (+ whatever the three .env files themselves set).
# =============================================================================

__demo_dir="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd)"
__repo_root="$(cd "${__demo_dir}/../.." && pwd)"

for __env_file in \
  "${__repo_root}/sdk/samples/ai-agent-playground/.env" \
  "${__repo_root}/sdk/samples/telegram-transform-reply/.env" \
  "${__demo_dir}/.env"; do
  if [ -f "${__env_file}" ]; then
    echo "[env] loading ${__env_file}"
    set -a
    # shellcheck disable=SC1090
    . "${__env_file}"
    set +a
  fi
done

# Dev-seed defaults — mirrors sdk/samples/lib/resolve-env.sh exactly (same
# tenant/email/password, same GW_HOST derivation) so this demo's login
# preflight (every 0N-*.ts's `requireEnv("YOIZEN_*")`) behaves identically to
# every other SDK sample without duplicating that file's full port-forward /
# reachability-probe logic (not needed here — the demo talks to the cluster
# ingress host directly, same as 01-05's already-proven Host-header pattern).
__ywai_env="${PLATFORM_ENVIRONMENT:-dev}"
__dev_domain="${DEV_DOMAIN:-${MINIKUBE_DOMAIN:-dev.local}}"
__gw_host="api-gateway.platform-services-${__ywai_env}.${__dev_domain}"

export YOIZEN_TENANT="${YOIZEN_TENANT:-acme}"
export YOIZEN_EMAIL="${YOIZEN_EMAIL:-yclawd@demo.io}"
export YOIZEN_PASSWORD="${YOIZEN_PASSWORD:-admin123}"
export YOIZEN_BASE_URL="${YOIZEN_BASE_URL:-http://${__gw_host}}"
export YOIZEN_HOST_HEADER="${YOIZEN_HOST_HEADER:-${__gw_host}}"

echo "[env] gateway=${YOIZEN_BASE_URL}  host=${YOIZEN_HOST_HEADER}  tenant=${YOIZEN_TENANT}"
