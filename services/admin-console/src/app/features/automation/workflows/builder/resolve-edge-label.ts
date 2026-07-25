import type { IWorkflowConnection } from "../domain/workflow-node.types";

/**
 * Resolves the display text for a connection's edge label chip (SPEC
 * console-redesign-builder-v2 T04).
 *
 * Only ever surfaces real metadata already present on the connection:
 * `IWorkflowConnection.label`, populated by `flow-deserializer.ts` for
 * conditional/branch fan-out edges (the branch's own path name, its
 * condition text, or the literal `"default"` for the default path — see
 * `flow-deserializer.ts` `conditionEdgeLabel()` / `deserializeChain()`).
 * Never fabricates a label: a connection with no label metadata (a plain
 * linear edge, or an empty-path branch->converge edge) resolves to an
 * empty string, so the caller renders nothing for it.
 */
export function resolveEdgeLabel(connection: IWorkflowConnection): string {
  return connection.label ?? "";
}
