# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**No `mcpServers` section in manifest v1.** The sample provisions an MCP server:

- `src/setup.ts:247` — `client.mcpServers.create(body)`
- `src/setup.ts:238` — `client.mcpServers.update(...)`
- also `list`/`remove`/`testConnection`/`listTools` (`src/setup.ts:164,211,263,287`).

The manifest v1 spec has only `channels`, `connectors`, `agents`, `knowledgeBases`, `services`,
`workflows`, `secrets` (`packages/shared/src/provisioning/manifest.schema.ts`) — there is no
`mcpServers` section, so this resource kind cannot be declared at all. (Anticipated in the SPEC's
decision 6.) The MCP server's `authConfig: { token: MCP_AUTH_TOKEN }` (a decision-7 credential
flag) is moot while the whole section is missing.

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds an `mcpServers` section to manifest v1
(schema + resolver/planner + apply engine + SDK + CLI). See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
