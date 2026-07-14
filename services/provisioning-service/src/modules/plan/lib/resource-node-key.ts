// Node identity for the ref-dependency graph: `"<kind>:<name>"`.

import type { ResourceKind } from "../domain/plan.interfaces";

export function resourceNodeKey(kind: ResourceKind, name: string): string {
  return `${kind}:${name}`;
}
