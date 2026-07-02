# @yoizen/http-sdk

A small, zero-dependency Node.js SDK for **sending messages into the platform** through the
**http channel**. You log in with `tenant + email + password` (like the admin console, but in
code) and call a single primitive — `send`. The SDK hides the whole chain:

1. **Authenticate** — `POST /api/auth/login` with your email + password → access token.
2. **Authorize** — resolve the http channel's `appSecret` from your session
   (`GET /api/channels/accounts?channel=http`).
3. **Send (ingest)** — `POST /api/webhooks/http/{tenant}` with the message body, or
   `POST /api/webhooks/http/{tenant}/{instance}` when an `instance` (account `externalId`) is
   configured or resolved from the directory lookup.

Login and secret resolution happen lazily on the first `send`, then the token (with refresh)
and secret are cached and reused.

> Requires **Node ≥ 18** (uses native `fetch`). ESM only.

## Install

It's a workspace-local, zero-dep module — import it by path:

```js
import { createClient } from "../sdk/src/index.js";
```

## Usage

```js
import { createClient, IngestError } from "@yoizen/http-sdk";

const client = createClient({
  tenant: "acme",            // tenant id (a readable slug in dev, e.g. "t1"/"acme")
  email: "ops@acme.com",     // your login email
  password: "•••",
});

// text-only — `from` defaults to your login email (you send as yourself)
await client.sendText("hello world");

// rich object — mirrors the platform message shape; only `from` is required
await client.send({
  from: "customer@example.com",
  text: "order shipped",
  raw: { ticketId: 42 },     // extra fields are preserved under `raw`
});
```

Or rely entirely on the environment and call `createClient()` with no arguments:

```bash
export YOIZEN_TENANT=acme
export YOIZEN_EMAIL=ops@acme.com
export YOIZEN_PASSWORD=•••
```

## Configuration

| Option | Required | Env var | Default |
| --- | --- | --- | --- |
| `tenant` | ✅ | `YOIZEN_TENANT` | — |
| `email` | ✅ | `YOIZEN_EMAIL` | — |
| `password` | ✅ | `YOIZEN_PASSWORD` | — |
| `baseUrl` | | `YOIZEN_BASE_URL` | `http://api-gateway.platform-services-dev.dev.local` |
| `defaultFrom` | | `YOIZEN_DEFAULT_FROM` | the login `email` |
| `channelSelector` | | — | first active http account; pass `{ externalId }` or `{ name }` to pin a specific one |
| `appSecret` | | `YOIZEN_HTTP_CHANNEL_TOKEN` | auto-resolved (skips the directory lookup) |
| `instance` | | `YOIZEN_HTTP_CHANNEL_INSTANCE` | targets a dedicated HTTP channel instance's ingress URL (`/api/webhooks/http/{tenant}/{instance}`); falls back to `channelSelector.externalId`, then to the resolved account's `externalId` |
| `timeoutMs` | | — | `10000` |
| `tokenExpiryBufferMs` | | — | `60000` |
| `fetch`, `clock` | | — | native `fetch` / system clock (injectable for tests) |
| `onWarn` | | — | callback invoked with a warning message if the token's tenant scope differs from the configured tenant |

Args take precedence over environment variables.

## API

- `createClient(config)` → `{ send, sendText }`
- `send(message)` → `Promise<SendResult>`. `message` mirrors the platform `InboundMessage`
  (`from`, `text?`, `type?`, `messageId?`, `timestamp?`, `media?`, `raw?`). `from` falls back to
  `defaultFrom`. `media` and any unrecognized keys are folded into `raw`.
- `sendText(text, { from?, type?, raw? })` → `Promise<SendResult>`.
- `SendResult` = `{ status: "accepted", tenant, accountId?, messageId? }` — resolves only when the
  platform accepts the message.

### Errors

All extend `SdkError` (`.code`, `.details?`):

| Class | When |
| --- | --- |
| `ConfigError` | missing `tenant`/`email`/`password`, bad `baseUrl`, or no `fetch` |
| `ValidationError` | empty/invalid `from`, empty text |
| `AuthError` | login/refresh rejected (`.details.httpStatus`) |
| `ChannelResolutionError` | no active http account / no `appSecret` |
| `IngestError` | request failed or status ≠ `accepted` (`.ingestStatus`) |

A `signature_mismatch` is retried once with a freshly resolved secret before throwing
(handles secret rotation).

## Test

```bash
cd sdk
node --test
```

No install step — tests use the built-in `node:test` runner with fully stubbed ports/`fetch`.
