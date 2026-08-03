# ai-call-center-supervisor

The **capstone** sample — an AI supervisor loop that mixes every workflow ingredient the other
samples introduce one at a time: a **hosted service** (mock CRM), an **AI agent**
(`agentCall`), **conditional routing**, and **Telegram escalation**. Provisioning is
**declarative**: a single [`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no
setup scripts).

```
HTTP msg ─► trigger (message_received, channels:["http"])
              │
              ▼
        lookupCustomer   serviceCall  ─► hosted service 'sample-crm' (echo server) POST /crm/customers/lookup
              ▼
      buildTriageInput   jsFunction   ─► stringifies {customer_message, customer_id, crm_record}
              ▼
             triage       agentCall    ─► agent 'ai-sample-supervisor' returns compact JSON verdict
              ▼
             decide       jsFunction   ─► safely parses the verdict (fail-safe = escalate:true)
              ▼
             route        conditional  ─► escalate==true -> 🚨 alert / default -> ✅ resolved (channelSend)
```

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| Channel | `ai-call-center-supervisor` | Dedicated HTTP ingest instance |
| Connector | `sample-openai-llm` | Shared with the other AI samples; `tags: [llm]` (required by agent-admin-service's credential resolver) |
| Agent | `ai-sample-supervisor` | `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |
| Hosted service | `sample-crm` | `ealen/echo-server:latest`, `env: [{ name: YOIZEN_SAMPLE, value: ai-call-center-supervisor }]` (T05 gap 5 plain-string env) |
| System variable | `ai-call-center-supervisor-chat-id` | Telegram recipient — see § Configure |
| Workflow | `ai-call-center-supervisor` | `lookupCustomer` (serviceCall) -> `buildTriageInput` (jsFunction) -> `triage` (agentCall) -> `decide` (jsFunction) -> `route` (conditional) |

> **Cross-sample dependency, `external: true`**: the Telegram channel — owned by
> [`telegram-transform-reply`](../../channels/telegram-transform-reply)'s `manifest.yaml`. Apply it
> first.

## Trigger is pinned to this sample's own channel

The trigger is pinned to this manifest's own `ai-call-center-supervisor` HTTP channel account via
`trigger.config.accountIds: [{channelRef: ai-call-center-supervisor}]` — the plural `accountIds`
array substitution (`ARRAY_SUBSTITUTION_ALLOWLIST`). No other HTTP-triggered workflow fires on this
instance's traffic.

## Secrets (LLM connector bearer auth)

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `ai-call-center-supervisor-openai-api-key` | `authConfig.bearerToken` | Your real `OPENAI_API_KEY` |

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default) and registry-service +
  Knative (hosted services).
- `telegram-transform-reply/manifest.yaml` already applied and its bot `/start`-ed.
- A real OpenAI API key.
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD`.

## Provision (declarative)

```bash
cd sdk && bun link

yoizen manifests validate -f ../integrations/ai/ai-call-center-supervisor/manifest.yaml
yoizen manifests plan     -f ../integrations/ai/ai-call-center-supervisor/manifest.yaml
env "ai-call-center-supervisor-openai-api-key=$OPENAI_API_KEY" \
  yoizen manifests apply  -f ../integrations/ai/ai-call-center-supervisor/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged (the hosted service may take a moment to reach Ready —
`serviceCall` cold-starts it on the first call regardless).

## Configure (Telegram recipient)

Edit `spec.systemVariables[0].value` in `manifest.yaml` to your real numeric Telegram chat id, then
re-apply. The workflow reads it at RUNTIME via
`{{variables.system.ai-call-center-supervisor-chat-id}}`.

## Run / exercise

```bash
cd integrations/ai/ai-call-center-supervisor
./run.sh
```

`run.sh` (`src/index.ts`) verifies (read-only) the workflow and the dedicated HTTP instance, then
posts an ANGRY message (expect 🚨 SUPERVISOR ESCALATION) and a CALM one (expect ✅ AUTO-RESOLVED) a
few seconds apart.

## Environment (run.sh overrides only — provisioning is manifest-driven)

| Var | Default | Notes |
| --- | --- | --- |
| `SUPERVISOR_WORKFLOW_NAME` | `ai-call-center-supervisor` | Must match `manifest.yaml`'s workflow name |
| `AI_AGENT_NAME` | `ai-sample-supervisor` | Only used in a log line |
| `SUPERVISOR_HTTP_EXTERNAL_ID` | `manifest:ai-call-center-supervisor` | The apply engine's derived externalId |
| `SUPERVISOR_RUN_TEXT_ANGRY` / `SUPERVISOR_RUN_TEXT_CALM` | see `.env.example` | The two sample messages |
| `SUPERVISOR_RUN_PAUSE_SECONDS` | `3` | Pause between the two messages |

## Design notes & gotchas

- **`serviceId`** resolves via the manifest-time `serviceRef` symbolic ref (parent SPEC T05); the
  hosted service's `envVars`/env is expressed as `env: [{ name, value }]` (this SPEC's T05, gap 5 —
  plain strings only, `YOIZEN_SAMPLE` is a non-functional debug marker, not a credential).
- **Cold start**: `minScale: 0` means the first `serviceCall` may be slow while Knative scales the
  pod up.
