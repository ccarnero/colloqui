# ai-agent-triage

**AI triage inside a workflow**: a customer message arriving over a **dedicated HTTP channel
instance** is classified by a **published AI agent** (`agentCall`) into intent / sentiment /
priority / one-line summary, the agent's JSON reply is parsed by a `jsFunction` (which also builds
both notification texts and the `escalate` flag), and an exclusive `conditional` gateway DMs a
Telegram summary — 🚨 escalation or ✅ routine. Provisioning
is **declarative**: a single [`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI
(no setup scripts).

```
HTTP msg ─► trigger (message_received, channels:["http"])
              │
              ▼
            triage       agentCall    ─► agent 'ai-sample-triage' replies compact JSON classification
              ▼
            route        jsFunction   ─► parses results.triage.data.reply -> { escalate, priority,
                                         sentiment, alertText, normalText } (fail-safe fallback)
              ▼
            notify       conditional  ─► escalate==true -> 🚨 alert / default -> ✅ resolved (channelSend)
```

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| Channel | `ai-agent-triage` | Dedicated HTTP ingest instance (`type: http`, `direction: inbound`) |
| Connector | `sample-openai-llm` | Shared with `ai-agent-playground`/other AI samples — reconciles as the SAME connector |
| Agent | `ai-sample-triage` | `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |
| System variable | `ai-agent-triage-chat-id` | Telegram recipient — see § Configure |
| Workflow | `ai-agent-triage` | `triage` (agentCall) -> `route` (jsFunction) -> `notify` (conditional) |

> **Cross-sample dependency, `external: true`** (resolved by NAME against LIVE platform state,
> never created by this manifest): the Telegram channel — owned by
> [`telegram-transform-reply`](../../channels/telegram-transform-reply)'s `manifest.yaml`. Apply it
> first.

## Documented simplification (single Telegram recipient)

The deleted `setup.ts` supported a SECOND, dynamically-discovered recipient
(`TELEGRAM_CHAT_ID_2`), fanning out via a parallel `branch`. A `systemVariables` entry carries
exactly one value, and the manifest is static, so this migration keeps **one recipient only** —
the same simplification `http-fanout-telegram`/`hosted-services-api` already established for their
own single-recipient notify steps. Not a capability gap: a second recipient could be added as a
second systemVariable + a second unconditional `channelSend` action if ever needed.

## Trigger is pinned to this sample's own channel

The trigger is pinned to this manifest's own `ai-agent-triage` HTTP channel account via
`trigger.config.accountIds: [{channelRef: ai-agent-triage}]` — the plural `accountIds` array
substitution (`ARRAY_SUBSTITUTION_ALLOWLIST`). No other HTTP-triggered workflow fires on this
instance's traffic.

## Secrets (LLM connector bearer auth)

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `ai-agent-triage-openai-api-key` | `authConfig.bearerToken` | Your real `OPENAI_API_KEY` |

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- `telegram-transform-reply/manifest.yaml` already applied (real bot token) and the bot `/start`-ed
  by whoever should receive the triage summary.
- A real OpenAI API key.
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD`.

## Provision (declarative)

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-agent-triage/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-agent-triage/manifest.yaml
env "ai-agent-triage-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-agent-triage/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Configure (Telegram recipient)

Edit `spec.systemVariables[0].value` in `manifest.yaml` to your real numeric Telegram chat id, then
re-apply:

```bash
yoizen manifests apply -f ../integrations/ai/ai-agent-triage/manifest.yaml --secrets-from-env
```

The workflow reads it at RUNTIME via `{{variables.system.ai-agent-triage-chat-id}}` — changing the
recipient is a variable-value re-apply, never a workflow edit.

## Run / exercise

```bash
cd integrations/ai/ai-agent-triage
./run.sh
```

`run.sh` (`src/index.ts`) verifies (read-only) the workflow and the dedicated HTTP instance, then
POSTs three sample customer messages (angry / curious / happy) through the instance's own ingest
URL. Expect one Telegram DM per message, in exactly one of two shapes built by `route` (the text is
assembled in the `jsFunction`, not in `channelSend`):

```text
🚨 ESCALATION — priority: urgent | sentiment: negative | intent: refund
<the agent's one-line summary>
Original: <the customer's message>
```

```text
✅ Triage — priority: normal | sentiment: neutral | intent: shipping
<the agent's one-line summary>
Original: <the customer's message>
```

The `🚨` arm fires whenever `priority` is `high`/`urgent` OR `sentiment` is `negative`; everything
else takes the `✅` default arm. (`src/index.ts`'s own closing log line still prints a `🎧 Triage —
priority: urgent …` sample that no branch can emit — tracked as ledger escalation **E19**; the two
shapes above are what the workflow actually sends.)

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `TRIAGE_WORKFLOW_NAME` | `ai-agent-triage` | Must match `manifest.yaml`'s workflow name |
| `TRIAGE_HTTP_EXTERNAL_ID` | `manifest:ai-agent-triage` | The apply engine's derived externalId (`manifest:<channel name>`) |
| `TRIAGE_RUN_DELAY_S` | `2` | Seconds between the sample messages |

## Design notes & gotchas

- **`{{...}}` templating is string-coercing** — the agent's JSON reply lives at
  `results.triage.data.reply`; `route`'s `jsFunction` safely parses it (fail-safe fallback:
  unparseable -> priority `high`, escalates).
- **The connector carries `tags: [llm]`** — required by agent-admin-service's credential resolver
  for any adapter an agent's `model_config.llm.connectorId` points at; without it the agent 400s
  with `Adapter '<id>' is not tagged as 'llm'`.
- **The secret binding name is the env var** — `.env` is only read for the three `TRIAGE_*`
  run-side overrides (via `../../lib/resolve-env.sh`); `OPENAI_API_KEY` sitting in `.env` does
  nothing for `apply`, which reads the value from `ai-agent-triage-openai-api-key`.
