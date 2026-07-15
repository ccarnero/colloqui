# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**Connector `authConfig` is unreachable through manifest v1.** The sample (in the default
`connector` credential mode) creates an LLM connector carrying the provider API key as auth
material:

- `src/setup.ts:242-245` — connector `authConfig: { bearerToken: apiKey }`.

The apply engine's connectors-writer cannot carry that credential either way:

- a connector with a `secretRef` **fails loud** with `secret_not_resolvable`
  (`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:41-53` —
  broker auth wiring is an out-of-scope follow-up);
- a connector without a `secretRef` has only `config.baseUrl` and `config.context` read; any
  `authConfig`/`authType` key is silently dropped (same file, `:55-73`).

So a migrated connector would have **no credentials**, changing the sample's end-state. (This was
recorded as a decision-7 "credential flag" in the T01 audit, but it is a hard capability gap, not a
mechanism choice — verified in code.)

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds connector credential wiring (broker
`secretRef` resolution AND inline `authConfig` passthrough) to the apply engine. See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
