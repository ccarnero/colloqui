# mcp-repo-support-bot

A realistic **end-to-end** demo of the `mcpCall` workflow action
(`DOCS/architecture/mcp-connections.md` §5): a Telegram "Repo Support Bot" that
answers questions about a GitHub repository by calling the public
[DeepWiki](https://mcp.deepwiki.com/mcp) MCP server from inside a workflow.

Where [`mcp-connections`](../mcp-connections) demonstrates the MCP *SDK call
shapes* against a fake endpoint, this sample wires a **real** MCP server into a
**real** multi-step workflow, combining the Telegram channel pattern from
[`telegram-transform-reply`](../../channels/telegram-transform-reply) with the triage-agent
pattern from [`ai-agent-triage`](../../ai/ai-agent-triage).

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

## What gets created

| Resource | Name | Notes |
| --- | --- | --- |
| MCP server | `deepwiki` | `transport_type: "http"`, `authType: "none"`, `https://mcp.deepwiki.com/mcp` (public, no auth) |
| Agent | `repo-support-triage` | Classifier; replies strict JSON `{"about_repo": true\|false}` |
| Agent | `repo-support-summarizer` | Rewrites DeepWiki's technical answer for end users |
| LLM connector | `sample-<provider>-llm` | Created unless `AI_CREDENTIAL_MODE=env` (shared by both agents) |
| Channel account | `Repo Support Bot` (telegram) | RECEIVE + SEND; webhook registered when `TG_PUBLIC_URL` + a real token are set |
| Workflow | `mcp-repo-support-bot` | Trigger on the Telegram account; the action chain above |

## The exact action chain (as implemented)

The top-level workflow is three actions: `triage` (agentCall) → `route`
(jsFunction) → `respond` (conditional). The conditional's matched branch runs
its nested actions **sequentially through the same execution context**, so each
nested action can reference the previous one's result via
`{{results.<name>...}}` (verified in `workflow-service`'s
`temporal/workflows.ts` — a matched branch calls `executeActions(branch.actions,
context)` with the shared context).

Two `jsFunction` bridges are used, both deliberate, not gold-plating:

- **`route`** — a conditional's `variable` is a dot-path walked over objects; it
  **cannot parse a JSON string** itself. So `route` parses the triage agent's
  `{"about_repo": …}` reply (at `results.triage.data.reply`) into a real boolean
  at `results.route.about_repo` for the condition to compare. Same bridge role as
  `ai-agent-triage`'s `route` step. Fail-safe: an unparseable verdict is treated
  as "not about the repo" (decline) rather than firing an MCP call on garbage.
- **`extract`** — the `mcpCall` activity stores `{ toolName, result, isError,
  durationMs }` at `results.askDeepwiki` (see
  `connector-runtime/src/activities/mcp-call.activity.ts`, `IMcpCallResult`).
  `result` is the tool's MCP `content` **verbatim**, which for a text tool may be
  a string or an array of `{ type: "text", text }` blocks depending on the
  `@ai-sdk/mcp` version. `extract` normalizes all of those into a single
  `answer` string the summarizer consumes via a template.

The `mcpCall` step is built with the strongly-typed `McpCallAction` shape via
`satisfies` (same pattern as `mcp-connections`); its `params`
(`repoName` = `REPO_NAME`, `question` = `{{request.text}}`) are `{{...}}`
templates resolved by `workflow-service` before the activity runs.

## Run

```bash
cd integrations/mcp/mcp-repo-support-bot
cp env.example .env      # NOTE: env.example has NO leading dot (see below); set OPENAI_API_KEY
./run.sh
# [STEP]  0/6 preflight
# [STEP]  1/6 upsert MCP server 'deepwiki'
# [INFO]  created mcp server id=... (auth=none, transport=http)
# [STEP]  2/6 test connection + discover tools for 'deepwiki'
# [INFO]  discovered 3 tool(s):  - read_wiki_structure ...  - read_wiki_contents ...  - ask_question ...
# [STEP]  3/6 ensure LLM connector 'sample-openai-llm'
# [STEP]  4/6 upsert + publish triage + summarizer agents
# [STEP]  5/6 ensure Telegram channel account (prefix=repo-support-bot)
# [STEP]  6/6 ensure workflow 'mcp-repo-support-bot'
# [STEP]  simulate inbound Telegram update
# [INFO]  workflow execution observed: { "status": "COMPLETED", ... }
```

`run.sh` defaults `SIMULATE_INBOUND=1`: it POSTs a signed synthetic inbound
update to the webhook ingest endpoint and polls for the resulting workflow
execution. **Observing the execution proves the whole chain (including the
`mcpCall` to DeepWiki) fired** — it does *not* require Telegram to deliver the
outbound reply, which is what makes the sample runnable **without a live
Telegram bot**. With a placeholder token the outbound send 404s, but the
execution still completes.

`./setup.sh` provisions without driving the exchange (`SIMULATE_INBOUND=0`).
Requires Node >=18 and a reachable platform (defaults to the dev cluster).

### For real Telegram delivery

Set a real `TELEGRAM_BOT_TOKEN` (from @BotFather) and `TG_PUBLIC_URL` (a public
HTTPS base Telegram can reach, e.g. a cloudflared tunnel), then run with
`RECREATE=1` once to rotate the account + register the webhook. After that, just
**message the bot** — no simulation needed.

### `env.example` has no leading dot

The shipped template is named `env.example` (not `.env.example`): a sandbox
restriction in the authoring environment prevents writing `.env.*` files. Copy
it to `.env` (`cp env.example .env`) — `resolve-env.sh` loads `.env`.

### Environment

`setup.sh`/`run.sh` source `../lib/resolve-env.sh` automatically, which loads
`.env` from this directory (if present) and detects the gateway endpoint.

| Env var | Default | Purpose |
| --- | --- | --- |
| `REPO_NAME` | `vercel/next.js` | The GitHub repo (`owner/name`) the bot answers about |
| `AI_CREDENTIAL_MODE` | `connector` | `connector` creates an LLM connector from the key below; `env` assumes the service already has it |
| `AI_AGENT_PROVIDER` | `openai` | LLM provider for both agents |
| `AI_AGENT_MODEL` | `gpt-4o-mini` | LLM model for both agents |
| `OPENAI_API_KEY` (etc.) | — | Provider key, required for `AI_CREDENTIAL_MODE=connector` |
| `TELEGRAM_BOT_TOKEN` | placeholder | @BotFather token; without it sends 404 but the chain still runs |
| `TG_PUBLIC_URL` | — | Public HTTPS base for webhook registration (real inbound) |
| `SIMULATE_INBOUND` | `1` in `run.sh`, `0` in `setup.sh` | Drive one synthetic exchange + poll for the execution |
| `SIMULATE_TEXT` | `How does routing work in <repo>?` | The synthetic inbound message |
| `TELEGRAM_TEST_CHAT_ID` | `999999999` | Any number for observe-only; a real /start-ed chat for real delivery |
| `DEEPWIKI_URL` | `https://mcp.deepwiki.com/mcp` | DeepWiki MCP endpoint |
| `DEEPWIKI_TOOL` | `ask_question` | DeepWiki tool the `mcpCall` step invokes |
| `RECREATE` | `0` | `1` deletes this sample's own workflow/agents/MCP server (by name) + rotates the TG account |

DeepWiki's real tools: `read_wiki_structure`, `read_wiki_contents`,
`ask_question`. This bot uses `ask_question`.

## Why a public MCP server is required

The `mcpCall` activity applies an **SSRF guard** before connecting (ported from
the adapter executor — see `mcp-call.activity.ts` `validateUrl`): it rejects
non-`http(s)` schemes, `localhost`, cloud-metadata (`169.254.169.254`),
link-local, and RFC1918 (`10/8`, `172.16/12`, `192.168/16`) targets. A locally
hosted MCP server will be blocked — you **must** point at a public endpoint like
DeepWiki.

## Feature flags

The `mcpCall` workflow action requires **no** feature flag: it executes on
`connector-runtime`, independent of agent-side tool resolution. In particular,
`AGENT_MCP_TOOL_FILTERING_ENABLED` gates per-tool filtering on the **agent**
side only (`agent-ai-service`) and is **not** needed for this sample. The two
agents do need a working LLM connector (or `AI_CREDENTIAL_MODE=env` with the
provider key already in `agent-ai-service`).

## Troubleshooting

- **`OPENAI_API_KEY is required`** — set the provider key in `.env`, or use
  `AI_CREDENTIAL_MODE=env` if the service already has it.
- **`no tools discovered` / `testConnection` warning** — non-fatal; check that
  the cluster has egress to `mcp.deepwiki.com`. If `ask_question` is missing from
  the discovered set, the `mcpCall` step will fail at runtime.
- **Execution observed but no Telegram reply** — expected with a placeholder
  token, or when the chat hasn't `/start`-ed the bot. Use a real token + a real
  `TELEGRAM_TEST_CHAT_ID`, and register the webhook via `TG_PUBLIC_URL`.
- **`BLOCKED_MCP_SERVER_URL` at runtime** — the configured `DEEPWIKI_URL`
  resolves to a private/localhost address; use a public endpoint (SSRF guard).
- **No execution observed within the timeout** — check `workflow-service` /
  trigger-consumer logs; confirm the trigger is pinned to the created account.
