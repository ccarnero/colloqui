# telegram-transform-reply

A sibling of [`http-bridge`](../../../sdk/examples/reference-pattern), from the **automation side** of the platform.
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

The Telegram path is driven entirely by the platform's built-in `TelegramProvider`. You don't
write an adapter; you **configure an account** that activates it, plus the workflow. Provisioning
is **declarative**: a single [`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI
(no setup scripts).

## What `manifest.yaml` provisions

1. **A Telegram channel account** (`telegram-transform-reply-bot`) — wires the built-in adapter for
   **receive + send**:
   - **receive** — the webhook is verified against the account's auto-generated `appSecret`;
   - **send** — the account stores the **bot token**, supplied at apply time from the
     `telegram-bot-token` secret binding (see below), NEVER stored in the repo.
2. **A workflow** (`telegram-transform-reply`) — `message_received` trigger on channel
   `telegram`, with `transform` (jsFunction) → `reply` (channelSend, `to: {{request.from}}`,
   `accountId: {{request.envelope.accountId}}`). Those templates are resolved per-request by
   workflow-service, so the workflow stays valid regardless of which account the message came from.
3. **A secret binding** (`telegram-bot-token`, scope `channel:telegram-transform-reply-bot`) — the
   bot token's binding; its VALUE is provided via `--secrets-from-env` at apply time.

> **Trigger scope note.** The old script pinned the trigger to a specific account id (`TG_PIN=1`).
> A manifest cannot express a not-yet-created account id (manifest v1 has no manifest-time id
> substitution), so the manifest uses the unpinned trigger: it fires on any Telegram message for
> the tenant. In a single-Telegram-account tenant this is behaviorally equivalent.

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
- A **real** Telegram bot token from [@BotFather](https://t.me/BotFather) — required for sending.
- The `yoizen` CLI available. One-time: `cd sdk && bun link` (then `yoizen ...` works anywhere), or
  run it directly without linking via `cd sdk && bun run bin/yoizen.ts ...`.
- Environment for the CLI (same precedence as the SDK client):
  - `YOIZEN_BASE_URL` — e.g. `http://127.0.0.1:8080`
  - `YOIZEN_HOST_HEADER` — the gateway ingress Host, e.g. `api-gateway.platform-services-dev.dev.local`
  - `YOIZEN_TENANT` (`acme`), `YOIZEN_EMAIL`, `YOIZEN_PASSWORD`
- The secret VALUE env var, read verbatim by `--secrets-from-env` (the binding name IS the env var
  name — no transform):
  - `telegram-bot-token` — your @BotFather bot token.

## Provision (declarative)

Validate the manifest, preview the plan, then apply — supplying the secret value from the
environment (never from the repo). The binding name contains a hyphen, so pass it via `env`:

```bash
cd sdk && bun link           # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/channels/telegram-transform-reply/manifest.yaml
yoizen manifests plan     -f ../integrations/channels/telegram-transform-reply/manifest.yaml
env 'telegram-bot-token=123456:ABC-your-bot-token' \
  yoizen manifests apply  -f ../integrations/channels/telegram-transform-reply/manifest.yaml --secrets-from-env
```

`plan` prints a per-resource verdict table (create/update/noop); a second `apply` is a no-op once
converged. To rotate the token, re-run `apply` with a new `telegram-bot-token` value.

## Run / exercise

After apply, just message your bot → it replies
`Echo: <your text> — processed at <ISO ms> (epoch_ms=...)`.

For **real inbound**, Telegram needs a **public HTTPS URL** to reach the gateway (it never calls
`localhost`). Register the webhook once against the per-instance path
`/api/webhooks/telegram/<tenant>/<externalId>` (externalId `manifest:telegram-transform-reply-bot`),
using the account's `appSecret` as the `secret_token`:

```bash
# appSecret: GET the account after apply, e.g. via the gateway /api/channels/accounts
curl -s "https://api.telegram.org/bot<token>/setWebhook" \
  --data-urlencode "url=https://<your-public-host>/api/webhooks/telegram/acme/manifest:telegram-transform-reply-bot" \
  --data-urlencode "secret_token=<appSecret>"
```

> **Root cause + why you may need to do this by hand.** `channel-service`
> already self-registers the webhook on account creation
> (`registerTelegramWebhook`, `services/channel-service/src/modules/accounts/accounts.service.ts`),
> using `channelServiceConfig.channelServicePublicUrl`
> (`services/channel-service/src/config.ts:25`) as the URL base. If
> `CHANNEL_SERVICE_PUBLIC_URL` is unset on the deployment, that base falls
> back to the internal `http://` cluster URL — Telegram rejects `setWebhook`
> with `bad webhook: An HTTPS URL must be provided`, so the account ends up
> with **no webhook at all** and inbound messages queue at Telegram until
> you register it manually. Once `CHANNEL_SERVICE_PUBLIC_URL` is set (e.g.
> `https://api.devmachina.net/api`) on `channel-service`, self-registration
> succeeds on account creation and this manual step disappears entirely.
>
> `apply` does not surface the account's auto-generated `appSecret` in its
> own output. The primary way to read it is the authenticated gateway
> endpoint `GET /api/channels/accounts/<id>`, which returns `appSecret` on
> the account DTO (`services/channel-service/src/modules/accounts/accounts.service.ts:36`).
> Using the `auth()` helper defined under Troubleshooting below (bearer +
> `x-yoizen-tenant` headers):
>
> ```bash
> # list accounts, find the one with externalId manifest:telegram-transform-reply-bot, read its appSecret
> auth "$GW/api/channels/accounts" \
>   | jq -r '.[] | select(.externalId=="manifest:telegram-transform-reply-bot") | .appSecret'
> ```
>
> Dev fallback — if you don't have a bearer token handy, read it straight
> from Postgres instead:
>
> ```bash
> kubectl exec -n support-services-dev postgres-shared-1 -c postgres -- \
>   psql -U postgres -d tenant_acme -At -c \
>   "SELECT app_secret FROM channel_accounts WHERE external_id='manifest:telegram-transform-reply-bot';"
> ```
>
> Full registration call used to remediate this live (JSON body, includes
> `allowed_updates`/`max_connections`):
>
> ```bash
> curl -X POST "https://api.telegram.org/bot<token>/setWebhook" \
>   -H 'Content-Type: application/json' \
>   -d '{
>     "url": "https://api.devmachina.net/api/webhooks/telegram/acme/manifest:telegram-transform-reply-bot",
>     "secret_token": "<appSecret from the query above>",
>     "allowed_updates": ["message", "channel_post"],
>     "max_connections": 40
>   }'
> ```

To drive the chain **without** a public URL (injects a synthetic inbound update straight at the
gateway), use the run driver — it needs the account's webhook secret and a real chat id:

```bash
cd integrations/channels/telegram-transform-reply
TELEGRAM_WEBHOOK_SECRET=<appSecret> TELEGRAM_TEST_CHAT_ID=<your-numeric-chat-id> ./run.sh
```

`TELEGRAM_TEST_CHAT_ID` must be a real chat that has already `/start`-ed the bot (a fake id makes
the workflow run but Telegram rejects the reply with `Bad Request: chat not found`). The driver
waits up to 60 s for a workflow execution and prints it (`id`, `status`, timestamps).

## Persistence & reuse

The account lives in the per-tenant Postgres DB and the workflow in Mongo, so both **persist across
restarts/redeploys**. Re-applying the manifest reconciles them (idempotent — a converged re-apply
is a no-op). Only a data wipe (full re-bootstrap / `DROP TABLE`) removes them — then just re-apply.

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
| `404 Not Found` | bot token is wrong/placeholder | re-`apply` with the real `telegram-bot-token` value |
| `401 Unauthorized` | token revoked | re-issue via @BotFather, re-`apply` |
| `400 chat not found` | bad `to`/chat id (or bot not `/start`-ed) | message the bot first; `from.id` = chat id for private chats |
| `circuit_open … cooldown` | the egress **circuit breaker** tripped after repeated failures | `kubectl rollout restart deploy/channel-service-worker -n $NS` |

### `getWebhookInfo` shows the wrong URL / 404s

The gateway has a global prefix `api`, so the webhook path is **`/api/webhooks/telegram/<tenant>/<externalId>`**.
The platform's auto-registration omits `/api`; if your bot points at `/webhooks/...` (no `/api`),
Telegram 404s and nothing is ingested. Register the correct path with `setWebhook` as shown above.

### Message received but no `send` event at all

If the trace shows a `received` row with no matching `send`, the workflow didn't fire. Inspect it:

```bash
auth "$GW/api/workflows" | jq '.[] | select(.name=="telegram-transform-reply") | {id, trigger, reply: (.actions[]|select(.name=="reply").args)}'
# the manifest trigger is unpinned: trigger.config is {channels:["telegram"], providers:["telegram"]}
```

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
