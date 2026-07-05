# http-fanout-telegram

> **Now SDK-powered.** Both `./run.sh` and `./setup.sh` resolve the dev environment (same as
> before) and then exec a small Node/TypeScript app that drives the platform through
> `@yoizen/platform-sdk` (see [`sdk/README.md`](../../README.md)) — `client.connectors.list()`,
> `client.channels.listAccounts()`, `client.workflows.create()`, and `client.webhooks.ingest()`
> replace the old inline `curl`+`jq` calls. `./run.sh` (`src/index.ts`) still shells out to
> `../http-connectors/setup.sh` (and, if `TELEGRAM_BOT_TOKEN` is set, `../telegram-transform-reply/setup.sh`)
> since those sibling samples aren't SDK-ported yet.

A workflow that, on **any message arriving over the HTTP channel**, fans out **three connector
calls in parallel**, **joins** their responses, **POSTs** the result to the httpbin connector, and
**DMs you a summary over Telegram**. It stitches together the two other samples —
[`http-connectors`](../http-connectors) (the outbound connectors) and
[`telegram-transform-reply`](../telegram-transform-reply) (the Telegram channel account) — into one
end-to-end flow.

```
HTTP msg ─► trigger (message_received, channels:["http"])
              │
              ├── branch (PARALLEL) ──► getPost      endpointCall  jsonplaceholder GET /posts/1
              │                          getPokemon   endpointCall  pokeapi         GET /api/v2/pokemon/ditto
              │                          getCatFact   endpointCall  catfacts        GET /fact
              ▼
            join         jsFunction — merge results.* into { summary, combinedJson }
              ▼
            postToHttpbin endpointCall POST  httpbin /post   (body = joined payload)
              ▼
            notify       channelSend  telegram → your chat_id   (text = summary)
```

## How each step maps to the engine

Verified against `services/workflow-service/src/temporal/workflows.ts`:

| Step | Activity | Notes |
| --- | --- | --- |
| Receive any HTTP message | `trigger: message_received`, `channels:["http"]` | Same trigger as the `http-bridge` sample |
| Parallel calls | `branch` | The executor runs branch arms with `Promise.all` — genuinely concurrent |
| Join | `jsFunction` | The fn receives the full context; after the branch, each arm's result is in `context.results.<name>`, so one JS step reads `getPost` / `getPokemon` / `getCatFact` and combines them |
| POST to httpbin | `endpointCall` | `adapterId` = httpbin connector, `POST /post`, `data` = joined payload |
| Telegram reply | `channelSend` | `to` → Telegram `chat_id`; published to the egress stream, delivered by the bot |

## Message flow

| # | From | Transport | Subject / URL | To |
|---|------|-----------|---------------|----|
| 1 | HTTP client | HTTPS POST · `x-http-channel-token: <appSecret>` | `/api/webhooks/http/acme/http-fanout-telegram` | api-gateway |
| 2 | api-gateway | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingress) | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · workflow `runWorkflow` | workflow-service worker |
| 5 | workflow-service worker · `branch` (parallel) | Temporal task dispatch | task queue `connector-runtime` | connector-runtime (×3 concurrent) |
| 5a | connector-runtime | HTTPS GET | `https://jsonplaceholder.typicode.com/posts/1` | JSONPlaceholder |
| 5b | connector-runtime | HTTPS GET | `https://pokeapi.co/api/v2/pokemon/ditto` | PokéAPI |
| 5c | connector-runtime | HTTPS GET | `https://catfact.ninja/fact` | Cat Facts |
| 6 | workflow-service worker · `jsFunction` activity | local (in-process) | task queue `workflow-orchestrator` | workflow-service worker |
| 7 | workflow-service worker · `endpointCall` (postToHttpbin) | Temporal task dispatch | task queue `connector-runtime` | connector-runtime |
| 7a | connector-runtime | HTTPS POST | `https://httpbin.org/post` | httpbin |
| 8 | workflow-service worker · `channelSend` activity | NATS core publish · captured by `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 9 | channel-service-worker (egress) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

> Steps 5a–5c run concurrently via `Promise.all` inside a `branch` action. `endpointCall` activities (hops 5 and 7) are dispatched to `connector-runtime` — a separate service with its own Temporal task queue. `jsFunction` and `channelSend` run in-process on the `workflow-orchestrator` worker.

## Prerequisites

This script only wires the **workflow**. Provision its dependencies first:

1. **Connectors** `jsonplaceholder`, `pokeapi`, `catfacts`, `httpbin`:
   ```bash
   (cd ../http-connectors && ./setup.sh)
   ```
2. **A Telegram channel account** with a real bot token:
   ```bash
   (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-…" ./setup.sh)
   ```
3. The **dedicated HTTP channel instance** is created automatically by this sample's `setup.sh`
   (account `externalId = http-fanout-telegram`); you don't need to create one by hand.
4. **Your numeric Telegram `chat_id`**, and you must have `/start`-ed the bot. A bot cannot
   cold-message a phone number — Telegram addresses recipients by `chat_id`. Get yours with:
   ```bash
   curl -s "https://api.telegram.org/bot<token>/getUpdates" | jq '.result[].message.chat.id'
   ```

## Run

```bash
cd sdk/samples/http-fanout-telegram
TELEGRAM_CHAT_ID=123456789 ./setup.sh
# [STEP]  2/3 resolve connectors + telegram account
# [INFO]  connectors  jsonplaceholder=…  pokeapi=…  catfacts=…  httpbin=…
# [INFO]  telegram account=…
# [STEP]  3/3 ensure workflow 'http-fanout-telegram'
# [INFO]  created workflow id=…
```

The script logs in, **resolves the connector `adapterId`s and the Telegram `accountId` by name**,
**creates a dedicated HTTP channel instance** (`externalId = http-fanout-telegram`), and builds the
workflow with its trigger **pinned to that instance** (`config.accountIds = [<that account>]`). So
this workflow fires **only** for messages sent to its own instance — never on unrelated HTTP traffic.
Idempotent — re-running reuses everything by name; `RECREATE=1` rebuilds the workflow.

### Drive it end to end

This workflow has its **own ingest URL** — the last path segment is its instance `externalId`
(`/api/webhooks/http/<tenant>/http-fanout-telegram`). POST straight to it (the `setup.sh` prints the
exact URL and token at the end):

```bash
curl -X POST 'http://localhost:8080/api/webhooks/http/acme/http-fanout-telegram' \
  -H 'content-type: application/json' \
  -H 'x-http-channel-token: <app-secret-printed-by-setup>' \
  -d '{"text":"hola"}'
```

The message hits **this instance** → the workflow fires (and no other) → three calls run in parallel
→ the join builds the summary → it's POSTed to httpbin → and the bot DMs you:

```
Mensaje recibido: hola
Post: sunt aut facere repellat provident…
Pokemon: ditto
Dato gatuno: Cats sleep 70% of their lives.
(httpbin status: 200)
```

## Environment

`setup.sh` sources `../lib/resolve-env.sh` automatically, which loads a `.env` file from this
directory (if present) and detects the gateway endpoint. Place secrets and overrides in `.env`
next to `setup.sh` — no manual sourcing needed.

| Var | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_CHAT_ID` | — | **Required.** Your numeric Telegram chat id |
| `TG_ACCOUNT_ID` | first active telegram account | Pin a specific Telegram channel account |
| `YOIZEN_BASE_URL` | dev gateway | Gateway base URL |
| `YOIZEN_HOST_HEADER` | dev gateway host | `Host` header for the dev ingress |
| `YOIZEN_TENANT` / `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` | `acme` / `yclawd@demo.io` / `admin123` | Tenant + login |
| `FANOUT_WORKFLOW_NAME` | `http-fanout-telegram` | Workflow name |
| `FANOUT_JSONPLACEHOLDER` / `FANOUT_POKEAPI` / `FANOUT_CATFACTS` / `FANOUT_HTTPBIN` | connector names | Override the connector names to resolve |
| `RECREATE` | `0` | `1` deletes + recreates the workflow |

## Design notes & gotchas

- **`{{…}}` templating is string-coercing.** The resolver does `String(value)` on each leaf, so
  nested objects can't be piped raw into the httpbin body or the Telegram text. The `join` step
  therefore hands off **strings** — a human `summary` and a `combinedJson` JSON string — which the
  later steps reference via `{{results.join.summary}}` / `{{results.join.combinedJson}}`.
- **Connectors are referenced by `adapterId`** (per-tenant), resolved at create time. If a connector
  is missing the script stops with a clear message pointing at `../http-connectors/setup.sh`.
- **The HTTP channel is ingest-only**, so Telegram is the reply path by design — there's no "reply
  over HTTP".
- **Parallel result names matter.** The join reads `results.getPost`, `results.getPokemon`,
  `results.getCatFact` — the names of the actions inside the branch arms. Rename an arm action and
  you must update the join.
- **`FANOUT_PIN=1` (the default)** pins the trigger to the dedicated HTTP instance via
  `accountIds: [<http-fanout-telegram account id>]`, so only messages sent to its own ingest URL
  fire this workflow. Set `FANOUT_PIN=0` to remove the pin and let any HTTP message on the tenant
  trigger it (the stale-pin trap described in the Telegram sample's troubleshooting still applies
  if the account is recreated while the workflow retains the old id).
- **`endpointCall` activities run on `connector-runtime`**, a separate service registered on
  Temporal task queue `connector-runtime`. They are NOT executed in-process on the
  `workflow-orchestrator` worker — that task queue only handles `jsFunction` and `channelSend`.
