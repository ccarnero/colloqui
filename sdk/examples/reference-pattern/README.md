# http-bridge

> **Now SDK-powered.** Both `./run.sh` and `./setup.sh` resolve the dev environment (same as
> before) and then exec a small Node/TypeScript app that drives the platform through
> `@yoizen/platform-sdk` (see [`sdk/README.md`](../../README.md)) — `client.workflows.list()`,
> `client.channels.listAccounts()`, `client.workflows.create()`, and `client.webhooks.ingest()`
> replace the old inline `curl`+`jq` calls. `./setup.sh` (`src/setup.ts`) still talks directly to
> `api.telegram.org` for bot chat_id discovery (`getWebhookInfo`/`deleteWebhook`/`getUpdates`/
> `setWebhook`) — that's the raw Telegram Bot API, not our platform SDK's concern.
> Other samples migrate as follow-ups per [`sdk/GROWTH-PLAN.md`](../../GROWTH-PLAN.md) Phase 3
> (P3.1).

A workflow that, on **any message arriving over a dedicated HTTP channel instance**, **echoes**
the received payload (text/from/metadata) plus added timestamp data, and **DMs the result to you
over Telegram** (`channelSend`). It is the HTTP-channel counterpart to
[`telegram-transform-reply`](../../../integrations/channels/telegram-transform-reply) — same echo-and-reply shape, different
inbound transport — and follows the same idempotent provisioning style as
[`http-fanout-telegram`](../../../integrations/channels/http-fanout-telegram).

```
HTTP msg ─► trigger (message_received, channels:["http"], pinned to this sample's own instance)
              │
              ▼
            echo      jsFunction — honors ctx.request.{text,from,metadata}, adds an ISO
                       timestamp + epoch ms, returns { text }
              ▼
            notify (branch, PARALLEL — always built, two recipients)
              ├── notifyPrimary    channelSend  telegram → TELEGRAM_CHAT_ID    (text = echo.text)
              └── notifySecondary  channelSend  telegram → TELEGRAM_CHAT_ID_2  (text = echo.text)
```

> `notify` is always a `branch` with two arms. If `TELEGRAM_CHAT_ID_2` couldn't be pinned or
> discovered, `notifySecondary` gets wired with the SAME `to` as `notifyPrimary` (both arms send to
> the one known chat) — edit that one field in the workflow builder UI once you have a real second
> chat_id.

## How each step maps to the engine

Verified against `services/workflow-service/src/temporal/workflows.ts`:

| Step | Activity | Notes |
| --- | --- | --- |
| Receive a message on this sample's HTTP instance | `trigger: message_received`, `channels:["http"]`, `config.accountIds:[<this instance>]` | Pinned so only messages posted to this instance's ingest URL fire this workflow |
| Echo + timestamp | `jsFunction` | Reads `ctx.request.text` / `ctx.request.from` / `ctx.request.metadata`, adds an ISO-8601 timestamp and epoch ms, returns `{ text }` |
| Telegram reply | `channelSend` | `to` → your Telegram `chat_id`; published to the egress stream, delivered by the bot |

## Message flow

| # | From | Transport | Subject / URL | To |
|---|------|-----------|---------------|----|
| 1 | HTTP client | HTTPS POST · `x-http-channel-token: <appSecret>` | `/api/webhooks/http/acme/http-bridge` | api-gateway |
| 2 | api-gateway | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingress) | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · workflow `runWorkflow` | workflow-service worker |
| 5 | workflow-service worker · `jsFunction` activity (echo) | local (in-process) | task queue `workflow-orchestrator` | workflow-service worker |
| 6 | workflow-service worker · `channelSend` activity (notify) | NATS core publish · captured by `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 7 | channel-service-worker (egress) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

> `jsFunction` and `channelSend` (hops 5–6) run in-process on the `workflow-orchestrator` worker —
> there's no `connector-runtime` hop in this sample, unlike `http-fanout-telegram`.

## Prerequisites

This script only wires the **dedicated HTTP instance** and the **workflow**. Provision the
Telegram side first:

1. **A Telegram channel account** with a real bot token:
   ```bash
   env 'telegram-bot-token=123:ABC-…' \
     yoizen manifests apply -f integrations/channels/telegram-transform-reply/manifest.yaml --secrets-from-env
   ```
2. **You (and optionally a second recipient) must have `/start`-ed the bot.** A bot cannot
   cold-message a phone number — Telegram addresses recipients by `chat_id`. You don't need to look
   up the `chat_id` yourself: `setup.sh` fetches the bot's own token from the platform and calls
   Telegram's `getUpdates` for you, auto-filling `TELEGRAM_CHAT_ID` (and `TELEGRAM_CHAT_ID_2`, if a
   second person has also `/start`-ed it) from whoever has messaged the bot most recently.

## Run

```bash
cd sdk/examples/reference-pattern
cp .env.example .env   # optional — only needed to pin chat_ids or override defaults
./setup.sh
# [STEP]  2/3 resolve telegram account + http instance
# [INFO]  telegram account=…
# [INFO]  discovered telegram chats (most recent first):
# [INFO]    chat_id=111222333  (christian)
# [INFO]  auto-selected TELEGRAM_CHAT_ID=111222333 (most recent chat)
# [INFO]  telegram chat_id=111222333
# [INFO]  created HTTP instance … (externalId=http-bridge)
# [STEP]  3/3 ensure workflow 'http-bridge'
# [INFO]  created workflow id=…
```

The script logs in, **resolves the Telegram `accountId`** (or creates/reuses it if you pass
`TG_ACCOUNT_ID`), **auto-discovers chat_ids** from the bot's recent messages (unless you pinned them
via env), **creates a dedicated HTTP channel instance** (`externalId = http-bridge`), and builds the
workflow with its trigger **pinned to that instance** (`config.accountIds = [<that account>]`). So
this workflow fires **only** for messages sent to its own instance — never on unrelated HTTP
traffic. **`RECREATE` defaults to `1`**, so every run rebuilds the HTTP instance and the workflow
from scratch with whatever chat_ids were just resolved — set `RECREATE=0` to go back to reusing an
existing workflow by name instead.

### Drive it end to end

This workflow has its **own ingest URL** — the last path segment is its instance `externalId`
(`/api/webhooks/http/<tenant>/http-bridge`). Either run `./run.sh` (installs dependencies on first
run, then drives `client.workflows.list()` → `client.channels.listAccounts()` →
`client.webhooks.ingest()` through the SDK to resolve the token and post a test payload for you),
or POST straight to it as a manual fallback (`setup.sh` prints the exact URL and token at the end):

```bash
./run.sh
# or manually, bypassing the SDK entirely:
curl -X POST 'http://localhost:8080/api/webhooks/http/acme/http-bridge' \
  -H 'content-type: application/json' \
  -H 'x-http-channel-token: <app-secret-printed-by-setup>' \
  -d '{"from":"me","text":"hola","metadata":{"source":"manual"}}'
```

The message hits **this instance** → the workflow fires (and no other) → the `echo` step builds
the reply → the bot DMs you:

```
Echo: hola (from=me, metadata={"source":"manual"}) — processed at 2026-07-03T11:22:33.456Z (epoch_ms=1751541753456)
```

### Drive it from another device (public URL)

The `localhost`/`*.dev.local` URLs only resolve on the dev machine (they depend on its hosts file
and port-forward). To POST from a phone, another laptop, or any external client, go through the
same cloudflared tunnel the Telegram webhook uses:

```bash
curl -X POST 'https://api.devmachina.net/api/webhooks/http/acme/http-bridge' \
  -H 'content-type: application/json' \
  -H 'x-http-channel-token: <app-secret-printed-by-setup>' \
  -d '{"from":"my-device","text":"hola","metadata":{"source":"phone"}}'
```

The tunnel (see `~/.cloudflared/config.yml` on the dev machine) maps the public hostname to
`localhost:8080` and rewrites the `Host` header to the gateway's ingress route, so external
clients need no hosts-file entries or custom headers beyond the channel token.

Requirements and caveats:

- Both the **cloudflared tunnel** and the **port-forward on 8080** must be running on the dev
  machine. If either is down, requests fail silently from the client's perspective — nothing
  reaches the gateway, no error appears in cluster logs. Check these two first when a test
  produces no workflow execution.
- The URL is **public internet**: anyone holding the channel token can inject messages into the
  tenant. Acceptable for a dev sandbox only — rotate the instance (re-run `setup.sh` with
  `RECREATE=1`) if the token leaks.
- Hitting the dev machine's LAN IP directly (e.g. `http://192.168.1.x:8080`) does NOT work from
  a plain client: the ingress routes by `Host` header, so requests to a bare IP 404 unless the
  client sets the gateway host header manually. The public URL avoids this entirely.

### Retrieve the channel token later

The `x-http-channel-token` value is the HTTP instance's `appSecret`. `setup.sh` prints it at
creation, but it can be re-fetched any time from the accounts API:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'x-yoizen-tenant: acme' \
  "$BASE_URL/api/channels/accounts?channel=http" \
  | jq -r '.[] | select(.externalId=="http-bridge") | .appSecret'
```

## Environment

`setup.sh` resolves the dev environment inline (this sample does not depend on
`integrations/lib`), which loads a `.env` file from this
directory (if present) and detects the gateway endpoint. Place secrets and overrides in `.env`
next to `setup.sh` — no manual sourcing needed.

| Var | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_CHAT_ID` | auto-discovered | Your numeric Telegram chat id. Set to pin it; otherwise `setup.sh` picks the most recently active chat from the bot's `getUpdates` |
| `TELEGRAM_CHAT_ID_2` | auto-discovered, else same as `TELEGRAM_CHAT_ID` | Second recipient's numeric chat id — that person must have `/start`-ed the same bot first. Set to pin it; otherwise auto-filled from the next most recently active distinct chat. If none is found, `notifySecondary` falls back to `TELEGRAM_CHAT_ID` (both arms send to the same chat) instead of failing — the `notify` branch is always built with two arms |
| `TG_ACCOUNT_ID` | first active telegram account | Pin a specific Telegram channel account |
| `YOIZEN_BASE_URL` | dev gateway | Gateway base URL |
| `YOIZEN_HOST_HEADER` | dev gateway host | `Host` header for the dev ingress |
| `YOIZEN_TENANT` / `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` | `acme` / `yclawd@demo.io` / `admin123` | Tenant + login |
| `BRIDGE_WORKFLOW_NAME` | `http-bridge` | Workflow name |
| `BRIDGE_HTTP_EXTERNAL_ID` | `http-bridge` | Dedicated HTTP instance externalId |
| `BRIDGE_HTTP_ACCOUNT_NAME` | `HTTP Bridge` | Dedicated HTTP instance display name |
| `BRIDGE_PIN` | `1` | `1` pins the trigger to the dedicated HTTP instance via `accountIds`; `0` lets any HTTP message on the tenant fire it |
| `BRIDGE_RESTORE_WEBHOOK` | `1` | Chat-id discovery must clear any active webhook to poll `getUpdates`; `1` restores that same webhook URL afterward, `0` leaves the bot in polling mode |
| `BRIDGE_DISCOVER_WAIT_SECONDS` | `60` | If a webhook was active, the cap on the interactive "press Enter once everyone has messaged the bot" prompt (or the sleep duration in non-interactive shells) |
| `BRIDGE_DISCOVER_POLL_INTERVAL` | `2` | Seconds between the few post-confirmation retries that absorb Telegram's own delivery lag |
| `RECREATE` | `1` | Deletes + recreates the HTTP instance and the workflow on every run by default; set `0` to reuse an existing one by name instead |
| `BRIDGE_APPLICATION` | `samples` | `application` tag stamped on the workflow this sample creates (`src/setup.ts`) |
| `RUN_TEXT` | `hola desde run.sh` | Body text `run.sh` posts; `src/index.ts` appends ` [<epoch seconds>]` so each run is distinguishable |

The shell wrappers additionally read `YWAI_ENV` (`dev`), `API_GATEWAY_PORT`
(`8080`) and `DEV_DOMAIN` / `MINIKUBE_DOMAIN` (`dev.local`) while resolving the
gateway — see the inlined resolver at the top of `run.sh` / `setup.sh`.

## Design notes & gotchas

- **`{{…}}` templating is string-coercing.** The resolver does `String(value)` on each leaf, so
  the `echo` step hands off a plain **string** (`text`) rather than a nested object — the later
  `notify` step references it via `{{results.echo.text}}`.
- **The HTTP channel is ingest-only**, so Telegram is the reply path by design — there's no "reply
  over HTTP". Same design as `http-fanout-telegram`.
- **`BRIDGE_PIN=1` (the default)** pins the trigger to the dedicated HTTP instance via
  `accountIds: [<http-bridge account id>]`, so only messages sent to its own ingest URL fire this
  workflow. Set `BRIDGE_PIN=0` to remove the pin and let any HTTP message on the tenant trigger it
  (the stale-pin trap described in the Telegram sample's troubleshooting still applies if the
  account is recreated while the workflow retains the old id).
- **`setup.sh` is SDK-powered** (`src/setup.ts`, `@yoizen/platform-sdk`): `client.channels.*` and
  `client.workflows.*` replace the old inline `curl`+`jq` provisioning calls. Telegram bot
  token/chat_id discovery still talks directly to `api.telegram.org` — that's the raw Telegram Bot
  API, which isn't part of the platform SDK's surface. It supersedes the old vendored
  `@yoizen/http-sdk` Node bridge (`server.js`) and the old `artifacts/create-workflow.sh`
  provisioning script, and also fixes the old sample's biggest gap: the previous workflow had no
  `channelSend` step, so its result went nowhere.
- **`run.sh` is SDK-powered** (`src/index.ts`, `@yoizen/platform-sdk`): `client.webhooks.ingest()`
  is the generic escape hatch (`POST /webhooks/:channel/:tenantId/:instance`) that accepts
  arbitrary caller headers, so it can pass the http channel's `x-http-channel-token` exactly like
  the old inline `curl` call did.
- **`ctx.request.metadata`** is honored if present but not required — the minimal payload is just
  `{"text": "..."}`.
- **`channelSend.to` is a single string, not a list.** There's no comma-separated or array form —
  the validator and the `ChannelSendArgs` type both require `to: string`. To notify more than one
  recipient you must fan out with a `branch`, one `channelSend` arm per recipient — which is why
  `notify` is always built as a branch here, never a single `channelSend`. Each recipient also has
  to have `/start`-ed the bot individually — a bot can't cold-message anyone by phone number or
  chat id.
- **The second recipient may just duplicate the first.** If `TELEGRAM_CHAT_ID_2` can't be pinned or
  discovered, `notifySecondary.args.to` falls back to the same value as `notifyPrimary` so the
  workflow still gets created with the right shape (both arms send, both land in your chat) — open
  it in the workflow builder UI and swap in the real second chat_id once you have it (Custom
  number field on the `notifySecondary` node).
- **`discover_chat_ids` relies on the platform handing back the bot's plaintext `accessToken`** via
  `GET /api/channels/accounts?channel=telegram` — confirmed unmasked in
  `services/channel-service/src/modules/accounts/accounts.service.ts` (only the separate
  `POST /channels/accounts/:id/refresh-token` endpoint masks its token). If that account was
  created with a placeholder token (no real `TELEGRAM_BOT_TOKEN` at `telegram-transform-reply`
  setup time), discovery is skipped with a warning and you must set `TELEGRAM_CHAT_ID` manually.
  Discovery also only sees chats Telegram still has buffered for `getUpdates` — old `/start`s can
  age out if the bot has since made other API calls without acknowledging them.
- **`getUpdates` 409s if a webhook is registered.** Telegram allows only one delivery mode per bot
  token — `channel-service` self-registers a webhook when the `telegram-transform-reply` channel
  account is provisioned (via its `manifest.yaml` apply), and polling `getUpdates` while it's active
  fails with `Conflict: can't use getUpdates method while webhook is active`.
  `discover_chat_ids` handles this automatically: it reads the current webhook via
  `getWebhookInfo`, clears it with `deleteWebhook`, polls, then restores the exact same URL via
  `setWebhook` (`BRIDGE_RESTORE_WEBHOOK=1`, the default). Set `BRIDGE_RESTORE_WEBHOOK=0` to leave
  the bot in polling mode instead — to get webhook delivery back, call `setWebhook` yourself (see
  `integrations/channels/telegram-transform-reply/README.md` § "Run / exercise" for the exact
  procedure). Re-applying the manifest against the existing account does **not** re-register the
  webhook — `channel-service` self-registers it only on channel-account *creation*, so the only
  manifest path is to delete the channel account and re-apply.
- **Old `/start`s don't replay after clearing the webhook — not even ones sent before this run.**
  Telegram treats updates already pushed through an active webhook as delivered and never hands
  them back via `getUpdates`, even after `deleteWebhook`. So if a webhook was active,
  `discover_chat_ids` clears it, then **blocks with an interactive prompt** — "press Enter once
  everyone has sent a message" — capped at `BRIDGE_DISCOVER_WAIT_SECONDS` (default `60`) so it
  can't hang forever. In a non-interactive shell (no TTY) it just sleeps that duration instead of
  prompting. Either way, once the wait ends it retries `getUpdates` a few times
  (`BRIDGE_DISCOVER_POLL_INTERVAL`, default `2`s apart) to absorb Telegram's own delivery lag. The
  key thing: **send `/start` only after the "ask everyone to send /start... NOW" log line** — a
  message sent before the webhook was cleared is unrecoverable, no amount of waiting will find it.
  If nobody messages in time, it warns and leaves the chat_id(s) unset — just re-run `setup.sh`.
- **Login returns an empty error / ingress answers 404?** Check the `[env]` banner: if
  `gateway=…dev.local` but `host=…sslip.io` (or any mismatch), a stale `MINIKUBE_DOMAIN` /
  `DEV_DOMAIN` exported in your shell is poisoning the derived `Host` header, and the ingress has
  no route for it. Fix with `unset MINIKUBE_DOMAIN DEV_DOMAIN`, or override per run:

  ```bash
  YOIZEN_HOST_HEADER=api-gateway.platform-services-dev.dev.local ./setup.sh
  ```

  The same applies to `run.sh` — both resolve the host inline (no shared lib dependency).
- **Calling the ingest URL from a phone or another LAN device?** `*.dev.local` only resolves
  on the host machine, and iOS silently drops custom `Host` headers, so neither the default
  hostname nor the header workaround reaches the ingress from external clients. Create a Knative
  `DomainMapping` (plus its manual `ClusterDomainClaim`) on an `sslip.io` name pointing at the
  gateway — see "Accessing the dev gateway from other devices" in `DOCS/guides/onboarding.md`.
  The client then posts to `http://api-gateway.<LAN_IP>.sslip.io/api/webhooks/http/<tenant>/<instance>`
  with only `x-http-channel-token` and `Content-Type` headers. The mapping is pinned to the LAN IP —
  recreate it if the machine's address changes. Note the ingest response is always
  `{"status":"accepted"}`: the workflow runs asynchronously and the echo arrives on Telegram,
  never in the HTTP response.
