# mcp-connections

Demonstrates the **MCP Connections** feature end to end through `@yoizen/platform-sdk`'s
`mcpServers`, `agents`, and `workflows` resources: typed auth on an MCP server, a live
connectivity probe, live tool discovery, per-agent per-tool enablement (with a description
override), and an `mcpCall` workflow action. This is the MCP counterpart to the
[`http-connectors`](../http-connectors) sample (which does the same for outbound HTTP adapters).

## What gets created

| Resource | Name | Notes |
| --- | --- | --- |
| MCP server | `sample-mcp-server` | `transport_type: "http"`, `authType: "bearer"`, pointed at a **fake/example** URL (`https://mcp.example.com/mcp` by default) |
| Agent | `mcp-connections-demo-agent` | Draft agent with `enabled_mcp_tools` restricted to a hardcoded tool subset for the MCP server above, plus one `tool_description_overrides` entry |
| Workflow | `mcp-connections-demo` | One `mcpCall` action referencing the MCP server + a hardcoded tool name — no trigger, kept intentionally minimal |

The MCP server URL is **intentionally fake** — this sample's job is to demonstrate the SDK
call shapes (`create`, `testConnection`, `listTools`, `updateEnabledMcpTools`,
`updateToolDescriptionOverrides`, and the workflow's `mcpCall` action), not to reach a real
live MCP integration. `testConnection` and `listTools` are expected to fail or return empty
against this fake endpoint — the script handles that gracefully (logged as `[WARN]`, not a
hard failure).

## Run

```bash
cd sdk/samples/mcp-connections
./setup.sh
# [STEP]  0/6 preflight
# [STEP]  2/6 upsert MCP server 'sample-mcp-server'
# [INFO]  created mcp server id=... (auth=bearer, transport=http)
# [STEP]  3/6 test connection for mcp server ...
# [WARN]  testConnection call itself failed (expected — fake endpoint unreachable): ...
# [STEP]  4/6 discover tools for mcp server ...
# [WARN]  no tools discovered (expected — fake endpoint has no real tools/list)
# [STEP]  5/6 upsert agent 'mcp-connections-demo-agent' + per-tool MCP enablement
# [INFO]  created agent id=...
# [INFO]  enabled tools [search, lookup] for mcp server 'sample-mcp-server' on agent ...
# [INFO]  set description override for 'sample-mcp-server:search'
# [STEP]  6/6 ensure minimal workflow 'mcp-connections-demo' with an mcpCall action
# [INFO]  created workflow id=...
```

Requires Node >=18 and a reachable platform (defaults to the dev cluster) — provisioning is
driven by `@yoizen/platform-sdk` via `src/setup.ts` (`setup.sh` resolves the dev environment
and execs it with `npx tsx`); login itself is handled transparently by the SDK client on first
request, which is why the stage numbering skips straight from `0/6` to `2/6`. `./run.sh` is
equivalent to `./setup.sh` — this sample has no separate "call" step, since the workflow is
never actually executed (the MCP server is unreachable by design).

### Environment

`setup.sh` sources `../lib/resolve-env.sh` automatically, which loads a `.env` file from this
directory (if present) and detects the gateway endpoint.

| Env var | Default | Purpose |
| --- | --- | --- |
| `RECREATE` | `0` | `1` deletes this sample's own MCP server / agent / workflow (by name) before reprovisioning |
| `YOIZEN_BASE_URL` | auto-detected | Gateway base URL |
| `YOIZEN_HOST_HEADER` | auto-detected | `Host` header for the dev ingress |
| `YOIZEN_TENANT` | `acme` | Tenant id |
| `YOIZEN_EMAIL` | `yclawd@demo.io` | Login email (dev seed admin) |
| `YOIZEN_PASSWORD` | `admin123` | Login password |
| `MCP_SERVER_NAME` | `sample-mcp-server` | MCP server name |
| `MCP_SERVER_URL` | `https://mcp.example.com/mcp` | Fake/example endpoint |
| `MCP_AUTH_TOKEN` | `sample-bearer-token` | Bearer token in `authConfig.token` |
| `MCP_SAMPLE_TOOLS` | `search,lookup` | Comma-separated hardcoded tool names enabled per-agent |
| `MCP_TOOL_DESCRIPTION_OVERRIDE` | (built-in text) | Override text for the first tool in `MCP_SAMPLE_TOOLS` |
| `MCP_AGENT_NAME` | `mcp-connections-demo-agent` | Demo agent name |
| `MCP_WORKFLOW_NAME` | `mcp-connections-demo` | Demo workflow name |
| `MCP_APPLICATION` | `samples` | Workflow's `application` field |

## SDK surface demonstrated

Verified directly against `sdk/src/resources/mcp-servers/`, `sdk/src/resources/agents/`, and
`sdk/src/resources/workflows/`:

- `client.mcpServers.create(input)` — `authType`/`authConfig` are **camelCase** on the wire
  (not `auth_type`/`auth_config` as an earlier design draft assumed).
- `client.mcpServers.testConnection(id)` — `POST admin/mcp-servers/:id/test`, no request body,
  no persistence side-effect; returns `{ success, latencyMs, toolCount?, error? }`.
- `client.mcpServers.listTools(id)` — `GET admin/mcp-servers/:id/tools`, live `tools/list`
  probe; returns `{ name, description, inputSchema }[]`.
- `client.agents.updateEnabledMcpTools(id, { enabled_mcp_tools })` — `PATCH
  admin/agents/:id/mcp-tools`; `enabled_mcp_tools` is `Record<serverName, string[] | null>`,
  keyed by **MCP server name**, not id. `null` means "all tools enabled" for that server.
- `client.agents.updateToolDescriptionOverrides(id, { tool_description_overrides })` — accepts
  `"<serverName>:<toolName>"` keys for MCP tools, alongside its existing plain-name keys for
  adapter/builtin tools.
- `client.workflows.create(input)` with one action built from the `McpCallAction` helper type
  (`{ name, activity: "mcpCall", args: { serverId, toolName, params? } }`), assignable to the
  looser `WorkflowAction` the base workflow type uses.

**Feature flag note**: per-tool MCP filtering is gated server-side by
`AGENT_MCP_TOOL_FILTERING_ENABLED` (default off, per `DOCS/architecture/mcp-connections.md`
§4). This sample's `updateEnabledMcpTools` call is expected to succeed and persist regardless
— the flag only affects whether `agent-ai-service` applies the filter at runtime, not whether
the SDK/API accepts the write.

## Known SDK gaps found while building this sample

- `sdk/src/resources/mcp-servers/index.ts` does not re-export `McpServerTestConnectionResult` —
  callers can still use `testConnection()`'s return value via inference, just not import the
  type by name from the `mcp-servers` subpath.
- `sdk/src/resources/agents/index.ts` does not re-export `UpdateEnabledMcpToolsInput` (defined
  in `agents/types.ts`, used by `AgentsClient.updateEnabledMcpTools`'s signature, but missing
  from the barrel export) — this sample passes an inline object literal to
  `updateEnabledMcpTools` instead of importing the type.

## Troubleshooting

- **`Login failed`** — check `YOIZEN_EMAIL` / `YOIZEN_PASSWORD` / `YOIZEN_TENANT` and that the
  gateway is reachable at `YOIZEN_BASE_URL`.
- **`testConnection`/`listTools` warnings** — expected. The MCP server URL is fake by design;
  point `MCP_SERVER_URL` at a real reachable MCP server (egress-reachable from inside the
  cluster) to see a real success result.
- **`updateEnabledMcpTools` succeeds but has no runtime effect** — check whether
  `AGENT_MCP_TOOL_FILTERING_ENABLED` is enabled server-side; the write always persists, but the
  filter is only *applied* when the flag is on.
