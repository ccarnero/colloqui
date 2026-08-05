import type { IWorkflowNodeStats } from "./workflow-node-stats.types";

/**
 * STATIC PLACEHOLDER footer stats (SPEC T03). The mock's node-card footer
 * row (`<n> runs` / secondary metric slot / `● ok` status) has no backing
 * per-node data source today — T01 finding 6 confirmed
 * `ITopDefinitionRow` is per-definition, not per-node (see
 * `manual-loops/admin-console/console-redesign-builder-v2.md`, T01 finding 6,
 * and `DOCS/archive/INDEX.md`, "Change: console redesign ai
 * (console-redesign-ai)"). T06 of this loop re-opens that data-gap; T07
 * wires the real fetch once it settles.
 *
 * This constant is the DEFAULT value of `WorkflowNodeCardComponent.stats` so
 * the footer row's STRUCTURE always renders (matching the mock's anatomy —
 * T01 finding 1), while its content is deliberately non-numeric dashes
 * rather than a fabricated count. T07 replaces this default at the call
 * site by passing a real `IWorkflowNodeStats` value once a genuine
 * aggregate exists; this file is not touched by that change.
 */
export const PLACEHOLDER_NODE_CARD_STATS: IWorkflowNodeStats = {
  primaryLabel: "— runs",
  secondaryLabel: "—",
  status: "ok",
};
