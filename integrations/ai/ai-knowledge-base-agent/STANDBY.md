# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**Connector `authConfig` is unreachable through manifest v1.** The connector + knowledge base +
agent shapes fit the schema sections individually, but the LLM connector carries the provider API
key as auth material — `src/setup.ts:301` sets `authConfig: { bearerToken: apiKey }` — and the
agent references that connector by id (`provider_connector_id`, `src/setup.ts:353`).

The apply engine's connectors-writer cannot carry that credential: a `secretRef` **fails loud**
with `secret_not_resolvable`, and without one any `authConfig`/`authType` key is silently dropped —
only `config.baseUrl`/`config.context` are read
(`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:41-73`). A
migrated connector would have no credentials, so the KB-backed agent could not reach its provider.

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds connector credential wiring (broker
`secretRef` resolution AND inline `authConfig` passthrough) to the apply engine. See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
