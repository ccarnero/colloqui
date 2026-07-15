# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gaps)

1. **No `mcpServers` section in manifest v1.** The sample provisions an MCP server:
   - `src/setup.ts:528` — `client.mcpServers.create(body)`
   - `src/setup.ts:519` — `client.mcpServers.update(...)`
   - also `list`/`remove` (`src/setup.ts:445,493`).

   The manifest v1 spec has only `channels`, `connectors`, `agents`, `knowledgeBases`, `services`,
   `workflows`, `secrets` (`packages/shared/src/provisioning/manifest.schema.ts`) — there is no
   `mcpServers` section, so this resource kind cannot be declared at all. (Anticipated in the
   SPEC's decision 6.)

2. **Manifest-time id substitution missing** (secondary). The sample also creates an agent + a
   workflow that wires the agent by real id; even setting the MCP gap aside, the workflow could not
   be expressed because the apply engine sends workflow `definition` verbatim without substituting
   real ids for symbolic refs
   (`services/provisioning-service/src/modules/apply/infrastructure/workflows-writer.ts`).

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds an `mcpServers` section and manifest-time id
substitution to manifest v1 (schema + resolver/planner + apply engine + SDK + CLI). See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
