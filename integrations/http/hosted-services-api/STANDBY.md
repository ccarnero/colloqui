# STAND-BY — not manifest-migrated (manifest v1 gap)

This sample keeps its imperative setup scripts (`setup.sh`, `src/setup.ts`) UNTOUCHED. It is
**not** migrated to a declarative `manifest.yaml` because its provisioned end-state cannot be
expressed in the `IntegrationManifest` v1 schema
(`packages/shared/src/provisioning/manifest.schema.ts`).

## Why (specific gap)

**Service scaling fields and HTTP routes are absent from manifest v1.** The sample creates a hosted
service with scaling knobs and a routed path:

- `src/setup.ts:201-206` — service fields `port`, `minScale`, `maxScale`, `concurrencyTarget`,
  `envVars`.
- routes with `pathPrefix`/`methods`/`isPublic`/`stripPrefix` (`client.registry.routes.create`).

The manifest `serviceSchema` is a **reference only** — `name` + exactly one of `image`/`buildRef`
+ `env` (`packages/shared/src/provisioning/manifest.schema.ts:180-202`). It has no
`port`/`minScale`/`maxScale`/`concurrencyTarget` fields, and there is no route/HTTP-routing concept
anywhere in the schema. This sample's actual provisioned state (scaling + a routed path) therefore
cannot be declared. (A distinct gap kind from the MCP/system-variables missing sections: it is
missing fields on an existing section plus a whole routing concept — flagged in the T01 audit.)

## When it migrates

When `manual-loops/provisioning-manifest-gaps.md` adds service scaling fields and an HTTP-routing
concept to manifest v1 (schema + resolver/planner + apply engine + SDK + CLI). See
[`manual-loops/provisioning-manifest-gaps.md`](../../../manual-loops/provisioning-manifest-gaps.md).
