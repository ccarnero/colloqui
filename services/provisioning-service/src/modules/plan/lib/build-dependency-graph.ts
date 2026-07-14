// Builds the "requires" dependency graph over manifest resources: an edge
// `owning -> target` means `owning` must be created/updated AFTER `target`.
//
// Reuses `@yoizen/shared`'s `collectSymbolicRefs` (T01) over the WHOLE
// `manifest.spec` in one pass — this uniformly picks up every
// channelRef/agentRef/serviceRef occurrence regardless of which section or
// how deeply nested it is (channel/connector `config`, agent `profile`, and
// workflow `definition` are all arbitrary records that MAY embed refs).
//
// `secretRef` occurrences are intentionally skipped here — they are not
// section resources for ordering purposes, see `gatherSecretReferences`.

import type { IntegrationManifest } from "@yoizen/shared";
import { collectSymbolicRefs } from "@yoizen/shared";
import { listManifestResources } from "./list-manifest-resources";
import { manifestResourceNameAt } from "./manifest-resource-name-at";
import { parseOwningResource } from "./parse-owning-resource";
import { resourceKindOfRefType } from "./resource-kind-of-ref-type";
import { resourceNodeKey } from "./resource-node-key";

/** node key -> set of node keys it requires (must be ordered before it). */
export type DependencyGraph = ReadonlyMap<string, ReadonlySet<string>>;

export function buildDependencyGraph(
  manifest: IntegrationManifest
): DependencyGraph {
  const graph = new Map<string, Set<string>>();
  const resources = listManifestResources(manifest);

  // Every declared resource is a node, even with no outgoing edges.
  for (const entry of resources) {
    graph.set(resourceNodeKey(entry.kind, entry.name), new Set());
  }

  const occurrences = collectSymbolicRefs(manifest.spec, "spec");
  for (const occurrence of occurrences) {
    const targetKind = resourceKindOfRefType(occurrence.refType);
    if (!targetKind) {
      continue; // secretRef — not a dependency-graph edge
    }
    const owningLocation = parseOwningResource(occurrence.path);
    if (!owningLocation) {
      continue;
    }
    const owningName = manifestResourceNameAt(
      manifest,
      owningLocation.kind,
      owningLocation.index
    );
    if (!owningName) {
      continue;
    }

    const owningKey = resourceNodeKey(owningLocation.kind, owningName);
    const targetKey = resourceNodeKey(targetKind, occurrence.value);

    // Self-references (a resource pointing at itself by name) are not
    // meaningful dependency edges.
    if (owningKey === targetKey) {
      continue;
    }

    const edges = graph.get(owningKey);
    if (edges) {
      edges.add(targetKey);
    }
  }

  return graph;
}
