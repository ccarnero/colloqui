# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**No `systemVariables` section in manifest v1.** The sample provisions tenant system variables:

- `src/setup.ts:287` — `client.systemVariables.list(...)`
- `src/setup.ts:306` — `client.systemVariables.update(...)`

The manifest v1 spec has only `channels`, `connectors`, `agents`, `knowledgeBases`, `services`,
`workflows`, `secrets` (`packages/shared/src/provisioning/manifest.schema.ts`) — there is no
`systemVariables` section, so this resource kind cannot be declared at all. (Anticipated in the
SPEC's decision 6.)

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds a `systemVariables` section to manifest v1
(schema + resolver/planner + apply engine + SDK + CLI). See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
