// Resolves the `name` of the resource declared at `index` within a given
// manifest section — shared by `buildDependencyGraph` and
// `gatherSecretReferences`, both of which parse a `ResourceKind` + section
// index out of a `collectSymbolicRefs` occurrence path.

import type { IntegrationManifest } from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";

export function manifestResourceNameAt(
  manifest: IntegrationManifest,
  kind: ResourceKind,
  index: number
): string | null {
  switch (kind) {
    case "channel":
      return manifest.spec.channels[index]?.name ?? null;
    case "connector":
      return manifest.spec.connectors[index]?.name ?? null;
    case "agent":
      return manifest.spec.agents[index]?.name ?? null;
    case "service":
      return manifest.spec.services[index]?.name ?? null;
    case "workflow":
      return manifest.spec.workflows[index]?.name ?? null;
    default:
      return null;
  }
}
