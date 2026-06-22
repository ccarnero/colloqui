#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# =============================================================================
# telegram-onboard.sh — one script, just the bot token. It does:
#   1. resolve the dev gateway env (lib/resolve-env.sh)  -> endpoint/host/creds
#   2. login to the platform                              -> API token
#   3. validate the bot token (getMe)
#   4. get YOUR chat_id (deleteWebhook -> you DM the bot -> getUpdates)
#   5. upsert the Telegram channel account with the token (so SEND works)
#   6. register the inbound webhook (setWebhook) when TG_PUBLIC_URL is set
#   7. print a summary + write http-fanout-telegram/.env so ./run.sh is ready
#
# Usage (the ONLY required input is the bot token):
#   TELEGRAM_BOT_TOKEN=123:ABC ./telegram-onboard.sh
#   ./telegram-onboard.sh 123:ABC
# Optional:
#   TG_PUBLIC_URL=https://your-tunnel   # to register the webhook (real inbound)
#   TG_RECREATE=1                       # rotate the account's token/secret
#   POLL_TIMEOUT_S=90                   # how long to wait for your DM
# =============================================================================

# Resolves YOIZEN_* / TG_* + loads a sibling .env (see lib/resolve-env.sh).
. lib/resolve-env.sh

BOT="${TELEGRAM_BOT_TOKEN:-${1:-}}"
PUBLIC="${TG_PUBLIC_URL:-}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-90}"
EXTERNAL_PREFIX="${TG_EXTERNAL_ID:-onboard-bot}"
ACCOUNT_NAME="${TG_ACCOUNT_NAME:-Onboarded Bot}"

step() { echo -e "\n[onboard] $*"; }
die()  { echo "[onboard][ERR] $*" >&2; exit 1; }

command -v jq   >/dev/null || die "jq is required"
command -v curl >/dev/null || die "curl is required"
[ -n "$BOT" ] || die "missing bot token. Usage: TELEGRAM_BOT_TOKEN=<token> ./telegram-onboard.sh"

# Telegram Bot API helper:  tg <method> [curl-args...]
tg()  { curl -s "https://api.telegram.org/bot${BOT}/$1" "${@:2}"; }
# Platform helper (tenant-scoped). Bearer added by apiauth once we have a token.
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

# ----- 1. platform API token -------------------------------------------------
step "1/6 login a la plataforma (${YOIZEN_BASE_URL})..."
TOKEN="$(api -X POST "${YOIZEN_BASE_URL}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}" \
  | jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || die "login falló — ¿está arriba el port-forward (./port-forward.sh dev)?"
apiauth() { api -H "Authorization: Bearer ${TOKEN}" "$@"; }
echo "[onboard] API token OK (${TOKEN:0:24}…)"

# ----- 2. validate the bot token ---------------------------------------------
step "2/6 validando el bot (getMe)..."
ME="$(tg getMe)"
echo "$ME" | jq -e '.ok == true' >/dev/null 2>&1 \
  || die "token de bot inválido: $(echo "$ME" | jq -r '.description // .')"
BOT_USERNAME="$(echo "$ME" | jq -r '.result.username')"
echo "[onboard] bot @${BOT_USERNAME}"

# ----- 3. chat_id (sin romper un webhook existente) --------------------------
step "3/6 obteniendo tu chat_id..."
PREV_WEBHOOK="$(tg getWebhookInfo | jq -r '.result.url // empty' 2>/dev/null || true)"
WEBHOOK_REMOVED=0

# Preferimos un chat_id ya conocido (env / .env / cache) para NO tocar el webhook.
CHAT_ID="${TELEGRAM_CHAT_ID:-}"
[ -z "$CHAT_ID" ] && [ -f .telegram-chat-id ] && CHAT_ID="$(cat .telegram-chat-id 2>/dev/null || true)"

if [ -n "$CHAT_ID" ]; then
  echo "[onboard] chat_id ya conocido (${CHAT_ID}) — no toco el webhook"
else
  # Sólo aquí necesitamos getUpdates, que NO funciona con un webhook activo, así
  # que lo quitamos un momento. Es SEGURO mientras lo volvamos a registrar al
  # final — y eso pasa cuando hay TG_PUBLIC_URL (paso 5). Sólo abortamos si hay
  # un webhook y NO lo vamos a restaurar (sin TG_PUBLIC_URL y sin opt-in).
  if [ -n "$PREV_WEBHOOK" ] && [ -z "$PUBLIC" ] && [ "${RESET_WEBHOOK:-0}" != "1" ]; then
    die "ese bot YA tiene un webhook activo (${PREV_WEBHOOK}); leer el chat_id requiere quitarlo un momento.
       Para que haga TODO de una (chat_id + re-registrar el webhook a la plataforma), pasá tu URL pública:
         TG_PUBLIC_URL=<tu-url-publica> ./telegram-onboard.sh ${BOT}
       Si NO querés tocar el webhook, dame el chat_id (de @userinfobot):
         TELEGRAM_CHAT_ID=<id> ./telegram-onboard.sh ${BOT}"
  fi
  tg deleteWebhook >/dev/null 2>&1 || true
  WEBHOOK_REMOVED=1
  [ -n "$PREV_WEBHOOK" ] && echo "[onboard][WARN] quité temporalmente el webhook (${PREV_WEBHOOK}) para leer el chat_id"
  echo "[onboard] >>> Escribile CUALQUIER mensaje al bot @${BOT_USERNAME} en Telegram ahora <<<"
  deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    CHAT_ID="$(tg getUpdates | jq -r '[.result[].message.chat.id] | last // empty' 2>/dev/null || true)"
    [ -n "$CHAT_ID" ] && break
    sleep 2
  done
  [ -n "$CHAT_ID" ] || die "no llegó ningún mensaje en ${POLL_TIMEOUT_S}s. Escribile al bot y reintentá."
fi
echo "[onboard] chat_id = ${CHAT_ID}"

# ----- 4. upsert the Telegram account (so SEND works) ------------------------
step "4/6 registrando la cuenta de Telegram con el token..."
EXISTING="$(apiauth "${YOIZEN_BASE_URL}/api/channels/accounts?channel=telegram" \
  | jq -c --arg p "$EXTERNAL_PREFIX" \
      'if type=="array" then ([.[] | select((.externalId // "") | startswith($p)) | select(.isActive)] | .[0] // empty) else empty end')"

ACCOUNT_ID=""; SECRET=""
if [ -n "$EXISTING" ] && [ "${TG_RECREATE:-0}" != "1" ]; then
  ACCOUNT_ID="$(echo "$EXISTING" | jq -r '.id')"
  SECRET="$(echo "$EXISTING" | jq -r '.appSecret // empty')"
  echo "[onboard] reusando cuenta ${ACCOUNT_ID} (TG_RECREATE=1 para rotar token/secret)"
else
  EXTID="${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}"
  RESP="$(apiauth -X POST "${YOIZEN_BASE_URL}/api/channels/accounts" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg n "$ACCOUNT_NAME" --arg e "$EXTID" --arg t "$BOT" \
         '{channel:"telegram",provider:"telegram",name:$n,externalId:$e,telegramBotToken:$t,accessToken:$t,isActive:true}')")"
  ACCOUNT_ID="$(echo "$RESP" | jq -r '.id // empty')"
  SECRET="$(echo "$RESP" | jq -r '.appSecret // empty')"
  [ -n "$ACCOUNT_ID" ] || die "no se pudo crear la cuenta: $RESP"
  echo "[onboard] creada cuenta ${ACCOUNT_ID} (externalId=${EXTID})"
fi
[ -n "$SECRET" ] && echo "[onboard] appSecret (webhook secret) = ${SECRET:0:8}…" \
                 || echo "[onboard][WARN] sin appSecret a mano — corré con TG_RECREATE=1 para acuñar uno"

# ----- 5. register the webhook (needs a public HTTPS URL) --------------------
step "5/6 registrando el webhook..."
WEBHOOK_URL="${PUBLIC%/}/api/webhooks/telegram/${YOIZEN_TENANT}"
if [ -n "$PUBLIC" ] && [ -n "$SECRET" ]; then
  WH="$(tg setWebhook \
    --data-urlencode "url=${WEBHOOK_URL}" \
    --data-urlencode "secret_token=${SECRET}" \
    --data-urlencode 'allowed_updates=["message","channel_post"]')"
  if echo "$WH" | jq -e '.ok == true' >/dev/null 2>&1; then
    echo "[onboard] webhook registrado -> ${WEBHOOK_URL}"
  else
    echo "[onboard][WARN] setWebhook: $(echo "$WH" | jq -r '.description // .')"
  fi
else
  echo "[onboard] TG_PUBLIC_URL no seteado — salteo setWebhook (Telegram necesita una URL HTTPS pública)."
  if [ "$WEBHOOK_REMOVED" = "1" ] && [ -n "$PREV_WEBHOOK" ]; then
    echo "[onboard][WARN] OJO: te quité el webhook que tenías en ${PREV_WEBHOOK} y NO puedo restaurarlo"
    echo "[onboard][WARN] con su secret (Telegram no lo expone). Re-registralo cuando quieras:"
    echo "[onboard][WARN]   TG_PUBLIC_URL=<tu-url> ./telegram-onboard.sh ${BOT}   (o tu setup previo)"
  else
    echo "[onboard] cuando tengas el túnel: TG_PUBLIC_URL=https://tu-tunel ./telegram-onboard.sh ${BOT}"
  fi
fi

# ----- 6. cache + leave the fanout sample ready ------------------------------
step "6/6 guardando resultados..."
printf '%s\n' "$CHAT_ID" > .telegram-chat-id
FANOUT_ENV="http-fanout-telegram/.env"
if [ -e "$FANOUT_ENV" ]; then
  echo "[onboard] ${FANOUT_ENV} ya existe — NO lo piso (tu chat_id es ${CHAT_ID})"
else
  { echo "TELEGRAM_CHAT_ID=${CHAT_ID}"; echo "TELEGRAM_BOT_TOKEN=${BOT}"; } > "$FANOUT_ENV"
  echo "[onboard] escrito ${FANOUT_ENV}"
fi

echo
echo "[onboard] ===== LISTO ====="
echo "  bot          @${BOT_USERNAME}"
echo "  chat_id      ${CHAT_ID}"
echo "  API token    ${TOKEN:0:24}…   (vence; re-login cuando haga falta)"
echo "  cuenta TG    ${ACCOUNT_ID}"
echo "  appSecret    ${SECRET:-<none>}"
echo "  webhook      ${PUBLIC:+${WEBHOOK_URL}}${PUBLIC:-<sin TG_PUBLIC_URL>}"
echo
echo "  Siguiente:   (cd http-fanout-telegram && ./run.sh)   # usa el chat_id de arriba"
