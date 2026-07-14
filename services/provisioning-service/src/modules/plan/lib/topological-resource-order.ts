// Orders manifest resources for the resolver: base rule is section order
// (channel → connector → agent → service → workflow), refined by explicit
// ref-graph dependencies (Kahn's algorithm on `buildDependencyGraph`'s
// "requires" edges). Detects cycles FIRST via `findCycle` — a cycle is a
// typed `CycleDetectedError`, never a hang.

import type { IntegrationManifest } from "@yoizen/shared";
import type {
  CycleDetectedError,
  ResourceKind,
} from "../domain/plan.interfaces";
import { RESOURCE_KIND_ORDER } from "../domain/plan.interfaces";
import { buildDependencyGraph } from "./build-dependency-graph";
import { findCycle } from "./find-cycle";
import { listManifestResources } from "./list-manifest-resources";
import { resourceNodeKey } from "./resource-node-key";

export interface OrderedResource {
  readonly kind: ResourceKind;
  readonly name: string;
}

export type TopologicalOrderResult =
  | { readonly ok: true; readonly value: OrderedResource[] }
  | { readonly ok: false; readonly error: CycleDetectedError };

export function computeResourceOrder(
  manifest: IntegrationManifest
): TopologicalOrderResult {
  const graph = buildDependencyGraph(manifest);

  const cycle = findCycle(graph);
  if (cycle) {
    return {
      ok: false,
      error: {
        kind: "cycle_detected",
        cycle,
        message: `Dependency cycle detected in manifest ref graph: ${cycle.join(" -> ")}`,
      },
    };
  }

  const resources = listManifestResources(manifest);
  const kindRank = new Map(
    RESOURCE_KIND_ORDER.map((kind, index) => [kind, index])
  );
  const nodeMeta = new Map<string, OrderedResource>(
    resources.map((entry) => [
      resourceNodeKey(entry.kind, entry.name),
      { kind: entry.kind, name: entry.name },
    ])
  );

  // in-degree = number of "requires" edges still unresolved (dependencies
  // not yet emitted into `order`).
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const node of graph.keys()) {
    inDegree.set(node, graph.get(node)?.size ?? 0);
    dependents.set(node, new Set());
  }
  for (const [node, requires] of graph.entries()) {
    for (const dep of requires) {
      dependents.get(dep)?.add(node);
    }
  }

  const rankOf = (node: string): number => {
    const meta = nodeMeta.get(node);
    return meta ? (kindRank.get(meta.kind) ?? 0) : 0;
  };
  const nameOf = (node: string): string => nodeMeta.get(node)?.name ?? "";
  const byPrecedence = (a: string, b: string): number => {
    const rankDiff = rankOf(a) - rankOf(b);
    return rankDiff !== 0 ? rankDiff : nameOf(a).localeCompare(nameOf(b));
  };

  const ready = [...graph.keys()]
    .filter((node) => (inDegree.get(node) ?? 0) === 0)
    .sort(byPrecedence);
  const order: OrderedResource[] = [];

  while (ready.length > 0) {
    const node = ready.shift();
    if (node === undefined) {
      break;
    }
    const meta = nodeMeta.get(node);
    if (meta) {
      order.push(meta);
    }
    for (const dependent of dependents.get(node) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort(byPrecedence);
      }
    }
  }

  return { ok: true, value: order };
}
