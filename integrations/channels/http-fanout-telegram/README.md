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
>   `HTTPBIN_BASIC_AUTH_USERNAME=user HTTPBIN_BASIC_AUTH_PASSWORD=passwd yoizen manifests
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

## Troubleshooting

### `run.sh` says sent / accepted but nothing arrives in Telegram

`run.sh` prints `{"status":"accepted"}` from the webhook and the workflow's
`notify` step (`channelSend`) shows `status=ok` — but no message shows up in
the target Telegram chat. This is not a network or workflow bug; it is the
sample's own placeholder value, unedited:

1. **Check the value isn't still the placeholder.** `manifest.yaml`'s
   `spec.systemVariables[0].value` ships as
   `"REPLACE_WITH_YOUR_TELEGRAM_CHAT_ID"` (see § Configure above) —
   `validate`/`plan`/`apply` all succeed with the placeholder in place, so
   nothing in the provisioning pipeline catches it. Read the live value
   through the gateway's admin proxy:

   ```bash
   curl -s "$YOIZEN_BASE_URL/api/admin/system-variables" \
     -H "x-yoizen-tenant: $YOIZEN_TENANT" \
     -H "Authorization: Bearer $YOUR_TOKEN" | jq '.[] | select(.name == "http-fanout-telegram-chat-id")'
   ```

   If `value` is still `REPLACE_WITH_YOUR_TELEGRAM_CHAT_ID`, edit
   `manifest.yaml` with your real numeric chat id and re-apply (§ Configure).
   `yoizen manifests plan` will show a single `systemVariable` update.

2. **Why this is silent.** The `notify` step's `channelSend` activity
   (`services/workflow-service/src/temporal/activities/channel-send.activity.ts`)
   publishes the outbound message envelope to NATS and returns
   `{ published: true, subject }` as soon as the publish is flushed — it
   does **not** wait for `channel-service` to hand the message to the
   Telegram provider, let alone for Telegram's own delivery response. So
   every upstream signal (`run.sh`'s webhook response, the workflow
   execution status, `channelSend`'s own `status=ok`) reports success even
   when the `to` field is an invalid chat id: the rejection happens
   downstream, after this activity has already returned.

### `run.sh` logs "instance URL not accepted … using token-only legacy URL"

`src/index.ts` posts to the per-instance ingest URL first and, if the response `status` is not
`accepted`, retries ONCE against the legacy tenant-only URL (same `x-http-channel-token`, no
`instance` segment). That fallback still lands on the same account —
`WebhookIngressService.resolveAccount` rejects an unknown `instance` outright rather than falling
back internally, and on the token-only path it verifies the signature against every active `http`
account and requires **exactly one** match (two matches are an "Ambiguous webhook" rejection). So
seeing that line means the instance segment was not recognised: check that `manifest.yaml` was
applied and that the account's `externalId` really is `manifest:http-fanout-telegram`.

### `workflow-worker` logs `unregistered external sink 'exporter'`

If you see this in `workflow-worker`'s logs while diagnosing a delivery
issue, it is unrelated. It is Temporal Core SDK telemetry log noise emitted
by the Rust core runtime when its internal metrics/tracing sink wiring
doesn't fully match config (see `temporal-worker-bootstrap.ts`'s
`Runtime.install(...)` for where telemetry is installed) — it does not mean
any workflow, activity, or message failed. Do not use it as a signal for
delivery problems; check the actual chat id value instead (above).
