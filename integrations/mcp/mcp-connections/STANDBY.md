# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`), even after
`manual-loops/provisioning-manifest-gaps.md` T06 added the `mcpServers` section.

**Updated 2026-07-16 (T08 batch 2 evaluation)** — the original gap below (no `mcpServers`
section) is now CLOSED by T06. Re-evaluating for T08 surfaced two DIFFERENT, still-open blockers,
verified directly against source and by running `integrationManifestSchema.safeParse` +
`validateManifestStructuralRules` against a draft manifest expressing this sample's default
end-state:

## Why (current gaps)

### 1. Structural rule blocks a channel-less manifest (same class of issue as `http-connectors`)

This sample provisions an MCP server, an agent, and a workflow — **no channel account at all**.
`validate-structural-rules.ts`'s `checkAtLeastOneInboundChannel` requires **every** manifest to
declare at least one channel with `direction: inbound`, unconditionally — the same rule
(`checkAtLeastOneInboundChannel`/`checkAtLeastOneProcess`) that already blocked
[`http-connectors`](../../http/http-connectors)' migration in T08 batch 1 (see that batch's
progress entry in `manual-loops/provisioning-manifest-gaps.md`). Verified empirically: a draft
manifest expressing this sample's mcpServer + agent + workflow (schema-valid,
`integrationManifestSchema.safeParse(...).success === true`) fails
`validateManifestStructuralRules` with exactly:

```
spec.channels: manifest must declare at least one channel with direction: inbound
```

Adding a channel not part of this sample's actual provisioned end-state (setup.ts creates none)
would NOT be a faithful migration — it would invent a resource the imperative script never
creates. This is a SEVENTH constraint outside the six shipped gaps, same open item T08 batch 1
already flagged for `http-connectors` — needs the same human ruling (relax the rule for
channel-less "process-only" manifests, or a different manifest shape for MCP/agent-only samples).

### 2. Per-tool MCP enablement + description overrides have no manifest expression (independent of #1)

Even setting #1 aside, `src/setup.ts`'s default end-state for the demo agent includes TWO fields
the manifest cannot express at all:

- `client.agents.updateEnabledMcpTools(agentId, { enabled_mcp_tools: { "<serverName>": [...] } })`
  (`src/setup.ts:352-358`) — per-tool allowlisting within an MCP server, not just server-level
  enablement.
- `client.agents.updateToolDescriptionOverrides(agentId, { tool_description_overrides: {...} })`
  (`src/setup.ts:372-374`).

`manifest.schema.ts`'s `agentSchema` (T06) only added `enabledMcpServerRefs` — a plain array of
MCP server NAMES, wired to agent-admin's `enabled_mcp_servers` (server-level, all-or-nothing per
server). There is no manifest field for `enabled_mcp_tools` or `tool_description_overrides`, and
`agents-writer.ts`'s `PASSTHROUGH_PROFILE_KEYS` is a hardcoded allowlist
(`description`/`system_prompt`/`model_config`/`tools`/`channels`/`input_variables`/
`output_variables`) that does not include either field — so `agent.profile` passthrough cannot
express them either, even as a workaround. A manifest for this sample would silently downgrade
the agent's default state from "search+lookup enabled, with a description override" to "all tools
on this server enabled, no override" — a real behavior change, not a faithful migration.

## When it migrates

- Gap 1 needs a human ruling on the `checkAtLeastOneInboundChannel` structural rule (same open
  item as `http-connectors`).
- Gap 2 needs a new manifest v1 section/field for per-tool MCP enablement and description
  overrides (a new gap kind, not one of the six T01-T06 shipped so far).

See [`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
