// resolve-builder-deep-link.ts — the BUILDER half of decision 4's "Temporal
// link + builder link", per the ORCHESTRATOR RULING 2026-07-22 in
// manual-loops/admin-console/console-redesign-trace.md: "the builder deep
// link is HIDDEN until a trace-event->builder-node id bridge exists
// (backend/builder follow-up — never synthesized)".
//
// GROUNDING (T01 finding 4, verified before writing this file — not a
// guess):
//   - No field on `ITrackedEvent`/`IRunEvent` identifies a builder-canvas
//     node (`core/services/tracking-chain.service.ts`,
//     `core/services/run-view.service.ts`).
//   - `ILayoutNode.id` (`run-view/domain/run-view.model.ts`) is a SYNTHETIC
//     id encoding `(branchPath, actionIndex)` WITHIN THE RUN'S OWN step
//     tree (`resolve-step-events.ts`'s `parseNodeId`) — never designed to
//     be, and is not, a builder-canvas node id.
//   - `workflow-builder.component.ts` accepts no node-focus route/query
//     param today (verified absent, not merely unchecked).
//   - Both existing deep-link paths that DO route through
//     `resolve-entity-deep-link.ts` (`causal-graph-deep-link.ts`,
//     `run-view/domain/resolve-step-deep-link.ts`) resolve CONNECTOR/AGENT
//     entity routes, never a builder route — confirmed by reading both
//     files, not assumed.
//
// This function exists so the inspector's rendering path (and its
// hidden-case test) are real code today, not a TODO comment — but it must
// return `null` unconditionally until a real id bridge ships. Backend/
// builder follow-up (out of scope for this console-only task): thread a
// builder-canvas node id onto tracked/run events, and add a node-focus
// route/query param to the workflow builder, THEN implement the real
// mapping here — never invent one in the meantime.
export interface IBuilderDeepLink {
  readonly route: readonly string[];
  readonly label: string;
}

/**
 * Always returns `null` today — see this file's header. Takes no
 * parameters (there is nothing real to resolve FROM yet); kept as a
 * function, not a constant `null`, so the call site and its "hidden"
 * console.debug read naturally once the bridge lands.
 */
export function resolveBuilderDeepLink(): IBuilderDeepLink | null {
  return null;
}
