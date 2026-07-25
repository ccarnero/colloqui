import type { IWorkflowConnection } from "../domain/workflow-node.types";

export type EdgeVisualState = "active" | "default";

/**
 * Classifies a connection's edge styling (SPEC console-redesign-builder-v2
 * T04), ported from `builder-v2-reference/canvas-layout.css`: the mock has
 * exactly two edge visual states —
 *
 * - `"active"`: accent-colored, dashed, animated (marching ants). Used for
 *   plain linear edges and for a matched/taken conditional or branch path.
 * - `"default"`: dim, solid, no animation. Used only for the conditional's
 *   literal default/fallback path.
 *
 * Classification is driven purely by the connection's own real `label`
 * field (never inferred from node type or position) — the mock's "default"
 * edge is always the one carrying the literal `"default"` label produced by
 * `flow-deserializer.ts`.
 */
export function resolveEdgeVisualState(
  connection: IWorkflowConnection
): EdgeVisualState {
  return connection.label === "default" ? "default" : "active";
}
