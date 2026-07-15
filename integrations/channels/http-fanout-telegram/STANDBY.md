# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**Manifest-time id substitution missing.** The workflow bakes literal, runtime-resolved connector
`adapterId`s into `endpointCall` actions and a literal Telegram account id + chat id into the
`channelSend` action:

- `src/setup.ts:304,312,322,335` — `adapterId: jpId | pokeId | catId | httpbinId` (real
  connector-admin ids resolved at run time from the cross-sample `http-connectors` connectors).
- `src/setup.ts:349` — `accountId: TG_ACCOUNT_ID` (a resolved Telegram account id).

Manifest v1 has no `connectorRef` symbolic-ref kind, and the apply engine sends workflow
`definition` to workflow-service **verbatim** — it does not substitute real ids for symbolic refs
(`services/provisioning-service/src/modules/apply/infrastructure/workflows-writer.ts`;
`scripts/e2e-manifest-showcase-driver.ts` header: "real-id substitution is a known follow-up").
`connector-runtime` requires a real `adapterId` to resolve an endpoint call
(`services/connector-runtime/src/lib/endpoint-call-core/execute-with-adapter-base.ts`), so a
manifest could not produce a working fanout workflow.

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` extends manifest v1 with manifest-time id
substitution of symbolic refs into workflow definitions (and a `connectorRef` kind). See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
