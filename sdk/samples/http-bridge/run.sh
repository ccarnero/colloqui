#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# One-shot: resolve the dev env, make sure an http account exists, install deps,
# create the platform-side workflow, start the bridge, and send a test message.
. ../lib/resolve-env.sh

PORT="${PORT:-4000}"
step() { echo "[run] $*"; }
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

# ----- ensure an active http account (the SDK resolves its appSecret to ingest)
TOKEN="$(api -X POST "${YOIZEN_BASE_URL}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}" \
  | jq -r '.access_token // empty')"
HAS_HTTP="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/channels/accounts?channel=http" \
  | jq -r 'if type=="array" then ([.[] | select(.isActive)] | length) else 0 end')"
if [ "${HAS_HTTP:-0}" -eq 0 ]; then
  step "no active http account — creating an 'http-bridge' instance..."
  api -H "Authorization: Bearer ${TOKEN}" -X POST "${YOIZEN_BASE_URL}/api/channels/accounts" \
    -H 'Content-Type: application/json' \
    -d '{"channel":"http","provider":"http","name":"HTTP Bridge","externalId":"http-bridge","accessToken":"http-ingest","isActive":true}' \
    >/dev/null
fi

step "installing deps..."
pnpm install --silent

step "creating the platform-side workflow (http channel -> append '-received')..."
( cd artifacts && ./create-workflow.sh ) >/dev/null

step "starting the bridge on :${PORT}..."
node server.js &
BRIDGE_PID=$!
trap 'kill "$BRIDGE_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  curl -fsS -m 1 "http://localhost:${PORT}/health" >/dev/null 2>&1 && break
  sleep 0.5
done

step "sending a test message..."
curl -s -X POST "http://localhost:${PORT}/messages" -H 'content-type: application/json' \
  -d '{"text":"hola desde run.sh"}' | jq .

step "bridge running (PID ${BRIDGE_PID}). POST more to http://localhost:${PORT}/messages — Ctrl+C to stop."
wait "$BRIDGE_PID"
