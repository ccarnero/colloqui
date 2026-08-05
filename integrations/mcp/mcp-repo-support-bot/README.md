# mcp-repo-support-bot

A realistic **end-to-end** demo of the `mcpCall` workflow action
(`DOCS/architecture/mcp-connections.md` §5): a Telegram "Repo Support Bot" that
answers questions about a GitHub repository by calling the public
[DeepWiki](https://mcp.deepwiki.com/mcp) MCP server from inside a workflow.
Provisioning is **declarative**: a single [`manifest.yaml`](./manifest.yaml)
applied through the `yoizen` CLI (no setup scripts).

Where [`mcp-connections`](../mcp-connections) demonstrates the MCP *SDK call
shapes* against a fake endpoint, this sample wires a **real** MCP server into a
**real** multi-step workflow, combining the Telegram channel pattern from
[`telegram-transform-reply`](../../channels/telegram-transform-reply) with the
triage-agent pattern from [`ai-agent-triage`](../../ai/ai-agent-triage).

```
manifest.yaml ─► yoizen manifests apply ─► agent-admin-service (mcp server, agents, channel, workflow)

Telegram inbound ─► workflow-service ─► [agentCall triage] ─► [conditional] ─► mcpCall(DeepWiki) ─► [agentCall summarize] ─► [channelSend reply]
```

## The scenario

```
Telegram inbound (a user asks a question)
  → [agentCall  triage]     classify: is this about the repo, or not?
  → [jsFunction route]      parse the triage agent's strict-JSON verdict
  → [conditional respond]
      ├─ about the repo → [mcpCall     askDeepwiki]  DeepWiki ask_question(repoName, question)
      │                    [jsFunction  extract]      flatten the tool result into plain text
      │                    [agentCall   summarize]    rewrite the technical answer, briefly + friendly
      │                    [channelSend reply]        answer over Telegram (same chat)
      └─ anything else  → [channelSend decline]       polite "I only answer questions about repo X"
```

## Kind decision (`kind: IntegrationManifest`)

Unlike `mcp-connections`/`ai-agent-playground` (both channel-less
`LibraryManifest`s), this manifest declares a Telegram inbound channel account
**and** a process (two agents + a workflow) — both
`checkAtLeastOneInboundChannel` and `checkAtLeastOneProcess`
(`validate-structural-rules.ts`) are satisfied without any waiver, so this is
a plain `IntegrationManifest` (manifest v1's default `kind`).

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| MCP server | `deepwiki` | `transport_type: http`, `authType: "none"` (omitted `auth`), `https://mcp.deepwiki.com/mcp` (public, no auth) |
| LLM connector | `sample-openai-llm` | `authType: bearer` via `secretRef`, `tags: [llm]`; **same name** as `ai-agent-triage`/`ai-agent-playground` — reconciles the SAME live connector when applied to the same tenant |
| Agent | `repo-support-triage` | Classifier; replies strict JSON `{"about_repo": true\|false}`; `model_config.llm.connectorId: { connectorRef: sample-openai-llm }` |
| Agent | `repo-support-summarizer` | Rewrites DeepWiki's technical answer for end users; same connector |
| Channel | `mcp-repo-support-bot` (telegram) | RECEIVE via the auto-generated webhook secret, SEND via the bound bot token |
| Workflow | `mcp-repo-support-bot` | The action chain above; `agentId`/`serverId` are `{ agentRef }`/`{ mcpServerRef }` symbolic refs |

Neither agent is wired to the MCP server directly (no `enabledMcpTools`/
`toolDescriptionOverrides`, unlike `mcp-connections`'s demo agent) — the
workflow calls DeepWiki **directly** via the `mcpCall` action instead; this
mirrors the deleted `setup.ts` exactly (it never called
`updateEnabledMcpTools` for this sample).

## The exact action chain (as implemented)

The top-level workflow is three actions: `triage` (agentCall) → `route`
(jsFunction) → `respond` (conditional). The conditional's matched branch runs
its nested actions **sequentially through the same execution context**, so
each nested action can reference the previous one's result via
`{{results.<name>...}}` (verified in `workflow-service`'s
`temporal/workflows.ts` — a matched branch calls
`executeActions(branch.actions, context)` with the shared context).

Two `jsFunction` bridges are used, both deliberate, not gold-plating:

- **`route`** — a conditional's `variable` is a dot-path walked over objects;
  it **cannot parse a JSON string** itself. So `route` parses the triage
  agent's `{"about_repo": …}` reply (at `results.triage.data.reply`) into a
  real boolean at `results.route.about_repo` for the condition to compare.
  Same bridge role as `ai-agent-triage`'s `route` step. Fail-safe: an
  unparseable verdict is treated as "not about the repo" (decline) rather
  than firing an MCP call on garbage.
- **`extract`** — the `mcpCall` activity stores `{ toolName, result, isError,
  durationMs }` at `results.askDeepwiki` (see
  `connector-runtime/src/activities/mcp-call.activity.ts`, `IMcpCallResult`).
  `result` is the tool's MCP `content` **verbatim**, which for a text tool may
  be a string or an array of `{ type: "text", text }` blocks depending on the
  `@ai-sdk/mcp` version. `extract` normalizes all of those into a single
  `answer` string the summarizer consumes via a template.

`accountId`/`channel`/`provider`/`to` in the `reply`/`decline` actions are
RUNTIME templates (`{{request...}}`) resolved by `workflow-service`
per-request — replying to the SAME chat/account the message came from needs
no symbolic ref (same pattern as `telegram-transform-reply`'s own `reply`
action).

## Secrets

Binding NAMEs are hyphenated (manifest v1 has no naming transform — decision
7); a sourced `.env` cannot hold hyphenated identifiers directly, so
`.env.example` documents plain-name inputs (`OPENAI_API_KEY`,
`TELEGRAM_BOT_TOKEN`) and the apply command below remaps them to the exact
binding names via `env "<binding-name>=$VALUE"`.

| Binding name (`--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `mcp-repo-support-bot-openai-api-key` | connector `authConfig.bearerToken` | Your real `OPENAI_API_KEY` — both agents need a working LLM |
| `mcp-repo-support-bot-telegram-token` | channel `accessToken` (bot token) | Your real `TELEGRAM_BOT_TOKEN` for outbound delivery; ANY non-empty value provisions successfully |

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD` — same as every other sample.
- A real OpenAI API key. A real Telegram bot token from @BotFather for outbound delivery
  (optional for observing the chain fire — see below).
- Cluster egress to `mcp.deepwiki.com` (DeepWiki is a real, public MCP server).

## Provision (declarative)

```bash
cd sdk && bun link   # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/mcp/mcp-repo-support-bot/manifest.yaml
yoizen manifests plan     -f ../integrations/mcp/mcp-repo-support-bot/manifest.yaml
env "mcp-repo-support-bot-openai-api-key=$OPENAI_API_KEY" \
    "mcp-repo-support-bot-telegram-token=$TELEGRAM_BOT_TOKEN" \
  yoizen manifests apply  -f ../integrations/mcp/mcp-repo-support-bot/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Run / verify

```bash
cd integrations/mcp/mcp-repo-support-bot
cp .env.example .env     # set OPENAI_API_KEY
./run.sh
```

`run.sh` (`src/index.ts`):

1. Confirms the DeepWiki MCP server, both agents, and the workflow all exist.
2. Best-effort probes the MCP server with `testConnection()`/`listTools()` —
   DeepWiki is real and public, so these are expected to succeed; failures are
   logged as warnings, never a hard failure.
3. By default (`SIMULATE_INBOUND=1`) POSTs a signed synthetic Telegram inbound
   update to the webhook ingest endpoint and polls for the resulting workflow
   execution. **Observing the execution proves the whole chain (including the
   real `mcpCall` to DeepWiki) fired** — it does *not* require Telegram to
   deliver the outbound reply, which is what makes the sample runnable
   **without a live Telegram bot**.

This driver never creates or modifies platform objects — apply `manifest.yaml`
first.

### Simulating requires the webhook secret

The account's webhook `appSecret` is **not** surfaced by `manifests apply` (it
is channel-service-internal). Fetch it once via `GET /channels/accounts` (or
the SDK's `client.channels.listAccounts()`) after applying, and set
`TELEGRAM_WEBHOOK_SECRET` in `.env`. Set `SIMULATE_INBOUND=0` to skip
simulation and only verify the resources exist.

### For real Telegram delivery

Set a real `TELEGRAM_BOT_TOKEN` in the apply command above (from @BotFather),
apply, then just **message the bot** — no simulation needed. Registering the
Telegram webhook itself (so a real inbound message reaches the platform) is
outside this sample's declarative scope; see `telegram-transform-reply`'s own
webhook-registration notes if you need a public HTTPS tunnel.

### The env template is `.env.example` (renamed 2026-08-04)

Until 2026-08-04 this sample and `../mcp-connections` shipped their template as
`env.example`, without the leading dot that the other eleven sample templates
carry. There was **no technical reason** for it: the dot had been dropped under
the belief that `.env.*` files could not be written in the authoring
environment, and the 2026-08-03 docs audit disproved that (it edited eight
dotted templates in place the same day). The docs-truth-audit T10 renamed both
(ruling D34), so all thirteen sample templates are now `.env.example`. Copy it
to `.env` (`cp .env.example .env`); `../../lib/resolve-env.sh`, which `run.sh`
sources, loads `.env` from this directory.

## Trigger is pinned to this sample's own channel

The trigger is pinned to this manifest's own `mcp-repo-support-bot` Telegram
channel account via `trigger.config.accountIds:
[{channelRef: mcp-repo-support-bot}]` — the plural `accountIds` array
substitution (`ARRAY_SUBSTITUTION_ALLOWLIST`). No other Telegram-triggered
workflow fires on this account's traffic.

## Why a public MCP server is required

The `mcpCall` activity applies an **SSRF guard** before connecting (ported
from the adapter executor — see `mcp-call.activity.ts` `validateUrl`): it
rejects non-`http(s)` schemes, `localhost`, cloud-metadata
(`169.254.169.254`), link-local, and RFC1918 (`10/8`, `172.16/12`,
`192.168/16`) targets. A locally hosted MCP server will be blocked — you
**must** point at a public endpoint like DeepWiki.

## Feature flags

The `mcpCall` workflow action requires **no** feature flag: it executes on
`connector-runtime`, independent of agent-side tool resolution. In
particular, `AGENT_MCP_TOOL_FILTERING_ENABLED` gates per-tool filtering on the
**agent** side only (`agent-ai-service`) and is **not** needed for this
sample (neither agent uses `enabledMcpTools`). Both agents do need a working
LLM connector.

## Troubleshooting

- **`missing required env var`** — `run.sh` requires `YOIZEN_TENANT`/`_EMAIL`/
  `_PASSWORD`/`_BASE_URL`; `resolve-env.sh` should set these automatically.
- **`MISSING mcp server / agent / workflow`** — apply `manifest.yaml` first.
- **`no tools discovered` / `testConnection` warning** — non-fatal; check that
  the cluster has egress to `mcp.deepwiki.com`. If `ask_question` is missing
  from the discovered set, the `mcpCall` step will fail at runtime.
- **Execution observed but no Telegram reply** — expected with a fake/no-op
  token, or when the chat hasn't `/start`-ed the bot.
- **`BLOCKED_MCP_SERVER_URL` at runtime** — the configured DeepWiki URL
  resolves to a private/localhost address; use a public endpoint (SSRF guard).
- **No execution observed within the timeout** — check `workflow-service` /
  trigger-consumer logs; confirm the manifest was applied (the trigger is
  pinned to this sample's own channel, see above).
- **`TELEGRAM_WEBHOOK_SECRET is required`** — fetch the account's `appSecret`
  via `GET /channels/accounts` after apply, or set `SIMULATE_INBOUND=0`.
