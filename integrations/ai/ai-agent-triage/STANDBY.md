# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (two specific gaps)

1. **Connector `authConfig` is unreachable through manifest v1.** The sample creates an LLM
   connector carrying the provider API key as auth material
   (`src/setup.ts:437` sets `connectorId` on the agent; the connector is created with
   `authConfig: { bearerToken: apiKey }` around `src/setup.ts:394-437`). The apply engine's
   connectors-writer either fails on `secretRef` or drops `authConfig` entirely
   (`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:41-73`),
   so a migrated connector would have no credentials.

2. **Manifest-time id substitution missing.** The workflow bakes a literal agent id into its
   `agentCall` action: `src/setup.ts:875` — `agentId,` (the created agent's real id). The apply
   engine sends workflow `definition` verbatim without substituting real ids for symbolic refs
   (`services/provisioning-service/src/modules/apply/infrastructure/workflows-writer.ts`), and
   there is no `agentRef`-in-action substitution, so the workflow could not call the agent.

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds (a) connector credential wiring and
(b) manifest-time id substitution of symbolic refs into workflow definitions. See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
