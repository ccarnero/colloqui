# http-fanout-telegram

A workflow that, on **a message arriving over its own dedicated HTTP channel instance**, fans out
**three connector calls in parallel**, **joins** their responses, **POSTs** the result to the
httpbin connector, and **DMs you a summary over Telegram**. It stitches together two other samples
— [`http-connectors`](../../http/http-connectors) (the outbound connectors, a declarative
`LibraryManifest`) and [`telegram-transform-reply`](../telegram-transform-reply) (the Telegram
channel account) — into one end-to-end flow. Provisioning is **declarative**: a single
[`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no setup scripts).

```
HTTP msg ─► trigger (message_received, channels:["http"], accountIds pinned to this sample's own channel)
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

## What `manifest.yaml` provisions

1. **A dedicated HTTP channel account** (`http-fanout-telegram`) — this workflow's own ingest
   instance (`externalId` derived as `manifest:http-fanout-telegram`).
2. **A workflow** (`http-fanout-telegram`) — `branch` (3 parallel `endpointCall`) → `join`
   (`jsFunction`) → `postToHttpbin` (`endpointCall`) → `notify` (`channelSend`). Every `adapterId`
   the deleted `setup.ts` resolved to a real id at provisioning time is now a `connectorRef` (T03);
   `accountId` is a `channelRef` — both substituted to real ids by the apply engine at apply time,
   never sent to workflow-service verbatim.
3. **A system variable** (`http-fanout-telegram-chat-id`) — the Telegram chat id the notify step
   DMs. See § Configure below.

> **Cross-sample dependencies, both `external: true`** (resolved by NAME against LIVE platform
> state, never created by this manifest — see the comments in `manifest.yaml`):
> - The 4 connectors (`jsonplaceholder`/`pokeapi`/`catfacts`/`httpbin`) — provisioned by
>   [`http-connectors`](../../http/http-connectors)'s own `manifest.yaml` (`kind: LibraryManifest`).
>   Apply it first:
>   `env 'httpbin-basic-auth-username=user' 'httpbin-basic-auth-password=passwd' yoizen manifests
>   apply -f ../../http/http-connectors/manifest.yaml --secrets-from-env` (see its README.md).
> - The Telegram channel — owned by
>   [`telegram-transform-reply`](../telegram-transform-reply)'s `manifest.yaml`. Apply it first.

## Trigger is pinned to this sample's own channel

The trigger is pinned to this manifest's own `http-fanout-telegram` HTTP channel account via
`trigger.config.accountIds: [{channelRef: http-fanout-telegram}]` — the plural `accountIds` array
substitution (`ARRAY_SUBSTITUTION_ALLOWLIST`, `array-substitution-allowlist.ts`). No other
HTTP-triggered workflow fires on this instance's traffic.

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- The connectors and Telegram account above already provisioned (see § What `manifest.yaml`
  provisions).
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD` — same as every other sample.
- No secret bindings — this manifest declares no `secrets:` section.

## Provision (declarative)

```bash
cd sdk && bun link   # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/channels/http-fanout-telegram/manifest.yaml
yoizen manifests plan     -f ../integrations/channels/http-fanout-telegram/manifest.yaml
yoizen manifests apply    -f ../integrations/channels/http-fanout-telegram/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged (no live external-ref changes).

## Configure (Telegram recipient)

The Telegram chat id is a `systemVariables` entry (`http-fanout-telegram-chat-id`), not an env var
— edit `spec.systemVariables[0].value` in `manifest.yaml` to your real numeric chat id, then
re-apply:

```bash
yoizen manifests apply -f ../integrations/channels/http-fanout-telegram/manifest.yaml --secrets-from-env
```

The workflow reads it at RUNTIME via `{{variables.system.http-fanout-telegram-chat-id}}` —
changing the recipient is a variable-value re-apply, never a workflow edit.

## Run / exercise

```bash
cd integrations/channels/http-fanout-telegram
./run.sh
```

`run.sh` (`src/index.ts`) verifies (read-only, via the SDK) that the four `http-connectors`
connectors exist, an active Telegram account exists, and the workflow exists, then POSTs a test
message through the sample's own ingest URL
(`/api/webhooks/http/<tenant>/manifest:http-fanout-telegram`). It never provisions anything itself
— apply both prerequisite manifests first (see § What `manifest.yaml` provisions above). Expect:

```
Mensaje recibido: hola desde run.sh [...]
Post: sunt aut facere repellat provident…
Pokemon: ditto
Dato gatuno: Cats sleep 70% of their lives.
(httpbin status: 200)
```

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `FANOUT_WORKFLOW_NAME` | `http-fanout-telegram` | Must match `manifest.yaml`'s workflow name |
| `FANOUT_HTTP_EXTERNAL_ID` | `manifest:http-fanout-telegram` | The apply engine's derived externalId (`manifest:<channel name>`) |
| `RUN_TEXT` | `hola desde run.sh` | Test message text |

## Design notes & gotchas

- **`{{…}}` templating is string-coercing.** The resolver does `String(value)` on each leaf, so
  nested objects can't be piped raw into the httpbin body or the Telegram text. The `join` step
  therefore hands off **strings** — a human `summary` and a `combinedJson` JSON string.
- **Parallel result names matter.** The join reads `results.getPost`, `results.getPokemon`,
  `results.getCatFact` — the names of the actions inside the branch arms.
- **`endpointCall` activities run on `connector-runtime`**, a separate service registered on
  Temporal task queue `connector-runtime` — not in-process on `workflow-orchestrator`.
- **The HTTP channel is ingest-only**, so Telegram is the reply path by design.
