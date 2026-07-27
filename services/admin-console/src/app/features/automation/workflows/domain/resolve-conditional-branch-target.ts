import type { IWorkflowConnection, IWorkflowNode } from "./workflow-node.types";

export interface IBranchRouteTarget {
  readonly connectionKey: string;
  readonly node: IWorkflowNode;
}

/**
 * Resolves the node a conditional branch routes to, for the branch card's
 * "→ target" footer row (SPEC console-redesign-builder-v2 IF-editor task,
 * idea 3). Derived from the SAME flow state the canvas edges render from —
 * the connection whose `source` is this conditional node and whose `label`
 * equals the branch's own expression text (see `flow-deserializer.ts`
 * `conditionEdgeLabel()`, or the literal `"default"` for the default path).
 * Never fabricates a target: an empty-path branch (no actions, so
 * `flow-deserializer.ts` never links a connection for it) resolves to
 * `null`, and the caller renders nothing.
 *
 * `usedConnectionKeys` lets the caller avoid matching the same connection
 * twice when two sibling branches happen to share identical condition text
 * (an edge case; each branch still gets its OWN connection instance from
 * the deserializer, this just prevents a double-claim).
 */
export function resolveConditionalBranchTarget(
  sourceNodeKey: string,
  expectedLabel: string | undefined,
  connections: readonly IWorkflowConnection[],
  nodesByKey: Readonly<Record<string, IWorkflowNode>>,
  usedConnectionKeys: ReadonlySet<string> = new Set()
): IBranchRouteTarget | null {
  if (!expectedLabel) {
    return null;
  }
  const match = connections.find(
    (c) =>
      c.source === sourceNodeKey &&
      c.label === expectedLabel &&
      !usedConnectionKeys.has(c.key)
  );
  if (!match) {
    return null;
  }
  const node = nodesByKey[match.target];
  return node ? { connectionKey: match.key, node } : null;
}
