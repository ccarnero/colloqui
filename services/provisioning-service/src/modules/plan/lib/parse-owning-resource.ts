// Recovers "which manifest resource owns this ref occurrence" from the
// dot/bracket `path` produced by `@yoizen/shared`'s `collectSymbolicRefs`
// (e.g. `spec.workflows[2].definition.steps[0].serviceRef`).
//
// Pure string parsing — no manifest lookups here, callers resolve the index
// against the manifest themselves.

import type { ResourceKind } from "../domain/plan.interfaces";

const SECTION_TO_KIND: Readonly<Record<string, ResourceKind>> = {
  channels: "channel",
  connectors: "connector",
  agents: "agent",
  services: "service",
  workflows: "workflow",
};

const OWNING_RESOURCE_PATH_RE =
  /^spec\.(channels|connectors|agents|services|workflows)\[(\d+)\]/;

export interface OwningResourceLocation {
  readonly kind: ResourceKind;
  readonly index: number;
}

/** Returns `null` for occurrences that do not sit under a resource section (should not happen for valid manifests). */
export function parseOwningResource(
  path: string
): OwningResourceLocation | null {
  const match = OWNING_RESOURCE_PATH_RE.exec(path);
  if (!match) {
    return null;
  }
  const section = match[1];
  const index = Number.parseInt(match[2], 10);
  const kind = SECTION_TO_KIND[section];
  if (!kind) {
    return null;
  }
  return { kind, index };
}
