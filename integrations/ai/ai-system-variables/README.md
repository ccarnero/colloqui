# ai-system-variables

**System Variables as live configuration**: manifest v1's `systemVariables` section drives a
brand-stamped escalation router at three verified runtime resolution points — in one workflow.
`company-name` is stamped into every Telegram notification (**action-arg templating** in
`channelSend`), `escalation-priority` is the **templated right-hand side of a `conditional` rule**
(the routing policy is data: `PATCH` the variable and the workflow re-routes with **no workflow
edit**), and `brand-voice` is referenced **inside the agent's `system_prompt`** (resolved by
agent-ai-service's template renderer at `agentCall` time). Provisioning is **declarative**: a
single [`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no setup scripts).

```
HTTP msg ─► trigger (message_received, channels:["http"])
              │
              ▼
            triage    agentCall   ─► agent 'ai-sample-sysvars' (system_prompt embeds
                                      {{variables.system.brand-voice}} + {{variables.system.company-name}})
              ▼
            parse     jsFunction  ─► parses results.triage.data.reply -> { priority, summary }
              ▼
            notify    conditional ─► results.parse.priority eq {{variables.system.escalation-priority}}
                                      -> 🚨 escalation / ✅ handled (channelSend)
```

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| Channel | `ai-system-variables` | Dedicated HTTP ingest instance |
| Connector | `sample-openai-llm` | Shared with the other AI samples |
| System variables | `company-name`, `escalation-priority`, `brand-voice`, `ai-system-variables-chat-id` | All `type: string`, none secret — see § Naming below |
| Agent | `ai-sample-sysvars` | `system_prompt` embeds `{{variables.system.company-name}}`/`{{variables.system.brand-voice}}` verbatim |
| Workflow | `ai-system-variables` | `triage` (agentCall) -> `parse` (jsFunction) -> `notify` (conditional) |

> **Cross-sample dependency, `external: true`**: the Telegram channel — owned by
> [`telegram-transform-reply`](../../channels/telegram-transform-reply)'s `manifest.yaml`. Apply it
> first.

## Naming (slug vs. camelCase)

The manifest schema's `systemVariables[].name` is a slug (`nameSchema` — lowercase alphanumeric +
hyphens, no camelCase). The deleted `setup.ts` used the platform's own camelCase names
(`companyName`/`escalationPriority`/`brandVoice`) directly via the live API. This manifest renames
them to `company-name`/`escalation-priority`/`brand-voice` — every
`{{variables.system.<name>}}` reference (in the agent's `system_prompt` and the workflow) uses the
SAME renamed slug consistently, so runtime resolution works end to end; only the human-facing
variable NAME changed, not its semantics. The Telegram recipient is a SEPARATE, fourth variable
(`ai-system-variables-chat-id`) — delivery plumbing, not one of the three demonstrated resolution
points.

## Secrets (LLM connector bearer auth)

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `ai-system-variables-openai-api-key` | `authConfig.bearerToken` | Your real `OPENAI_API_KEY` |

## Documented deviation (trigger is unpinned)

Same limitation as `ai-agent-triage`/`http-fanout-telegram`: manifest v1's symbolic-ref
substitution only covers the singular `accountId` action-argument key, not the plural
`trigger.config.accountIds`. This trigger fires on **any** HTTP message for the tenant.

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- `telegram-transform-reply/manifest.yaml` already applied and its bot `/start`-ed.
- A real OpenAI API key.
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD`.

## Provision (declarative)

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-system-variables/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-system-variables/manifest.yaml
env "ai-system-variables-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-system-variables/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Configure (live policy flip, no workflow edit)

Edit `spec.systemVariables[*].value` in `manifest.yaml` and re-apply — e.g. set
`escalation-priority`'s value to `urgent` so only `urgent`-classified messages escalate:

```bash
yoizen manifests apply -f ../integrations/ai/ai-system-variables/manifest.yaml --secrets-from-env
```

`workflow-service` caches system variables per tenant for 5 minutes — allow up to 5 min before new
executions pick up the change. Also edit `ai-system-variables-chat-id`'s value to your real
Telegram chat id before running.

## Run / exercise

```bash
cd integrations/ai/ai-system-variables
./run.sh
```

`run.sh` (`src/index.ts`) verifies (read-only) the workflow, prints the CURRENT values of the three
system variables, then posts a FURIOUS message and a CALM one through the dedicated HTTP instance.
Expect Telegram DMs stamped with the `company-name` variable's value, e.g. `"🚨 [Acme Telco]
escalation — priority: high"`.

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `SYSVARS_WORKFLOW_NAME` | `ai-system-variables` | Must match `manifest.yaml`'s workflow name |
| `SYSVARS_HTTP_EXTERNAL_ID` | `manifest:ai-system-variables` | The apply engine's derived externalId |
| `SYSVARS_RUN_DELAY_S` | `2` | Seconds between the sample messages |

## Design notes & gotchas

- **`{{...}}` templating is string-coercing** — see the three resolution points above; `parse`'s
  `jsFunction` returns ONLY `{ priority, summary }`, keeping the routing DECISION in the
  `conditional`'s templated right-hand side (the variable store), not in code.
- **Cross-firing** with other unpinned HTTP-triggered samples — see § Documented deviation above.
