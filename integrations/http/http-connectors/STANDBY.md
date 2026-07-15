# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**Connector `endpoints` (and non-bearer `authType`s) have no manifest v1 representation.** Each of
the 5 connectors registers a set of endpoints that workflows call via `endpointCall`:

- `src/setup.ts:205` — `client.connectors.addEndpoint(id, ep)` per declared endpoint
  (`connectors/*.json` each carry 2–11 `endpoints`; e.g. `httpbin.json` has 11).
- `httpbin-basic-auth.json` also needs `authType: "basic"` with `basicUsername`/`basicPassword`.

The manifest `connectorSchema` has only `name`/`type`/`config`/`secretRef` — no `endpoints`
concept anywhere in the schema — and the apply engine's connectors-writer never calls
`addEndpoint`; it reads only `config.baseUrl`/`config.context` and drops everything else
(`services/provisioning-service/src/modules/apply/infrastructure/connectors-writer.ts:55-73`). A
migrated connector would be a bare shell with zero working endpoints (and no basic-auth), so the
sample's HTTP connector catalog could not be exercised.

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds connector `endpoints` (and full `authType`/
`authConfig`) to manifest v1 (schema + resolver/planner + apply engine + SDK + CLI). See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
