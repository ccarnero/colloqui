# ai-agent-triage

**AI triage inside a workflow**: a customer message arriving on a **dedicated HTTP channel
instance** is classified by a **published AI agent** (`agentCall`) into intent / sentiment /
priority / one-line summary, the agent's JSON reply is parsed by a `jsFunction` (parse-only —
it derives an `escalate` verdict but takes no routing decision), and a **`conditional`
exclusive gateway** routes to either a 🚨 escalation alert or a ✅ triage summary over Telegram
(`channelSend`). It is the first sample demonstrating the **`agentCall` workflow action** and
the canonical *parse-then-gate* pairing of `jsFunction` + `conditional` — the
call-center-flavored sibling of [`http-bridge`](../../../sdk/examples/reference-pattern) (same inbound transport and
notify path, but with an LLM in the middle) built on the agent-provisioning contract of
[`ai-agent-playground`](../ai-agent-playground).

```
HTTP msg ─► trigger (message_received, channels:["http"], pinned to this sample's own instance)
              │
              ▼
            triage    agentCall — agentId: <ai-sample-triage>, message: {{request.text}};
                      the published agent replies ONLY with compact JSON
                      {"intent","sentiment","priority","summary"};
                      result lands at results.triage.data.reply
              ▼
            route     jsFunction — strips code fences, JSON.parses the reply (fail-safe:
                      an unparseable reply escalates), returns
                      { escalate, priority, sentiment, alertText, normalText }
              ▼
            notify    conditional — exclusive gateway on results.route.escalate eq "true":
                        Escalate ─► channelSend telegram  "🚨 ESCALATION — …"  (alertText)
                        default  ─► channelSend telegram  "✅ Triage — …"      (normalText)
                      (each arm becomes a parallel branch with one channelSend per chat
                       when TELEGRAM_CHAT_ID_2 is pinned — channelSend.to only accepts a
                       single string, so multi-recipient needs a branch)
```

## How each step maps to the engine

Verified against `services/workflow-service/src/temporal/workflows.ts` and
`packages/shared/src/workflow.interfaces.ts`:

| Step | Activity | Notes |
| --- | --- | --- |
| Receive a message on this sample's HTTP instance | `trigger: message_received`, `channels:["http"]`, `config.accountIds:[<this instance>]` | Pinned so only messages posted to this instance's ingest URL fire this workflow |
| AI classification | `agentCall` | `AgentCallArgs` (`workflow.interfaces.ts:156`) — `agentId` (the agent's UUID, resolved by name at setup time) + `message` required; `conversationId`/`userId`/`channel` optional. The activity (`temporal/activities/agent-call.activity.ts`) submits an execution over NATS and returns `{ status, data: { reply, tool_calls }, headers }` — so the agent's text is `results.triage.data.reply` |
| Parse + normalize | `jsFunction` | Reads `ctx.results.triage.data.reply`, strips markdown code fences, `JSON.parse` with a fail-safe fallback (unparseable → escalate), returns `{ escalate, priority, sentiment, alertText, normalText }`. Parse-only: a `conditional` cannot parse a JSON *string* — `IConditionRule.variable` is a dot-path walked over context objects (`resolvePathRaw`), which is why this step must exist |
| Escalation routing | `conditional` | `ConditionalAction` (`workflow.interfaces.ts:244`) — branches evaluated top-to-bottom, first match wins, `default` when none match. Condition `results.route.escalate eq "true"` works against a boolean because the engine compares `String(left) === String(right)`. Result exposes `{ matchedBranch }` |
| Telegram notification | `channelSend` | One per gateway arm; `to` → your Telegram `chat_id`; published to the egress stream, delivered by the bot |

## Message flow

| # | From | Transport | Subject / URL | To |
|---|------|-----------|---------------|----|
| 1 | HTTP client | HTTPS POST · `x-http-channel-token: <appSecret>` | `/api/webhooks/http/acme/ai-agent-triage` | api-gateway |
| 2 | api-gateway | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingress) | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · workflow `runWorkflow` | workflow-service worker |
| 5 | workflow-service worker · `agentCall` activity (triage) | NATS JetStream publish (`YoizenClawExecutionClient`) | `evt.acme.ai-agent-gateway.automation.platform.internal.execution_requested.v1` | agent runtime (agent-ai-service) |
| 6 | agent-ai-service | HTTPS | LLM provider (e.g. `https://api.openai.com/v1`) via the `sample-<provider>-llm` connector credentials | LLM |
| 7 | agent runtime | NATS execution result events / Redis result cache | awaited by the `agentCall` activity (`executeAndWait`) | workflow-service worker |
| 8 | workflow-service worker · `jsFunction` activity (route) | local (in-process) | task queue `workflow-orchestrator` | workflow-service worker |
| 9 | workflow-service worker · `conditional` gateway (notify) → matched arm's `channelSend` | NATS core publish · captured by `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 10 | channel-service-worker (egress) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

> Unlike `endpointCall`, the `agentCall` activity runs **locally on the
> `workflow-orchestrator` worker** (there is no `connector-runtime` hop) — it proxies the agent
> execution over NATS and waits for the result, heartbeating Temporal every 15s during long LLM
> calls (see `agent-call.activity.ts`).

## Prerequisites

This script wires the **LLM connector**, the **triage agent**, the **dedicated HTTP instance**
and the **workflow**. You still need:

1. **A Telegram channel account** with a real bot token (the notify path):
   ```bash
   (cd ../../channels/telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-…" ./setup.sh)
   ```
2. **You must have `/start`-ed the bot.** `setup.sh` auto-discovers `TELEGRAM_CHAT_ID` from the
   bot's recent `getUpdates` exactly like `http-bridge` does (including the webhook
   clear/restore dance) — or pin it via `.env`.
3. **An LLM API key** (e.g. `OPENAI_API_KEY`) in `.env` — the triage agent runs against a real
   online LLM. The `http-connectors` sample is **not** needed: the LLM connector is created by
   this sample itself (reusing `sample-<provider>-llm` if `ai-agent-playground` already made it).

## Run

```bash
cd integrations/ai/ai-agent-triage
cp .env.example .env   # set OPENAI_API_KEY (or another provider key)
./setup.sh
# [STEP]  2/5 ensure LLM connector 'sample-openai-llm'
# [INFO]  reusing connector id=…
# [STEP]  3/5 upsert + publish agent 'ai-sample-triage'
# [INFO]  published agent id=…
# [STEP]  4/5 resolve telegram account + http instance
# [INFO]  auto-selected TELEGRAM_CHAT_ID=111222333 (most recent chat)
# [INFO]  created HTTP instance … (externalId=ai-agent-triage)
# [STEP]  5/5 ensure workflow 'ai-agent-triage'
# [INFO]  created workflow id=…
./run.sh               # posts 3 sample customer messages
```

`setup.sh` logs in, **upserts + publishes the `ai-sample-triage` agent** (system prompt forces a
compact JSON-only reply; `temperature 0.1`, `maxTokens 200`), resolves its **UUID by name** and
bakes it into the workflow's `agentCall.args.agentId`, creates the **dedicated HTTP instance**
(`externalId = ai-agent-triage`), and pins the trigger to it. `RECREATE` defaults to `1` for the
instance + workflow (they embed ids resolved at run time); the connector and agent are always
upserted in place.

`run.sh` resolves the instance token and POSTs three different customer messages — an angry
refund demand, a neutral shipping question, and a happy thank-you — then tells you to check
Telegram. Each lands as:

```
🎧 Triage — priority: urgent | sentiment: negative | intent: refund
Customer demands an immediate refund after receiving a third broken order.
Original: I want my money back RIGHT NOW. This is the THIRD time my order arrived broken…
```

You can also POST manually (setup prints the exact URL and token at the end):

```bash
curl -X POST 'http://localhost:8080/api/webhooks/http/acme/ai-agent-triage' \
  -H 'content-type: application/json' \
  -H 'x-http-channel-token: <app-secret-printed-by-setup>' \
  -d '{"from":"customer-42","text":"Where is my package? It was supposed to arrive yesterday."}'
```

## Environment

`setup.sh` sources `../lib/resolve-env.sh` automatically, which loads a `.env` file from this
directory (if present) and detects the gateway endpoint.

| Var | Default | Notes |
| --- | --- | --- |
| `AI_AGENT_PROVIDER` / `AI_AGENT_MODEL` | `openai` / `gpt-4o-mini` | LLM provider + model for the triage agent (same knobs as `ai-agent-playground`) |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` creates/reuses an `llm`-tagged connector with your API key; `env` assumes agent-ai-service already has the provider env var |
| `OPENAI_API_KEY` (etc.) | — | Provider API key, required for `AI_CREDENTIAL_MODE=connector`. One var per provider (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, …) |
| `AI_LLM_CONNECTOR_NAME` | `sample-<provider>-llm` | Connector name — matches `ai-agent-playground`'s default so both samples share one connector |
| `AI_AGENT_NAME` | `ai-sample-triage` | Triage agent name (its UUID is resolved by this name and baked into `agentCall.args.agentId`) |
| `TELEGRAM_CHAT_ID` | auto-discovered | Your numeric Telegram chat id. Set to pin; otherwise picked from the bot's most recent `getUpdates` chat |
| `TELEGRAM_CHAT_ID_2` | auto-discovered, optional | Optional second recipient. When present (pinned or discovered), `notify` becomes a parallel `branch` with one `channelSend` arm per chat |
| `TG_ACCOUNT_ID` | first active telegram account | Pin a specific Telegram channel account |
| `YOIZEN_BASE_URL` / `YOIZEN_HOST_HEADER` | dev gateway | Gateway base URL + `Host` header for the dev ingress |
| `YOIZEN_TENANT` / `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` | `acme` / `yclawd@demo.io` / `admin123` | Tenant + login |
| `TRIAGE_WORKFLOW_NAME` | `ai-agent-triage` | Workflow name |
| `TRIAGE_HTTP_EXTERNAL_ID` | `ai-agent-triage` | Dedicated HTTP instance externalId |
| `TRIAGE_HTTP_ACCOUNT_NAME` | `AI Agent Triage` | Dedicated HTTP instance display name |
| `TRIAGE_PIN` | `1` | `1` pins the trigger to the dedicated HTTP instance via `accountIds`; `0` lets any HTTP message on the tenant fire it |
| `TRIAGE_RESTORE_WEBHOOK` | `1` | Chat-id discovery must clear any active webhook to poll `getUpdates`; `1` restores it afterward |
| `TRIAGE_DISCOVER_WAIT_SECONDS` / `TRIAGE_DISCOVER_POLL_INTERVAL` | `60` / `2` | Discovery wait/prompt cap and retry gap (same semantics as `http-bridge`) |
| `TRIAGE_RUN_DELAY_S` | `2` | Seconds `run.sh` sleeps between the sample messages |
| `RECREATE` | `1` | Rebuilds the HTTP instance + workflow on every run (they embed the freshly resolved agent id / chat ids); connector + agent are upserted in place regardless. Set `0` to reuse by name |

## Design notes & gotchas

- **`AgentCallArgs` requires `agentId` + `message`** (`packages/shared/src/workflow.interfaces.ts:156`),
  where `agentId` is the agent's **UUID**, not its name — `setup.sh` resolves it via
  `GET /api/admin/agents` and bakes it into the workflow body, the same resolve-by-name pattern
  the other samples use for accounts and connectors. The validator
  (`workflow-action.validator.ts`) rejects empty strings for either field.
- **The agent's reply is `results.triage.data.reply`.** `executeAgentCall` returns an
  `HttpExecutionResult` of shape `{ status, data: { reply, tool_calls }, headers }`
  (`agent-call.activity.ts`) — not a bare string. The `route` jsFunction reads
  `ctx.results.triage.data.reply`; a `{{results.triage.data.reply}}` template would work too
  (templating `String()`-coerces each leaf).
- **`agentCall.args.variables` is overwritten at run time.** `executeAction`'s `agentCall` case
  (`temporal/workflows.ts`) spreads the resolved args and then sets
  `variables: context.variables` — so anything you'd put in `args.variables` in the definition
  is replaced by the workflow's own variable context. Everything the agent needs must travel in
  `message` (here: `{{request.text}}`).
- **LLMs stray, so `route` is defensive.** The system prompt demands bare compact JSON (low
  temperature, small `maxTokens`), but the parser still strips ```json fences and falls back to
  `{intent:"unknown", sentiment:"neutral", priority:"normal"}` with the raw reply embedded in the
  summary if `JSON.parse` fails — a bad LLM day degrades the notification, never the workflow.
- **The agent must be published.** Draft agents aren't executable by the runtime; `setup.sh`
  always POSTs `/api/admin/agents/:id/publish` after the upsert, like `ai-agent-playground`.
- **`agentCall` is slow-path by design.** It heartbeats Temporal every 15s and waits up to
  `AGENT_CALL_TIMEOUT_MS` (default 15 min) for the LLM round-trip, with a per-tenant/per-agent
  circuit breaker in front (10 failures / 120s window opens it — repeated failed runs against a
  broken key will start failing fast with `CIRCUIT_OPEN`).
- **`channelSend.to` is a single string.** Multi-recipient means a `branch` with one
  `channelSend` arm per chat — `notify` is built as a plain `channelSend` for one chat and
  upgraded to the two-arm branch only when a second chat id exists (unlike `http-bridge`, which
  always builds the branch).
- **Use `activity`, not `type`, for action kinds** — see `DOCS/workflows/patterns.md`. The
  trigger object is the one place a `type` field appears.
- **Telegram discovery caveats are inherited from `http-bridge`** (webhook clear/restore,
  no replay of pre-clear `/start`s, plaintext `accessToken` from the accounts API). See that
  sample's README for the full troubleshooting section — same code, `TRIAGE_*` env names.
- **The ingest response is always `{"status":"accepted"}`.** The workflow runs asynchronously;
  the triage result arrives on Telegram, never in the HTTP response. Budget a few seconds per
  message for the LLM hop before expecting the notification.
- **The `triage` step pins a fixed `conversationId`** (`ai-agent-triage`), so all test customers
  share one agent conversation thread. A real integration should derive it per customer
  (e.g. from `request.from`).
