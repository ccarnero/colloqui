# `@yoizen/platform-sdk` — Documentation

> ## ⚠️ SUPERSEDED SNAPSHOT (2026-06-20) — DO NOT IMPLEMENT AGAINST THIS FILE
>
> Everything below describes the SDK as it was on 2026-06-20 and is preserved as
> a record of that state. It is no longer a description of the code. Verified
> 2026-08-03 (docs-truth-audit T08):
>
> - **The SDK is TypeScript, not JavaScript.** `fd -e js . sdk/src` returns **0**
>   files; `fd -e ts . sdk/src` returns **120**. Every path in §2's tree
>   (`sdk/src/index.js`, `domain/*.js`, `application/*.js`,
>   `infrastructure/*.js`) is gone.
> - **The layer map is incomplete.** `sdk/src` now has seven top-level
>   directories — `application/`, `cli/`, `core/`, `domain/`,
>   `infrastructure/`, `lib/`, `resources/` — and `resources/` holds the
>   21 resource namespaces the SDK actually exposes. §1's "one primitive —
>   `send`" and §8's "one capability (outbound ingress only) … no reading of
>   results/events, no SSE stream, no workflow/registry/cache/audit surface"
>   are all false: `runtime.stream()`, workflows, registry, agents, channels
>   and the rest ship today.
> - **The test story moved.** §7's "9 files across `test/{domain,application,
>   infrastructure}`" and `cd sdk && node --test` are superseded by seven
>   `sdk/test/` subdirectories including a 9-file live-cluster `e2e/` suite.
> - **There is a CLI.** `sdk/package.json` declares `bin.yoizen`
>   (`./bin/yoizen.ts`) — the `yoizen manifests validate|plan|apply` command the
>   samples are provisioned with. §8's "not published / not in the workspace"
>   half still holds (`private: true`, `version 0.1.0`).
> - **§8's "repo conventions (CLAUDE.md)" reference is dead.** `CLAUDE.md` is now
>   a five-line pointer to `AGENTS.md`, which is the normative document.
>
> **Read `sdk/README.md` instead** (verified in T05 of this same audit). This
> file is proposed for DELETION in the T09 decision round; it survives until then
> only so the decision is Christian's.

> Plain-Node ESM SDK for **sending (ingesting) messages into the platform** via the http channel.
> Location: repo-root `sdk/` (a standalone module — **not** a pnpm workspace member; imported by path / `file:` link).
> Version `0.1.0`, `private`, zero runtime dependencies, ESM only, **Node ≥ 18** (native `fetch`).
>
> Source verified against `sdk/src/**` on 2026-06-20. (The former TypeScript `@yoizen/sdk` package was removed.)

---

## 1. What it is

A small, single-purpose client: you log in with `tenant + email + password` (like the admin console, but in code) and call **one primitive — `send`** (or `sendText`). The SDK hides the whole chain to get a message onto the platform's http channel:

1. **Authenticate** — `POST /api/auth/login` → access token (+ refresh).
2. **Authorize** — resolve the http channel's `appSecret` from your session (`GET /api/channels/accounts?channel=http`).
3. **Ingest** — `POST /api/webhooks/http/{tenant}` with the message body.

Login and secret resolution happen **lazily on the first `send`**; the token (with refresh) and secret are then cached and reused.

### Mental model (analogy)

Like a **mailroom drop-box with a keycard**: the first time you walk in you show your ID (login) and the front desk hands you a building keycard (`appSecret`). After that you just badge in and drop letters in the slot (`send`) — you don't re-authenticate each time, and if your keycard gets rotated, the SDK quietly gets a new one and retries once.

---

## 2. Architecture — hexagonal (ports & adapters)

The SDK is split into three layers; the application core depends only on **injected ports**, never on `fetch`/`env`/`Date` directly. This is what makes it deterministic and fully unit-testable.

```
sdk/src/
├── index.js                         # public exports: createClient + error classes
├── domain/                          # pure, no I/O
│   ├── message.js                   # normalizeMessage(input) → flat ingest body
│   ├── sender.js                    # validateSender(from) → trimmed non-empty string
│   ├── token.js                     # Token value-object + makeToken/isExpired/canRefresh/tenantFromScope
│   └── errors.js                    # SdkError taxonomy
├── application/                     # use-case orchestration
│   ├── ports.js                     # AuthPort / ChannelDirectoryPort / IngestPort / Clock (JSDoc typedefs)
│   └── ingest-client.js             # createIngestClient(...) → { send, sendText }
└── infrastructure/                  # adapters (the only layer that touches the network/clock/env)
    ├── create-client.js             # composition root: resolveConfig → wire adapters → ingest client
    ├── config.js                    # resolveConfig(args, env) → frozen config
    ├── http.js                      # httpJson() — minimal fetch wrapper, never throws on non-2xx
    ├── auth-adapter.js              # AuthPort  → /api/auth/login, /api/auth/refresh
    ├── channel-directory-adapter.js # ChannelDirectoryPort → /api/channels/accounts?channel=http
    ├── ingest-adapter.js            # IngestPort → /api/webhooks/http/{tenant}
    └── system-clock.js              # Clock → Date.now()
```

**Ports** (`application/ports.js`) are documented as JSDoc `@typedef`s — plain JS has no interfaces, so the contract lives in types-as-comments and adapters implement the shape. Types without a build step.

**Composition root** (`infrastructure/create-client.js`): resolves config, picks `fetch` (global or injected) and `clock` (system or injected), constructs the three adapters, and returns `createIngestClient({ ports, config, clock })`.

---

## 3. The request chain (exact endpoints & headers)

| Step | Adapter | Request | Notes |
|---|---|---|---|
| Login | `auth-adapter` | `POST {baseUrl}/api/auth/login` body `{ email, password, tenant_id? }` | expects `{ access_token, expires_in, refresh_token, scope }`; else `AuthError` with `details.httpStatus` |
| Refresh | `auth-adapter` | `POST {baseUrl}/api/auth/refresh` body `{ refresh_token }` | used instead of full re-login while the refresh token is valid |
| Resolve secret | `channel-directory-adapter` | `GET {baseUrl}/api/channels/accounts?channel=http` headers `Authorization: Bearer <token>`, `x-yoizen-tenant: <tenant>` | picks the **first active** `channel==="http"` account (or filter by `selector.externalId`/`selector.name`); requires non-empty `account.appSecret` |
| Ingest | `ingest-adapter` | `POST {baseUrl}/api/webhooks/http/{tenant}` header `x-http-channel-token: <appSecret>` body = normalized message | success **only** when response body `status === "accepted"`; any other status → `IngestError` with `.ingestStatus` |

`http.js` (`httpJson`) returns `{ status, ok, body }` and **does not throw on non-2xx** — each adapter decides how a status maps to a domain error. It throws `SdkError` (`code: "NETWORK"`) only on transport/timeout failure, and enforces the per-request timeout via `AbortSignal.timeout(timeoutMs)`.

---

## 4. Public API

```js
import { createClient, IngestError } from "@yoizen/platform-sdk";

const client = createClient({ tenant: "acme", email: "ops@acme.com", password: "•••" });

// text-only — `from` defaults to your login email
await client.sendText("hello world");

// rich object — mirrors the platform InboundMessage; only `from` is required
await client.send({
  from: "customer@example.com",
  text: "order shipped",
  raw: { ticketId: 42 },   // extra/unknown top-level keys are folded under `raw`
});
```

- `createClient(config?)` → `{ send, sendText }` (composition root). With no args it reads everything from env.
- `send(message?)` → `Promise<SendResult>`. `message` mirrors the platform `InboundMessage` (`from`, `text?`, `type?`, `messageId?`, `timestamp?`, `media?`, `raw?`). `from` falls back to `defaultFrom`. `media` and any unrecognized top-level keys are folded into `raw`; an explicit `raw` wins on key collision.
- `sendText(text, { from?, type?, raw? })` → `Promise<SendResult>`. Rejects with `ValidationError` if `text` is empty.
- `SendResult` = `{ status: "accepted", tenant, accountId?, messageId? }` — resolves only when the platform accepts the message.

### Configuration (`config.js` — args take precedence over env; result is frozen)

| Option | Required | Env var | Default |
|---|---|---|---|
| `tenant` | ✅ | `YOIZEN_TENANT` | — |
| `email` | ✅ | `YOIZEN_EMAIL` | — |
| `password` | ✅ | `YOIZEN_PASSWORD` | — |
| `baseUrl` | | `YOIZEN_BASE_URL` | `http://api-gateway.platform-services-dev.dev.local` (trailing slashes stripped) |
| `defaultFrom` | | `YOIZEN_DEFAULT_FROM` | the login `email` |
| `appSecret` | | `YOIZEN_HTTP_CHANNEL_TOKEN` | auto-resolved (skips the directory lookup) |
| `channelSelector` | | — | first active http account |
| `timeoutMs` | | — | `10000` |
| `tokenExpiryBufferMs` | | — | `60000` (refresh this early) |
| `onWarn` | | — | — (called e.g. on token-scope/tenant mismatch) |
| `fetch`, `clock` | | — | global `fetch` / system clock (injectable for tests) |

Missing `tenant`/`email`/`password` → `ConfigError` with `details.missing`. Missing `fetch` (Node < 18, no injection) → `ConfigError`.

---

## 5. Domain model

**Message normalization** (`domain/message.js` → `normalizeMessage`): input must be a plain object; `from` is validated/trimmed and required; `type` defaults to `"text"`; `text` must be a string when present; `messageId`/`timestamp` are stringified; `media` plus any keys outside `{from,text,type,messageId,timestamp,raw}` are folded into `raw` (explicit `raw` overrides folded extras).

**Token** (`domain/token.js`) — pure value object + helpers, no clock dependency (caller passes `now`):
- `makeToken({ accessToken, expiresIn, refreshToken?, scope?, obtainedAt })` → computes `expiresAt`; refresh token TTL assumed **24h** (`REFRESH_TOKEN_TTL_MS`).
- `isExpired(token, now, bufferMs=0)` · `canRefresh(token, now)` · `tenantFromScope(scope)` (parses `tenant:<id>` → `<id>`).

**Errors** (`domain/errors.js`) — every error extends `SdkError` (`.code`, optional `.cause`, `.details`):

| Class | `code` | When |
|---|---|---|
| `ConfigError` | `CONFIG` | missing `tenant`/`email`/`password`, bad `baseUrl`, or no `fetch` |
| `ValidationError` | `VALIDATION` | empty/invalid `from`, empty text, wrong types |
| `AuthError` | `AUTH` | login/refresh rejected (`details.httpStatus`) |
| `ChannelResolutionError` | `CHANNEL_RESOLUTION` | no active http account / no `appSecret` |
| `IngestError` | `INGEST` | request failed or status ≠ `accepted` (`.ingestStatus`) |
| `SdkError` | `NETWORK` | transport/timeout failure in `httpJson` |

---

## 6. Runtime behaviors worth knowing

- **Lazy + coalesced auth** (`ingest-client.js`): `ensureToken`/`ensureSecret` cache an in-flight promise so concurrent `send`s trigger a single login / single secret lookup.
- **Refresh-before-relogin**: on expiry it tries `auth.refresh` first; only falls back to a full `login` if refresh throws `AuthError`.
- **Token-scope guard**: if the token's scope tenant differs from the configured tenant, it calls `onWarn` (non-fatal).
- **Secret rotation self-heal**: if ingest returns `signature_mismatch` **and** the secret was auto-resolved (not explicitly configured), it invalidates the cached secret, re-resolves, and **retries once**. An explicitly-configured `appSecret` is never dropped.

---

## 7. Tests & sample

- **Tests**: `node:test` runner with fully stubbed ports/`fetch` — no install step. 9 files across `test/{domain,application,infrastructure}`. Run: `cd sdk && node --test`.
- **Sample** (`sdk/examples/reference-pattern`, formerly under the old `sdk/samples` tier as `http-bridge`): a tiny `node:http` server that receives `POST /messages` and forwards it via `client.send(...)` — a minimal ingress so anything that can POST JSON (e.g. an iOS Shortcut) can push into the platform. Consumes the SDK by name through a local `file:` link (like an external project would). Responses: `202` accepted, `400` validation, `502` platform/auth/channel failure; `GET /health` → `{status:"ok"}`. The bridge has **no auth of its own** — trusted-network use only.

---

## 8. Maturity & gaps (why it's still "incipient")

**Genuinely v0.1.0:** one channel (`http`), one capability (**outbound ingress only** — push a message in). No reading of results/events, no SSE stream, no workflow/registry/cache/audit surface. `private: true`, not a workspace member, imported by path.

**Strongly aligned with the repo conventions (CLAUDE.md):**
- ✅ Functional-first: factories (`createClient`, `createIngestClient`), pure domain functions, dependency injection — **no classes** except the error hierarchy.
- ✅ One concern per file; KISS; zero dependencies.
- ✅ Verbose, typed-by-JSDoc contracts; deterministic/testable by design.

**Divergences / decisions to make if this becomes the canonical client:**
1. **Throws instead of Result types.** It uses a `throw`-based `SdkError` taxonomy, not the `ok/err` Result pattern the repo prefers. Idiomatic for a public SDK, but inconsistent with the internal convention — pick one deliberately.
2. **JS + JSDoc, not TS.** Types exist as `@typedef`s without a compile step. Fine for zero-dep simplicity; means no `.d.ts` for external TS consumers unless generated.
3. **Not published / not in the workspace.** To be consumed as a real dependency it needs either workspace membership or an npm publish (currently `private`).
4. **Surface gaps to close** for parity with the deleted TS client: reading execution results, event stream (SSE), and any workflow/registry operations tenants may need.

---

*Sources: `sdk/README.md`, `sdk/package.json`, `sdk/src/index.js`, `sdk/src/domain/{message,sender,token,errors}.js`, `sdk/src/application/{ports,ingest-client}.js`, `sdk/src/infrastructure/{create-client,config,http,auth-adapter,channel-directory-adapter,ingest-adapter,system-clock}.js`, `sdk/examples/reference-pattern/{server.js,README.md}` (formerly under the old `sdk/samples` tier), the old `sdk/samples` tier's top-level `README.md` (superseded by `integrations/README.md` + `sdk/examples/README.md`).*
