# ai-call-center-supervisor

The **capstone** sample — an AI supervisor loop that mixes every workflow ingredient the other
samples introduce one at a time: a **hosted service** ([`hosted-services-api`](../hosted-services-api)),
an **AI agent** ([`ai-agent-playground`](../ai-agent-playground)), **conditional routing**, and
**Telegram escalation** ([`http-bridge`](../http-bridge)).

A customer message arrives on a dedicated HTTP channel instance; the workflow looks the customer up
in a mock CRM (a hosted echo service), asks an AI triage agent whether the case must escalate, and
routes the outcome: angry/high-risk messages DM the supervisor a 🚨 escalation alert, routine ones a
✅ auto-resolve summary.

```
HTTP msg ─► trigger (message_received, channels:["http"], pinned to this sample's own instance)
              │
              ▼
            lookupCustomer    serviceCall  → hosted service 'sample-crm' (echo server)
                              POST /crm/customers/lookup {customerId: request.from, ...}
                              — the echoed request stands in for a CRM record
              ▼
            buildTriageInput  jsFunction   → JSON.stringify({customer_message,
                              customer_id, crm_record}) into a single string
              ▼
            triage            agentCall    → agent 'ai-sample-supervisor' (low temperature,
                              strict-JSON prompt) returns
                              {"escalate":bool,"reason","suggested_reply","priority"}
              ▼
            decide            jsFunction   → safely parses the agent JSON
                              (fallback = escalate:true) and builds
                              alertText / resolvedText
              ▼
            route             conditional  (exclusive gateway — first match wins)
              ├── escalate == "true" ──► notifyEscalation  channelSend telegram 🚨 alert
              └── default            ──► notifyResolved    channelSend telegram ✅ summary
```

## Why `conditional` (and not a `branch` or a single message)

The engine has a real if/then/else: the `conditional` action
(`ConditionalAction` in `packages/shared/src/workflow.interfaces.ts`) takes
`branches: [{ label, condition: { variable, comparator, value }, actions }]` plus an optional
`default`, and the executor (`case "conditional"` in
`services/workflow-service/src/temporal/workflows.ts`) *"evaluates conditions top-to-bottom,
executes first match"* — only the matching arm runs, unlike `branch`, which always runs **all**
arms in parallel. The condition here is:

```json
{ "variable": "results.decide.escalate", "comparator": "eq", "value": "true" }
```

`variable` is resolved raw (`resolvePathRaw`) and `eq` compares
`String(left) === String(right)`, so the boolean `escalate` returned by the `decide` jsFunction
matches the string `"true"` exactly. No single-message compromise needed — each outcome is its own
`channelSend` arm.

## How each step maps to the engine

Verified against `packages/shared/src/workflow.interfaces.ts`,
`services/workflow-service/src/temporal/workflows.ts`, and
`services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts`:

| Step | Activity | Notes |
| --- | --- | --- |
| Receive a message on this sample's HTTP instance | `trigger: message_received`, `channels:["http"]`, `config.accountIds:[<this instance>]` | Pinned so only messages posted to this instance's ingest URL fire this workflow |
| CRM lookup | `serviceCall` | `serviceId` MUST be the `registered_services` **UUID** (resolved by slug at setup time — never the name); `serviceSlug` is passed too so `connector-runtime` can hit the adapter mirror in O(1). Result shape is `{ status, data, headers }` |
| Build the triage payload | `jsFunction` | Needed because `{{…}}` templating `String()`-coerces each leaf — `{{results.lookupCustomer.data}}` inside the agent message would become `[object Object]`. This step returns `{ text: JSON.stringify(payload) }` |
| AI triage | `agentCall` | `args` = `agentId` + `message` (`AgentCallArgs`); the activity result is `{ status, data: { reply, tool_calls }, headers }` (`agent-call.activity.ts`), so the agent's JSON verdict lives at `results.triage.data.reply` |
| Parse + fail-safe | `jsFunction` | Strips code fences, extracts the outermost `{…}`, `JSON.parse`s. **Any parse failure falls back to `escalate:true`** — a broken triage always reaches a human |
| Route | `conditional` | First-match exclusive gateway; returns `{ matchedBranch: <label \| "default" \| null> }` |
| Notify | `channelSend` | `accountId`/`channel`/`provider`/`to`/`type` required; `to` is the supervisor's Telegram `chat_id` |

## Message flow

| # | From | Transport | Subject / URL | To |
|---|------|-----------|---------------|----|
| 1 | HTTP client | HTTPS POST · `x-http-channel-token: <appSecret>` | `/api/webhooks/http/acme/ai-call-center-supervisor` | api-gateway |
| 2 | api-gateway | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingress) | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC | task queue `workflow-orchestrator` · workflow `runWorkflow` | workflow-service worker |
| 5 | workflow-service worker · `serviceCall` activity (lookupCustomer) | Temporal gRPC → HTTP | task queue `connector-runtime` → `sample-crm` Knative service (in-cluster) | connector-runtime → sample-crm |
| 6 | workflow-service worker · `jsFunction` (buildTriageInput) | local (in-process) | task queue `workflow-orchestrator` | workflow-service worker |
| 7 | workflow-service worker · `agentCall` activity (triage) | NATS request via `YoizenClawExecutionClient` | platform execution subjects → agent-ai-service (LLM call) | agent-ai-service |
| 8 | workflow-service worker · `jsFunction` (decide) + `conditional` (route) | local (in-process) | task queue `workflow-orchestrator` | workflow-service worker |
| 9 | workflow-service worker · `channelSend` activity (notifyEscalation *or* notifyResolved) | NATS core publish · captured by `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 10 | channel-service-worker (egress) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

> Unlike `http-bridge`, this sample DOES hop through `connector-runtime` (the `serviceCall`, hop 5)
> and through `agent-ai-service` (the `agentCall`, hop 7). Exactly one of the two `channelSend`
> arms runs per execution — that's the `conditional`.

## Prerequisites

1. **A Telegram channel account** with a real bot token, and you must have `/start`-ed the bot
   (the supervisor chat is discovered from the bot's recent messages, same mechanism as
   `http-bridge`):
   ```bash
   (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-…" ./setup.sh)
   ```
2. **An LLM provider key** — the triage agent needs a real online LLM. Put `OPENAI_API_KEY`
   (or another provider's key) in `.env`.
3. **A cluster with `registry-service` + Knative** — the mock CRM is a hosted service
   (`POST /api/registry/services` → Knative Service in the tenant namespace).

## Run

```bash
cd integrations/ai/ai-call-center-supervisor
cp .env.example .env   # set OPENAI_API_KEY; optionally pin TELEGRAM_CHAT_ID
./setup.sh
./run.sh
```

`setup.sh` is staged and idempotent — reruns reuse/update every resource by name; `RECREATE=1`
rebuilds them:

```
0/7 preflight                 provider-key checks
2/7 ensure hosted CRM         client.registry.services create/update + wait for Knative Ready
3/7 ensure LLM connector      reuses 'sample-openai-llm' if ai-agent-playground already made it
4/7 ensure + publish agent    'ai-sample-supervisor' (temperature 0.1, strict-JSON prompt)
5/7 resolve telegram + chat   auto-discovers the supervisor chat_id; ensures the HTTP instance
6/7 ensure workflow           assembled via client.workflows, serviceId resolved to the registry UUID
7/7 summary                   prints the ingest URL + channel token
```

`run.sh` verifies the workflow, resolves the instance's `appSecret`, and POSTs two contrasting
messages:

- **Angry** — `"third time my bill is wrong, I want a $200 refund or I cancel"` → refund > $100 +
  churn threat + very negative sentiment → the agent returns `escalate:true` → Telegram gets
  **🚨 SUPERVISOR ESCALATION** with priority, reason, and a suggested reply.
- **Calm** — `"how do I update my email address?"` → routine → `escalate:false` → Telegram gets
  **✅ AUTO-RESOLVED** with the agent's suggested reply.

The LLM call takes a few seconds per message; the notifications arrive on the supervisor's
Telegram chat, never in the HTTP response (ingest always answers `{"status":"accepted"}`).

## Environment

`setup.sh` sources `../lib/resolve-env.sh`, which loads `.env` from this directory and detects the
dev gateway endpoint. All knobs:

| Var | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` (or provider equivalent) | *(required)* | Real LLM key for the triage agent's connector |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` creates/reuses an LLM connector; `env` assumes agent-ai-service already has the provider key in its deployment env |
| `AI_AGENT_PROVIDER` / `AI_AGENT_MODEL` | `openai` / `gpt-4o-mini` | Triage agent LLM |
| `AI_AGENT_NAME` | `ai-sample-supervisor` | Agent name (created + published) |
| `AI_LLM_CONNECTOR_NAME` | `sample-<provider>-llm` | Same default as `ai-agent-playground` — the connector is shared between the two samples |
| `CRM_SERVICE_NAME` | `sample-crm` | Hosted mock-CRM service name (lowercase DNS-ish) |
| `CRM_SERVICE_IMAGE` | `ealen/echo-server:latest` | Must run as UID `1001` and serve `/health` (registry-service hardcodes both) |
| `CRM_SERVICE_PORT` | `8080` | Container port; do NOT set `PORT` in envVars — Knative reserves it |
| `CRM_MIN_SCALE` / `CRM_MAX_SCALE` / `CRM_CONCURRENCY_TARGET` | `0` / `2` / `25` | Knative autoscaling knobs |
| `CRM_READY_TIMEOUT_S` | `120` | Max wait for Knative `Ready`; timeout only warns (scale-from-zero handles the rest) |
| `TELEGRAM_CHAT_ID` | auto-discovered | Supervisor's numeric chat id; set to pin, otherwise picked from the bot's most recent `getUpdates` chat |
| `TG_ACCOUNT_ID` | first active telegram account | Pin a specific Telegram channel account |
| `SUPERVISOR_RESTORE_WEBHOOK` | `1` | Chat discovery must clear an active bot webhook to poll `getUpdates`; `1` restores it afterward |
| `SUPERVISOR_DISCOVER_WAIT_SECONDS` / `SUPERVISOR_DISCOVER_POLL_INTERVAL` | `60` / `2` | Discovery prompt cap / retry interval (see `http-bridge` README for the full webhook-vs-getUpdates story) |
| `SUPERVISOR_WORKFLOW_NAME` | `ai-call-center-supervisor` | Workflow name |
| `SUPERVISOR_HTTP_EXTERNAL_ID` | `ai-call-center-supervisor` | Dedicated HTTP instance externalId (last segment of the ingest URL) |
| `SUPERVISOR_HTTP_ACCOUNT_NAME` | `AI Call Center Supervisor` | Instance display name |
| `SUPERVISOR_PIN` | `1` | Pins the trigger to this instance via `accountIds`; `0` lets any HTTP message on the tenant fire it |
| `RECREATE` | `0` | `1` deletes + rebuilds the service, agent, HTTP instance, and workflow |
| `YOIZEN_BASE_URL` / `YOIZEN_HOST_HEADER` / `YOIZEN_TENANT` / `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` | dev defaults | Gateway + tenant login (resolved by `resolve-env.sh`) |
| `SUPERVISOR_RUN_TEXT_ANGRY` / `SUPERVISOR_RUN_TEXT_CALM` / `SUPERVISOR_RUN_PAUSE_SECONDS` | see `.env.example` | `run.sh` test messages and pause between them |

## Design notes & gotchas

- **`serviceCall.serviceId` is the registry UUID, never the slug.** `ServiceCallArgs` in
  `packages/shared/src/workflow.interfaces.ts` is explicit: *"Stable id of the row in
  `registered_services` (UUID, never the slug)"*. `setup.sh` resolves it by name at provision time
  and also passes `serviceSlug` so `connector-runtime` can hit the internal-adapter mirror without
  a registry round-trip.
- **`{{…}}` templating is string-coercing** (`String(resolvePath(...))` per leaf in
  `workflows.ts`), which is why `buildTriageInput` exists: the CRM record must be stringified in a
  `jsFunction` before it can ride inside the agent `message`. The `conditional`'s `variable`, in
  contrast, is resolved **raw** (`resolvePathRaw`) — that's why matching a boolean against
  `value: "true"` works via `eq`'s `String(left) === String(right)`.
- **The `decide` step is fail-safe.** If the LLM returns anything other than parseable JSON
  (despite the strict prompt and `temperature: 0.1`), the verdict falls back to
  `escalate: true, priority: high` — a broken triage pipeline pages a human instead of silently
  auto-resolving.
- **Exactly one notification per message.** `conditional` executes only the first matching branch
  (or `default`) — unlike `branch`, which runs all arms in parallel. Don't "fix" the router by
  swapping it for a `branch`; you'd get both messages every time.
- **The echo server is the CRM.** `ealen/echo-server` reflects the request back, so
  `results.lookupCustomer.data` contains (among other request details) the
  `{customerId, message, source}` body the workflow POSTed — a stand-in CRM record that the agent
  sees verbatim inside `crm_record`. Swap `CRM_SERVICE_IMAGE` for a real service to make it real.
- **First message may be slow.** With `CRM_MIN_SCALE=0` the Knative pod scales from zero on the
  first `serviceCall`, and the LLM call itself takes seconds. `setup.sh` waits for the service's
  `Ready` condition (via `GET /api/registry/services/:id` → `knativeStatus.conditions`), but a
  cold start can still add a few seconds at run time.
- **The connector is shared with `ai-agent-playground`.** Both samples default to the same
  `sample-openai-llm` connector name and reuse it if present — re-running either sample updates
  the key/baseUrl in place.
- **Trigger pinning** works exactly as in `http-bridge`: `SUPERVISOR_PIN=1` (default) sets
  `config.accountIds` to this sample's own HTTP instance so no other HTTP workflow cross-fires.
  The same stale-pin trap applies if you recreate the instance while an old workflow keeps the
  previous account id — re-run `setup.sh` to rewire.
- **Telegram chat discovery** clears and restores the bot webhook, and previously webhook-consumed
  `/start`s never replay — send `/start` again when prompted. Full gotcha list in
  [`http-bridge/README.md`](../http-bridge/README.md#design-notes--gotchas).
- **The `triage` step pins a fixed `conversationId`** (`ai-call-center-supervisor`), so all test
  customers share one agent conversation thread. A real integration should derive it per customer
  (e.g. from `request.from`).
