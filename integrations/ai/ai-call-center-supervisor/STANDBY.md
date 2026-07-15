# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (two specific gaps)

1. **Connector `authConfig` is unreachable through manifest v1.** The sample creates an LLM
   connector carrying the provider API key: `src/setup.ts:545` — `authConfig: { bearerToken: apiKey }`.
   The apply engine's connectors-writer either fails on `secretRef` or drops `authConfig` entirely
   (`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:41-73`),
   so a migrated connector would have no credentials.

2. **Manifest-time id substitution missing.** The workflow's `agentCall` action targets the created
   agent by its real id (`agentId` = `src/setup.ts:640`), embedded in the workflow definition. The
   apply engine sends workflow `definition` verbatim without substituting real ids for symbolic
   refs (`services/provisioning-service/src/modules/apply/infrastructure/workflows-writer.ts`), so
   the supervisor workflow could not call the agent.

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds (a) connector credential wiring and
(b) manifest-time id substitution of symbolic refs into workflow definitions. See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
