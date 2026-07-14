// Collects every distinct `secretRef` occurrence in the manifest (channel/
// connector `secretRef`, service `env[].secretRef`, and any `secretRef` found
// while walking workflow `definition`), keeping the FIRST owning resource per
// secret name for a deterministic, single precondition entry per secret.
//
// Reuses the same `collectSymbolicRefs` pass `buildDependencyGraph` uses —
// see that file's comment for why walking the whole `manifest.spec` in one
// shot is correct here.

import type { IntegrationManifest } from "@yoizen/shared";
import { collectSymbolicRefs } from "@yoizen/shared";
import type { ResourceKind } from "../domain/plan.interfaces";
import { manifestResourceNameAt } from "./manifest-resource-name-at";
import { parseOwningResource } from "./parse-owning-resource";

export interface SecretReference {
  readonly secretName: string;
  readonly owningKind: ResourceKind;
  readonly owningName: string;
}

export function gatherSecretReferences(
  manifest: IntegrationManifest
): SecretReference[] {
  const occurrences = collectSymbolicRefs(manifest.spec, "spec");
  const seen = new Map<string, SecretReference>();

  for (const occurrence of occurrences) {
    if (occurrence.refType !== "secretRef") {
      continue;
    }
    if (seen.has(occurrence.value)) {
      continue;
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
    seen.set(occurrence.value, {
      secretName: occurrence.value,
      owningKind: owningLocation.kind,
      owningName,
    });
  }

  return [...seen.values()];
}
