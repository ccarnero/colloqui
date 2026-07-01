# Samples

Runnable examples for `@yoizen/http-sdk`. Each sample is a self-contained app with its own
`package.json` that depends on the SDK via a local `file:` link — so it consumes the SDK by
name (`@yoizen/http-sdk`), exactly like an external project would.


## ai-agent-playground

A minimal admin-console AI counterpart: it creates/reuses an LLM connector, creates and
publishes an AI agent, submits one `/api/runtime/executions` request, and polls the result.
Unlike HTTP-only samples, this requires a real online LLM credential.

```bash
cd sdk/samples/ai-agent-playground
cp .env.example .env   # set OPENAI_API_KEY or another provider key
./run.sh
```

Default mode is connector-based, matching the admin-console “LLM Connector” field. Use
`AI_CREDENTIAL_MODE=env` only when `agent-ai-service` already has the provider key in its own
deployment environment.


## ai-knowledge-base-agent

A knowledge-base/RAG counterpart to `ai-agent-playground`: it creates a KB, uploads a
Markdown FAQ, waits for ingestion, attaches the KB to an AI agent, publishes it, and asks a
question whose answer must come from the uploaded document.

```bash
cd sdk/samples/ai-knowledge-base-agent
cp .env.example .env   # set OPENAI_API_KEY or provider key
./run.sh
```

Knowledge bases are standalone admin resources, but current runtime consumption is through
agents via `knowledge_base_ids`. Runtime KB search also needs OpenAI embeddings available in
`agent-ai-service`.

## http-bridge

A tiny `node:http` server that **receives a message over HTTP and forwards it into the
platform** via the SDK. Think of it as a minimal ingress: anything that can POST JSON can push
a message into the platform's http channel.

### Install & run

```bash
cd sdk/samples/http-bridge
pnpm install            # links @yoizen/http-sdk from ../.. (the SDK is zero-dep)

YOIZEN_TENANT=acme \
YOIZEN_EMAIL=ops@acme.com \
YOIZEN_PASSWORD=••• \
pnpm start
# [bridge] listening on http://localhost:4000
```

Optional env: `PORT` (default `4000`), `YOIZEN_BASE_URL` (defaults to the dev gateway).
`pnpm dev` runs the same server with `--watch`.

### Send a message

```bash
curl -X POST localhost:4000/messages \
  -H 'content-type: application/json' \
  -d '{"from":"customer@example.com","text":"hello from the bridge"}'
# { "ok": true, "result": { "status": "accepted", "tenant": "acme" } }
```

`from` is optional — omit it and the SDK sends as your login email. Any extra top-level fields
are preserved under `raw`. The minimal body is just text:

```bash
curl -X POST localhost:4000/messages -H 'content-type: application/json' -d '{"text":"hello"}'
```

### Call it from another device (e.g. an iPhone Shortcut)

The bridge listens on all network interfaces, so any device on the same Wi-Fi can reach it at
your Mac's Bonjour hostname (`<your-mac>.local`) or its LAN IP — not just `localhost`:

```bash
curl -X POST http://theram.local:4000/messages \
  -H 'content-type: application/json' \
  -d '{"text":"hello from my phone"}'
```

From an **iOS Shortcut**, add a *Get Contents of URL* action:

- **URL:** `http://<your-mac>.local:4000/messages` (use the LAN IP if `.local` is flaky on iOS)
- **Method:** `POST`
- **Headers:** `Content-Type` = `application/json`
- **Request Body:** `JSON` → field `text` = your text

Requirements: the bridge is running, both devices on the same Wi-Fi, and macOS firewall allows
incoming connections to `node`. The bridge has **no auth of its own** — only expose it on a
trusted network, never the public internet.

## telegram-transform-reply

The **automation-side** counterpart to `http-bridge`: a message that arrives on **Telegram**
is transformed by a workflow (echo + a millisecond-precision timestamp) and **replied back over
Telegram** to the same chat. A single idempotent `setup.sh` provisions both artifacts — a
Telegram **channel account** (wires the built-in adapter for receive + send) and the
**workflow** — through the platform API. Unlike `http-bridge` it's shell-based and doesn't use
`@yoizen/http-sdk`; the Telegram path is driven by the platform's built-in `TelegramProvider`.

```bash
cd sdk/samples/telegram-transform-reply
TELEGRAM_BOT_TOKEN="123456:ABC-your-bot-token" ./setup.sh
```

See [`telegram-transform-reply/README.md`](telegram-transform-reply/README.md) for the
end-to-end (`SIMULATE_INBOUND=1`) flow and the full env reference.

### Responses

| Status | Meaning |
| --- | --- |
| `202` | message accepted by the platform |
| `400` | invalid body / validation error |
| `502` | platform rejected the message, or auth / channel resolution failed (`code`, `ingestStatus`) |

`GET /health` → `{ "status": "ok" }`.

### How it works

```
HTTP POST /messages  ──►  bridge  ──►  client.send(...)  ──►  platform http channel
                                         │
                                         └─ login → resolve appSecret → ingest (all hidden by the SDK)
```
