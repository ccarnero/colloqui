// Shared-resource guard (PENDIENTES/12-undeploy.spec.md decision 4): undeploy
// REFUSES to tear down a manifest whose owned resources another STORED
// manifest of the same tenant consumes as `external: true`. No `--force` in
// v1 — the caller must undeploy (or edit) the dependents first.
//
// What counts as a blocking reference:
//   - OWNED by the target manifest: a resource it declares WITHOUT
//     `external: true` (an `external` entry was never owned, so deleting the
//     manifest never removes it and nothing can be blocked on it).
//   - CONSUMED by another manifest: that manifest declares a resource of the
//     SAME kind and name WITH `external: true` — the manifest schema's only
//     way of saying "this resource exists, someone else provisions it, wire
//     me to it" (see `plan.interfaces.ts`'s `ResourcePlanEntry.external`).
//     Another manifest declaring the same name WITHOUT `external` is not a
//     consumer — it is a competing owner, which is a pre-existing authoring
//     conflict this guard deliberately does not adjudicate.
//
// Knowledge bases participate too (`knowledgeBaseSchema.external` exists and
// an agent in another manifest can consume a KB provisioned here), so they
// are scanned alongside the eight `ResourceKind` sections.
//
// Pure function over already-loaded manifests — the I/O (listing the
// tenant's stored manifests) belongs to `undeploy.service.ts`.

import type { IntegrationManifest } from "@yoizen/shared";
import { listManifestResources } from "../../plan/lib/list-manifest-resources";
import type {
  BlockingReference,
  UndeployResourceKind,
} from "../domain/undeploy.interfaces";

interface ScannedResource {
  readonly kind: UndeployResourceKind;
  readonly name: string;
  readonly external: boolean;
}

/** Every declared resource of a manifest, knowledge bases included. */
function scanResources(manifest: IntegrationManifest): ScannedResource[] {
  const resources: ScannedResource[] = listManifestResources(manifest).map(
    (entry) => ({
      kind: entry.kind,
      name: entry.name,
      external: entry.external,
    })
  );
  for (const kb of manifest.spec.knowledgeBases) {
    resources.push({
      kind: "knowledgeBase",
      name: kb.name,
      external: kb.external ?? false,
    });
  }
  return resources;
}

export function findBlockingReferences(
  target: IntegrationManifest,
  otherManifests: readonly IntegrationManifest[]
): BlockingReference[] {
  const ownedKeys = new Set(
    scanResources(target)
      .filter((resource) => !resource.external)
      .map((resource) => `${resource.kind}:${resource.name}`)
  );

  const blockers: BlockingReference[] = [];
  for (const other of otherManifests) {
    // A stored copy of the manifest being undeployed can never block itself.
    if (other.metadata.name === target.metadata.name) {
      continue;
    }
    for (const resource of scanResources(other)) {
      if (!resource.external) {
        continue;
      }
      if (!ownedKeys.has(`${resource.kind}:${resource.name}`)) {
        continue;
      }
      blockers.push({
        manifestName: other.metadata.name,
        resourceKind: resource.kind,
        resourceName: resource.name,
      });
    }
  }
  return blockers;
}
