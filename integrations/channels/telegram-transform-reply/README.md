# telegram-transform-reply

A sibling of [`http-bridge`](../http-bridge), from the **automation side** of the platform.
A message that arrives on **Telegram** is transformed by a workflow (echo + a millisecond
timestamp) and **replied back over Telegram** to the same chat.

```
Telegram msg ──► api-gateway (/api/webhooks/telegram/<tenant>/<externalId>)
                   │
                   ▼
              channel-service-worker (ingress) (verify webhook secret, publish canonical event)
                   │  evt.<tenant>.channel-service.messaging.telegram.telegram.received.v1
                   ▼
              workflow-service (message_received trigger)
                   │  1. transform (jsFunction): echo + millisecond timestamp
                   │  2. reply     (channelSend): to = same chat
                   ▼
              channel-service-worker (egress) ──► Telegram reply
```

Like `http-bridge`, this sample is powered by `@yoizen/platform-sdk` (`setup.sh`/`run.sh` are thin
wrappers around `src/setup.ts`/`src/index.ts`) — but the Telegram path itself is driven entirely
by the platform's built-in `TelegramProvider`. You don't write an adapter; you **configure an
account** that activates it, plus the workflow. One script does it all.

## What `setup.sh` creates

1. **A Telegram channel account** — wires the built-in adapter for **receive + send**:
   - **receive** — the webhook is verified against the account's auto-generated `appSecret`;
   - **send** — the account stores the **bot token** the egress path uses;
   - the `appSecret` is cached locally in `.telegram-sample-secret` (gitignored).
2. **A workflow** (`telegram-transform-reply`) — `message_received` trigger on channel
   `telegram`, with `transform` (jsFunction) → `reply` (channelSend, `to: {{request.from}}`,
   `accountId: {{request.envelope.accountId}}`).
3. **Webhook registration** — if you pass `TG_PUBLIC_URL`, it calls Telegram `setWebhook` at the
   per-instance URL `/api/webhooks/telegram/<tenant>/<externalId>` with the matching secret.

Idempotent and verbose. Re-running **reuses** the account (matched by `externalId` prefix) and
the workflow (matched by name). `RECREATE=1` rebuilds both from scratch.

## Message flow

| # | From | Transport | Subject / URL | To |
|---|------|-----------|---------------|----|
| 1 | Telegram | HTTPS POST | `/api/webhooks/telegram/acme/<externalId>` | api-gateway |
| 2 | api-gateway | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.api-gateway.messaging.telegram.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingress) | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · workflow `runWorkflow` | workflow-service worker |
| 5 | workflow-service worker · `jsFunction` activity | local (in-process) | task queue `workflow-orchestrator` | workflow-service worker |
| 6 | workflow-service worker · `channelSend` activity | NATS core publish · captured by `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 7 | channel-service-worker (egress) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

> `channel-service-worker` handles both ingress (hops 2–3) and egress (hops 6–7) — the API pod (`channel-service-api`) only manages accounts and configuration. The `jsFunction` activity (hop 5) runs in-process on the same worker; no extra service hop.

## Prerequisites

- A running dev cluster (`scripts/orbstack/startup.sh` or `scripts/minikube/startup.sh`) with a
  provisioned tenant (`acme` by default), reachable (e.g. Kourier port-forward on `localhost:8080`).
- `jq` and `curl`.
- A **real** Telegram bot token from [@BotFather](https://t.me/BotFather) — required for sending.
- For **real inbound**, a **public HTTPS URL** Telegram can reach (Telegram only calls public
  URLs — `localhost`/minikube isn't reachable directly). A [cloudflared](https://github.com/cloudflare/cloudflared)
  tunnel works well:

  ```bash
  # config maps your public host -> localhost:8080 with the gateway Host header
  cloudflared tunnel --config ~/.cloudflared/config.yml run
  ```

## Run

Place secrets in `.env` next to `setup.sh` (loaded automatically):

```bash
# integrations/channels/telegram-transform-reply/.env
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
# Base URL only. Do not include /api/webhooks/telegram/... here.
TG_PUBLIC_URL=https://api.devmachina.net
```

Then run:

```bash
cd integrations/channels/telegram-transform-reply
./setup.sh
```

Then message your bot → it replies `Echo: <your text> — processed at <ISO ms> (epoch_ms=...)`.

Drive the chain without a real message (injects a synthetic inbound update straight at the gateway):

```bash
SIMULATE_INBOUND=1 TELEGRAM_TEST_CHAT_ID="<your-numeric-chat-id>" ./setup.sh
```

`TELEGRAM_TEST_CHAT_ID` must be a real chat that has already `/start`-ed the bot. The script fails
fast without it because a fake id makes the workflow run but Telegram rejects the reply with
`Bad Request: chat not found`.

## Configuration (env)

| Var | Default | Notes |
| --- | --- | --- |
Gateway coordinates (`YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`, `YOIZEN_PASSWORD`) are auto-detected by `resolve-env.sh`. Override them in `.env` if needed.

| Var | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | placeholder | Bot token from @BotFather. **Required for sending** — the account stores it. |
| `TG_PUBLIC_URL` | — | Public HTTPS **base URL** for your tunnel, e.g. `https://api.devmachina.net`. Do not include `/api/webhooks/telegram/...`; the script appends the webhook path. If you accidentally pass a full webhook path, the script normalizes it and warns. |
| `TG_WORKFLOW_NAME` | `telegram-transform-reply` | Workflow name. |
| `TG_EXTERNAL_ID` | `telegram-sample-bot` | Account externalId **prefix** (each create appends a unique suffix). |
| `RECREATE` | `0` | `1` rebuilds the account **and** the workflow from scratch. |
| `TG_PIN` | `1` | `1` pins the workflow trigger to this account via `accountIds`. `0` lets any Telegram message on the tenant fire it. |
| `SIMULATE_INBOUND` | `0` | `1` injects a synthetic inbound update. |
| `TELEGRAM_TEST_CHAT_ID` | — | Required for a real reply when simulating. |

## Persistence & reuse

The account lives in the per-tenant Postgres DB and the workflow in Mongo, so both **persist
across restarts/redeploys**. Re-running `setup.sh` reuses them. `RECREATE=1` rotates the token
/ rebuilds the workflow. Only a data wipe (full re-bootstrap / `DROP TABLE`) removes them — then
just re-run `setup.sh`.

## Troubleshooting

These are the real traps we hit getting this working end to end. The platform's traceability is
your friend: every hop persists `correlation_id` / `causation_id` / `trace_id`, queryable via the
audit endpoints below.

### Receiving works but the bot never replies

Receiving and sending use **different credentials**, so inbound succeeding tells you *nothing*
about the send path:

- **RECEIVE** — `channel-service` verifies the `x-telegram-bot-api-secret-token` header against
  the account's **`appSecret`** (the webhook secret). Never touches the bot token.
- **SEND** — `channel-service-worker` (egress) calls `https://api.telegram.org/bot<botToken>/sendMessage`.
  This is the **only** place the bot token is used.

So an account can hold a junk bot token and still receive perfectly. Check the **worker** egress
log (account creation is `channel-service-api`; sending is `channel-service-worker`):

```bash
NS=platform-services-dev   # your namespace
kubectl logs -n $NS -l app.kubernetes.io/name=channel-service-worker -c user-container --tail=50 \
  | grep -iE 'telegram|send'
```

Telegram error codes you'll see there:

| Code | Meaning | Fix |
| --- | --- | --- |
| `404 Not Found` | bot token is wrong/placeholder | re-run with the real `TELEGRAM_BOT_TOKEN` + `RECREATE=1` |
| `401 Unauthorized` | token revoked | re-issue via @BotFather |
| `400 chat not found` | bad `to`/chat id (or bot not `/start`-ed) | message the bot first; `from.id` = chat id for private chats |
| `circuit_open … cooldown` | the egress **circuit breaker** tripped after repeated failures | `kubectl rollout restart deploy/channel-service-worker -n $NS` |

### `getWebhookInfo` shows the wrong URL / 404s

The gateway has a global prefix `api`, so the webhook path is **`/api/webhooks/telegram/<tenant>/<externalId>`**.
The platform's auto-registration omits `/api`; if your bot points at `/webhooks/...` (no `/api`),
Telegram 404s and nothing is ingested. Fix by passing `TG_PUBLIC_URL` (the script registers the
correct path). `TG_PUBLIC_URL` should be the base URL only:

```bash
TG_PUBLIC_URL=https://api.devmachina.net ./setup.sh
```

Manual equivalent:

```bash
# replace <externalId> with the value logged during setup (e.g. telegram-sample-bot-1700000000-12345)
curl -s "https://api.telegram.org/bot<token>/setWebhook" \
  --data-urlencode "url=https://api.devmachina.net/api/webhooks/telegram/acme/<externalId>" \
  --data-urlencode "secret_token=$(cat .telegram-sample-secret)"
curl -s "https://api.telegram.org/bot<token>/getWebhookInfo" | jq   # url ends in /api/.../<externalId>
```

### `500 duplicate key … channel_accounts_channel_external_id_key`

The `(channel, external_id)` unique key is global, and a delete may not free it in dev. That's
why this script appends a **unique suffix** to every created `externalId` and matches reuse by
the prefix — so recreates never collide. If you hit this manually, just use a fresh `externalId`.

### Message received but no `send` event at all

If the trace shows a `received` row with no matching `send`, the workflow didn't fire — usually a
**stale/reused workflow** whose `trigger.config.accountIds` is pinned to an old account id, so the
matcher skips messages from the new one. Inspect and rebuild:

```bash
auth "$GW/api/workflows" | jq '.[] | select(.name=="telegram-transform-reply") | {id, trigger, reply: (.actions[]|select(.name=="reply").args)}'
# with TG_PIN=1 (default): trigger.config.accountIds should contain the CURRENT account id
# with TG_PIN=0: trigger.config should be just {channels:["telegram"], providers:["telegram"]}
```

A stale `accountIds` value (pointing to a deleted or rotated account) is the most common cause.
`RECREATE=1` rebuilds both account and workflow together, so the pinned id is always current.
If you rotated the account without `RECREATE=1`, run it now to fix the stale pin.

### Trace a message across services

```bash
# helper (refresh the token when it 401s)
GW=http://localhost:8080; HH=api-gateway.platform-services-dev.127.0.0.1.sslip.io
TOKEN=$(curl -s -X POST $GW/api/auth/login -H "Host: $HH" -H 'Content-Type: application/json' \
  -d '{"email":"yclawd@demo.io","password":"admin123","tenant_id":"acme"}' | jq -r .access_token)
auth() { curl -s -H "Host: $HH" -H "Authorization: Bearer $TOKEN" -H 'x-yoizen-tenant: acme' "$@"; }

# in/out messaging events — a 'received' + a 'send' under the same correlationId = full round trip
auth "$GW/api/audit/channel-events?channel=telegram&limit=6" | jq '.events | map({kind, correlationId, createdAt})'

# platform events under one correlation (did workflow-service run?)
auth "$GW/api/audit/events?correlation_id=<CID>&limit=50" | jq '.events | map({type, createdAt})'
```

> The chain-tree endpoints (`/audit/channel-events/chain/:correlationId`) live on `audit-service`
> directly — they aren't re-exposed through the gateway proxy, which only offers the list + by-id
> routes. Use the list above through the gateway, or `kubectl port-forward svc/audit-service` for
> the tree.

## How replies are routed

Telegram inbound messages carry the sender's chat id as `from` (`telegram.provider.ts` →
`parseTelegramMessage`). The workflow reads it as `{{request.from}}` and `channelSend` maps `to`
→ Telegram `chat_id`, so the bot replies to the **same chat**. `accountId` uses
`{{request.envelope.accountId}}` (the inbound message's own account), so the workflow stays valid
even when the account is recreated.
