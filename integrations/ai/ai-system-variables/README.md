# ai-system-variables

**System Variables as live configuration**: the admin-console **AI > System Variables** store
drives a brand-stamped escalation router at its three verified runtime resolution points — in
one workflow. `companyName` is stamped into every Telegram notification (**action-arg
templating** in `channelSend`), `escalationPriority` is the **templated right-hand side of a
`conditional` rule** (the routing policy is data: `PATCH` the variable and the workflow
re-routes with **no workflow edit**), and `brandVoice` is referenced **inside the agent's
`system_prompt`** as `{{variables.system.brandVoice}}`, resolved by agent-ai-service's template
renderer when the agent runs via the workflow `agentCall`. Structurally this is the
[`ai-agent-triage`](../ai-agent-triage) pipeline (agentCall → jsFunction → conditional →
channelSend), but every brand- or policy-shaped literal has been pulled out of the workflow and
the prompt and into the tenant's variable store.

```
HTTP msg ─► trigger (message_received, channels:["http"], pinned to this sample's own instance)
              │
              ▼
            triage    agentCall — agentId: <ai-sample-sysvars>, message: {{request.text}};
                      the agent's system_prompt embeds {{variables.system.brandVoice}} and
                      {{variables.system.companyName}} — resolved at execution time by
                      agent-ai-service; the agent replies ONLY with strict JSON
                      {"priority":"low|normal|high|urgent","summary":"..."};
                      result lands at results.triage.data.reply
              ▼
            parse     jsFunction — strips code fences, JSON.parses the reply (fail-safe:
                      an unparseable reply becomes priority "high"), returns
                      { priority, summary } ONLY — parse-only, no routing decision
              ▼
            notify    conditional — exclusive gateway whose RIGHT-HAND SIDE is a variable:
                        { variable: "results.parse.priority", comparator: "eq",
                          value: "{{variables.system.escalationPriority}}" }
                        match   ─► channelSend telegram "🚨 [{{variables.system.companyName}}] escalation — …"
                        default ─► channelSend telegram "✅ [{{variables.system.companyName}}] handled — …"
```

## How each step maps to the engine

Verified against `services/workflow-service` and `services/agent-ai-service`:

| Step | Mechanism | Notes |
| --- | --- | --- |
| Variables CRUD | `GET/POST /api/admin/system-variables`, `PATCH/DELETE /:id` | Gateway proxy (`services/api-gateway/src/modules/admin/admin-system-variables.controller.ts`) to agent-admin-service. `CreateSystemVariableDto` (`services/agent-admin-service/src/modules/system-variables/system-variables.dto.ts`): `name`, `type ∈ [string,number,boolean,json,array,secret]`, `value`, `label?`, `description?` — unique per (tenant, name). List returns `{ variables: [...], total }`; create/patch return the row (`system-variables.service.ts`) |
| Variables reach the workflow | per-tenant load at execution start, **5-min TTL cache** | `workflows.service.ts:322-337` calls `SystemVariablesProvider.loadForTenant` (`system-variables.provider.ts:30-52`, `TTL_MS = 5 * 60 * 1000`), passing the flat `{name: value}` map into `runWorkflow`, which seats it at `context.variables.system` (`temporal/workflows.ts:370-390`). Load errors are non-fatal — the run continues with empty system vars |
| `companyName` in notification text | `resolveTemplates` over **all action args** | `{{variables.system.companyName}}` inside `channelSend.args.text` is resolved like any other context path (`temporal/workflows.ts`) |
| `escalationPriority` as routing policy | conditional `condition.value` is **also template-resolved** | `temporal/workflows.ts:343-346`: the left side (`condition.variable`) is a raw dot-path, the right side (`condition.value`) goes through `resolveTemplates` before the `String(left) === String(right)` comparison. The interface documents it: *"Right-hand value. Also resolved as template (supports {{variables.X}} syntax)"* (`packages/shared/src/workflow.interfaces.ts:229`) |
| `brandVoice` in the agent prompt | agent-ai-service **template renderer** | `agentCall` forwards `context.variables` (overwriting any `args.variables` in the definition) to the agent runtime; `template-renderer.service.ts` whitelists the `variables` namespace for prompts, so `{{variables.system.brandVoice}}` in `system_prompt` resolves per execution |
| Escalation routing | `conditional` | Branches evaluated top-to-bottom, first match wins, `default` when none match. Result exposes `{ matchedBranch }` |
| Telegram notification | `channelSend` | One per gateway arm; `to` → your Telegram `chat_id`; published to the egress stream, delivered by the bot |

## Message flow

| # | From | Transport | Subject / URL | To |
|---|------|-----------|---------------|----|
| 1 | HTTP client | HTTPS POST · `x-http-channel-token: <appSecret>` | `/api/webhooks/http/acme/ai-system-variables` | api-gateway |
| 2 | api-gateway | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.api-gateway.messaging.http.webhook.webhook_received.v1` | channel-service-worker |
| 3 | channel-service-worker (ingress) | NATS JetStream · stream `INGRESS-ACME` | `evt.acme.channel-service.messaging.http.http.received.v1` | workflow-service |
| 4 | workflow-service | Temporal gRPC (system variables loaded here, cached 5 min) | task queue `workflow-orchestrator` · workflow `runWorkflow` | workflow-service worker |
| 5 | workflow-service worker · `agentCall` activity (triage) | NATS JetStream publish | `evt.acme.ai-agent-gateway.automation.platform.internal.execution_requested.v1` | agent runtime (agent-ai-service) |
| 6 | agent-ai-service (renders `{{variables.system.brandVoice}}` into the prompt) | HTTPS | LLM provider via the `sample-<provider>-llm` connector credentials | LLM |
| 7 | agent runtime | NATS execution result events / Redis result cache | awaited by the `agentCall` activity | workflow-service worker |
| 8 | workflow-service worker · `jsFunction` (parse) then `conditional` (notify, RHS = `{{variables.system.escalationPriority}}`) → matched arm's `channelSend` | NATS core publish · captured by `INGRESS-ACME` | `evt.acme.channel-service.messaging.telegram.telegram.send.v1` | channel-service-worker |
| 9 | channel-service-worker (egress) | HTTPS POST | `https://api.telegram.org/bot<token>/sendMessage` | Telegram |

## Prerequisites

This script wires the **system variables**, the **LLM connector**, the **classifier agent**,
the **dedicated HTTP instance** and the **workflow**. You still need:

1. **A Telegram channel account** with a real bot token (the notify path):
   ```bash
   (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN="123:ABC-…" ./setup.sh)
   ```
2. **You must have `/start`-ed the bot.** `setup.sh` auto-discovers `TELEGRAM_CHAT_ID` from the
   bot's recent `getUpdates` — but **only when `TELEGRAM_CHAT_ID` is unset** (discovery clears
   and restores the bot's webhook, so a preset value skips it entirely).
3. **An LLM API key** (e.g. `OPENAI_API_KEY`) in `.env` — the agent runs against a real online
   LLM. The `http-connectors` sample is **not** needed: the LLM connector is created by this
   sample itself (reusing `sample-<provider>-llm` if another AI sample already made it).

## Run

```bash
cd integrations/ai/ai-system-variables
cp .env.example .env   # set OPENAI_API_KEY (or another provider key)
./setup.sh
# [STEP]  2/6 ensure system variables (companyName, escalationPriority, brandVoice)
# [INFO]  created variable companyName (id=…) value='Acme Telco'
# [INFO]  created variable escalationPriority (id=…) value='high'
# [INFO]  created variable brandVoice (id=…) value='warm and upbeat, always thanking the customer'
# [STEP]  3/6 ensure LLM connector 'sample-openai-llm'
# [STEP]  4/6 upsert + publish agent 'ai-sample-sysvars'
# [STEP]  5/6 resolve telegram account + http instance
# [STEP]  6/6 ensure workflow 'ai-system-variables'
./run.sh               # prints the current variable values, posts 2 sample messages
```

`run.sh` shows the **current** values of the three variables (they *are* the configuration),
then POSTs two customer messages: a furious repeated-outage complaint (the agent should
classify it at the escalation priority → 🚨 arm) and a calm roaming question (→ ✅ arm). Both
Telegram notifications arrive stamped with `[<companyName>]` and summarized in the brand voice:

```
🚨 [Acme Telco] escalation — priority: high
Thanks so much for bearing with us — this customer's internet failed three times this week and they're ready to cancel.
Original: This is the THIRD time my internet goes down this week…
```

Then flip the policy **live** — no workflow edit, no redeploy (`run.sh` prints this with the
real variable id):

```bash
curl -X PATCH "$YOIZEN_BASE_URL/api/admin/system-variables/<escalationPriority-id>" \
  -H "Host: $YOIZEN_HOST_HEADER" -H "x-yoizen-tenant: $YOIZEN_TENANT" \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"value":"urgent"}'
# wait ≤5 min (per-tenant cache), re-run ./run.sh:
# the furious "high" message now takes the ✅ default arm — only "urgent" escalates.
```

Rebranding works the same way: `PATCH` `companyName` to `"Globex"` and `brandVoice` to
`"terse and formal"` and every subsequent notification — and the agent's own writing style —
changes tenant-wide.

## Environment

`setup.sh` sources `../lib/resolve-env.sh` automatically, which loads a `.env` file from this
directory (if present) and detects the gateway endpoint.

| Var | Default | Notes |
| --- | --- | --- |
| `SYSVARS_COMPANY_NAME` | `Acme Telco` | Initial value for the `companyName` variable (only used when it doesn't exist yet, or with `SYSVARS_RESET=1`) |
| `SYSVARS_ESCALATION_PRIORITY` | `high` | Initial value for the `escalationPriority` variable (same create-only semantics) |
| `SYSVARS_BRAND_VOICE` | `warm and upbeat, always thanking the customer` | Initial value for the `brandVoice` variable (same create-only semantics) |
| `SYSVARS_RESET` | `0` | `1` PATCHes existing variables back to the values above. Default `0` preserves live edits — a policy flip survives a setup re-run |
| `AI_AGENT_PROVIDER` / `AI_AGENT_MODEL` | `openai` / `gpt-4o-mini` | LLM provider + model (same knobs as `ai-agent-triage`) |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` creates/reuses an `llm`-tagged connector with your API key; `env` assumes agent-ai-service already has the provider env var |
| `OPENAI_API_KEY` (etc.) | — | Provider API key, required for `AI_CREDENTIAL_MODE=connector`. One var per provider (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, …) |
| `AI_LLM_CONNECTOR_NAME` | `sample-<provider>-llm` | Connector name — matches the other AI samples so they all share one connector |
| `AI_AGENT_NAME` | `ai-sample-sysvars` | Agent name (its UUID is resolved by this name and baked into `agentCall.args.agentId`) |
| `TELEGRAM_CHAT_ID` | auto-discovered | Your numeric Telegram chat id. **When preset, discovery (and its webhook clear/restore) is skipped entirely** |
| `TG_ACCOUNT_ID` | first active telegram account | Pin a specific Telegram channel account |
| `YOIZEN_BASE_URL` / `YOIZEN_HOST_HEADER` | dev gateway | Gateway base URL + `Host` header for the dev ingress |
| `YOIZEN_TENANT` / `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` | `acme` / `yclawd@demo.io` / `admin123` | Tenant + login |
| `SYSVARS_WORKFLOW_NAME` | `ai-system-variables` | Workflow name |
| `SYSVARS_HTTP_EXTERNAL_ID` | `ai-system-variables` | Dedicated HTTP instance externalId |
| `SYSVARS_HTTP_ACCOUNT_NAME` | `AI System Variables` | Dedicated HTTP instance display name |
| `SYSVARS_PIN` | `1` | `1` pins the trigger to the dedicated HTTP instance via `accountIds`; `0` lets any HTTP message on the tenant fire it |
| `SYSVARS_RESTORE_WEBHOOK` | `1` | Chat-id discovery must clear any active webhook to poll `getUpdates`; `1` restores it afterward |
| `SYSVARS_DISCOVER_WAIT_SECONDS` / `SYSVARS_DISCOVER_POLL_INTERVAL` | `60` / `2` | Discovery wait/prompt cap and retry gap (same semantics as `ai-agent-triage`) |
| `SYSVARS_RUN_DELAY_S` | `2` | Seconds `run.sh` sleeps between the sample messages |
| `RECREATE` | `1` | Rebuilds the HTTP instance + workflow on every run (they embed the freshly resolved agent id / chat id); variables, connector and agent are upserted in place regardless. Set `0` to reuse by name |

## Design notes & gotchas

- **The 5-minute cache is the price of "live".** Workflow-service loads a tenant's active
  variables once per 5 minutes (`system-variables.provider.ts:11`, `TTL_MS = 5 * 60 * 1000`;
  wired in `workflows.service.ts:322-337`). After a `PATCH`, executions keep using the old
  values until the cache entry expires — budget **up to 5 minutes** before demo-ing the flip.
  There is no invalidation endpoint; the TTL is the only refresh path.
- **The variable load is fail-open.** If the variables query fails, the workflow still runs —
  with an **empty** `variables.system` (`workflows.service.ts:324-331`). Unresolvable
  `{{variables.system.X}}` templates then resolve to empty/verbatim rather than failing the
  run, so a mis-named variable degrades output silently instead of erroring.
- **Direct chat / playground is NOT wired.** The `variables` payload only reaches
  agent-ai-service through the workflow `agentCall` (which forwards `context.variables`).
  Talking to `ai-sample-sysvars` in the admin-console playground or direct chat sends **no
  variables**, so the prompt renderer keeps `{{variables.system.brandVoice}}` verbatim (with a
  warning). Test the brand voice through the workflow, not the playground.
- **`agentCall.args.variables` being overwritten is the feature here.** The executor replaces
  any `args.variables` in the definition with the execution context's own variables — which is
  exactly how the system variables reach the agent's template renderer. In `ai-agent-triage`
  this was a gotcha; here it's the delivery mechanism.
- **`condition.value` is a template; `condition.variable` is not.** The left side is a raw
  dot-path into the context (`resolvePathRaw`), the right side goes through `resolveTemplates`
  (`temporal/workflows.ts:343-346`, documented at `workflow.interfaces.ts:229`). So
  `variable: "results.parse.priority"` + `value: "{{variables.system.escalationPriority}}"` is
  the correct orientation — swapping them wouldn't work.
- **`secret` type is not masked at runtime.** The DTO accepts `type: "secret"`, but the runtime
  loader (`system-variables.provider.ts`) selects `name, value` with no special-casing: a
  secret variable resolves to plaintext anywhere `{{variables.system.X}}` is used — including
  message text sent to Telegram. Don't put real credentials in system variables expecting
  masking.
- **Upsert respects live edits.** `setup.sh` creates missing variables but never overwrites an
  existing value (unless `SYSVARS_RESET=1`), so re-running setup after a live policy flip won't
  silently revert your demo. Names are unique per (tenant, name), and DELETE is a soft delete
  (`is_active=false`) — deleted variables vanish from both the list API and the runtime load.
- **`value` is jsonb.** Create/update `JSON.stringify` the value into a jsonb column; a
  `string` variable round-trips as a JSON string and templating `String()`-coerces it, so
  string comparisons in the conditional behave as expected. `number`/`boolean`/`json` types
  also resolve raw, then get stringified at template time.
- **The parse step is parse-only.** It returns `{ priority, summary }` and takes no routing
  decision — the policy lives in the gateway's right-hand side, i.e. in the variable store.
  Its only opinion is the fail-safe: an unparseable LLM reply becomes priority `"high"`, which
  escalates under the default policy but (deliberately) NOT after you flip the policy to
  `"urgent"` — a reminder that the fail-safe value and the policy value are independent knobs.
- **Telegram discovery caveats are inherited from `http-bridge`** (webhook clear/restore, no
  replay of pre-clear `/start`s, plaintext `accessToken` from the accounts API) — but only when
  `TELEGRAM_CHAT_ID` is unset; a preset chat id skips discovery entirely. See that sample's
  README for the full troubleshooting section — same code, `SYSVARS_*` env names.
- **The ingest response is always `{"status":"accepted"}`.** The workflow runs asynchronously;
  the result arrives on Telegram, never in the HTTP response. Budget a few seconds per message
  for the LLM hop.
