# Samples

Runnable examples for `@yoizen/http-sdk`. Each sample is a self-contained app with its own
`package.json` that depends on the SDK via a local `file:` link — so it consumes the SDK by
name (`@yoizen/http-sdk`), exactly like an external project would.

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
