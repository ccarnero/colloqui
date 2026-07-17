# mcp-connections

Demonstrates the **MCP Connections** feature end to end: an MCP server with typed auth, an agent
with per-tool enablement (plus a description override), and a workflow with one `mcpCall` action.
This is the MCP counterpart to [`http-connectors`](../../http/http-connectors) (which does the
same for outbound HTTP adapters). Provisioning is **declarative**: a single
[`manifest.yaml`](./manifest.yaml) applied through the `yoizen` CLI (no setup scripts) — the
platform's first REAL, migratable MCP canary.

```
manifest.yaml ─► yoizen manifests apply ─► agent-admin-service (mcp server, agent, workflow)

workflow mcpCall(serverId, toolName, params) ─► agent-ai-service ─► the MCP server
```

## Kind decision (`kind: LibraryManifest`)

This manifest provisions an `mcpServer` + an `agent` + a `workflow` — a PROCESS exists (agents/
workflows), but there is **no channel account** anywhere. An `IntegrationManifest` unconditionally
requires >=1 inbound channel — `kind: LibraryManifest` waives that (and the >=1-process check)
and instead requires >=1 of connector/mcpServer/service/systemVariable, satisfied here by the
`mcpServer`. T01's ruling explicitly **permits** mixed library manifests (library resources
alongside agents/workflows) — the waiver is additive, not a prohibition. Verified locally against
`integrationManifestSchema.safeParse` + `validateManifestStructuralRules` before this manifest was
committed — see the manifest's own header comment and this batch's migration report.

## What `manifest.yaml` provisions

| Resource | Name | Notes |
| --- | --- | --- |
| MCP server | `sample-mcp-server` | `transport_type: http`, `authType: bearer` via `secretRef`, pointed at a **fake/example** URL (`https://mcp.example.com/mcp`) |
| Agent | `mcp-connections-demo-agent` | `enabledMcpTools: { sample-mcp-server: [search, lookup] }` + one `toolDescriptionOverrides` entry (`sample-mcp-server:search`) |
| Workflow | `mcp-connections-demo` | One `mcpCall` action, `serverId: { mcpServerRef: sample-mcp-server }` — no trigger, kept intentionally minimal |

The MCP server URL is **intentionally fake** — this sample's job is to demonstrate the manifest/
SDK shapes (`auth`, `testConnection`, `listTools`, `enabledMcpTools`, `toolDescriptionOverrides`,
and the workflow's `mcpCall` action), not to reach a real live MCP integration. `testConnection`
and `listTools` are expected to fail or return empty against this fake endpoint.

## Secrets (MCP server bearer auth)

The deleted `setup.ts` read `MCP_AUTH_TOKEN` with a fallback literal `"sample-bearer-token"` when
unset — a placeholder for a fake endpoint, but still a literal value, and manifest v1's `auth`
block is `secretRef`-only by schema (no plaintext escape hatch). The manifest expresses
`authType: bearer` with a nested `secretRef` (`mcp-connections-bearer-token`) instead:

| Binding name (= env var for `--secrets-from-env`) | Targets | Value |
| --- | --- | --- |
| `mcp-connections-bearer-token` | `authConfig.token` | ANY non-empty string — the endpoint is fake and never actually authenticates |

## Prerequisites

- A running dev cluster with a provisioned tenant (`acme` by default).
- The `yoizen` CLI (`cd sdk && bun link`, or `cd sdk && bun run bin/yoizen.ts ...`).
- CLI environment: `YOIZEN_BASE_URL`, `YOIZEN_HOST_HEADER`, `YOIZEN_TENANT`, `YOIZEN_EMAIL`,
  `YOIZEN_PASSWORD` — same as every other sample.
- No real MCP server or Telegram account needed — this sample is self-contained.

## Provision (declarative)

```bash
cd sdk && bun link   # one-time; or prefix each call with `bun run bin/yoizen.ts`

yoizen manifests validate -f ../integrations/mcp/mcp-connections/manifest.yaml
yoizen manifests plan     -f ../integrations/mcp/mcp-connections/manifest.yaml
env 'mcp-connections-bearer-token=any-non-empty-value' \
  yoizen manifests apply  -f ../integrations/mcp/mcp-connections/manifest.yaml --secrets-from-env
```

A second `apply` is a no-op once converged.

## Run / verify

```bash
cd integrations/mcp/mcp-connections
./run.sh
```

`run.sh` (`src/index.ts`) is **read-only**: it confirms the MCP server, agent, and workflow all
exist; best-effort probes `testConnection()`/`listTools()` (expected to warn — fake endpoint);
and prints the agent's `enabled_mcp_tools`/`tool_description_overrides`. It never creates or
modifies platform objects, and never executes the workflow or agent — the MCP server url is
fake/unreachable by design.

## What each manifest section demonstrates

- **`mcpServers[].auth`** — typed `authType`/`authConfig`, secretRef-only (T01/T06 decision 3),
  mirrored field-for-field from `mcpServerAuthSchema`.
- **`agents[].enabledMcpTools`** — per-tool allowlist scoped to one MCP server, keyed by server
  NAME (never substituted to an id — decision 6, same precedent as `enabledMcpServerRefs`).
- **`agents[].toolDescriptionOverrides`** — `"<serverName>:<toolName>"` keys for MCP tools,
  reconciled via a dedicated PATCH after the agent itself is created/resolved.
- **`workflows[].definition` `mcpCall` action** — `serverId: { mcpServerRef: <name> }`, the ONLY
  place `mcpServerRef` participates in manifest-time name->id substitution (T06's
  `SUBSTITUTION_ALLOWLIST`).

## Troubleshooting

- **`updateEnabledMcpTools` persists but has no runtime effect** — check whether
  `AGENT_MCP_TOOL_FILTERING_ENABLED` is enabled server-side on `agent-ai-service`; the write
  always persists, the flag only controls whether it's *applied* at runtime.
- **`tool_description_overrides` skipped with a warning during apply** — gated server-side by
  `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` on `agent-admin-service`. A disabled flag is a valid
  platform state; `agents-writer.ts` treats it as a skip, not a failure.
- **Want a REAL MCP integration instead of the fake endpoint?** Edit `manifest.yaml`'s `url` to a
  public, egress-reachable MCP server (the platform's SSRF guard blocks localhost/RFC1918 URLs)
  and re-`apply` — `testConnection`/`listTools` will then report real results.
