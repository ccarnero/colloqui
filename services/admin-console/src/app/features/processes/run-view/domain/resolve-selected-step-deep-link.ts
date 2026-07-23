// resolve-selected-step-deep-link.ts — maps the trace screen's shared
// `TraceSelectionService.selectedEventId()` back onto the run's OWN
// `ILayoutNode`, then resolves that node's "Open <entity>" deep link via
// `resolveStepDeepLink` (T06 of
// manual-loops/admin-console/console-redesign-trace.md). Same event -> node
// resolution as `resolve-selected-step-result.ts` (reused, not
// re-derived) — this module is its "deep link" sibling, one extra step
// past the step-result lookup.
//
// GROUNDING (T01 finding 4): this resolves an ENTITY route
// (`/connections/http/:id` or `/ai/agents/:id`, via
// `resolve-entity-deep-link.ts`), never a BUILDER route — no
// trace-event/run-step -> builder-canvas-node id bridge exists anywhere in
// the codebase (T01 finding item 3/4). Do not read this function's non-null
// result as "the builder link" — it is the same connector/agent entity link
// the causal-graph inspector content already renders, now also available
// for run-mode selections.
import type { IRunEvent } from "../../../../core/services/run-view.service";
import type { IEntityDeepLink } from "../../domain/resolve-entity-deep-link";
import { resolveStepDeepLink } from "./resolve-step-deep-link";
import { resolveStepEvents } from "./resolve-step-events";
import type { ILayoutNode } from "./run-view.model";

/**
 * Finds the `ILayoutNode` whose OWN `started`/`completed` event matches
 * `selectedEventId` (same resolution `resolveSelectedStepResult` uses) and
 * returns its "Open <entity>" deep link. `null` when nothing is selected,
 * the selection isn't one of this run's own step events, or the matched
 * node/step doesn't resolve to a connector/agent entity (structural nodes,
 * not-executed steps) — same "hidden, never a broken link" contract as
 * `resolveStepDeepLink` itself.
 */
export function resolveSelectedStepDeepLink(
  nodes: readonly ILayoutNode[],
  events: readonly IRunEvent[],
  selectedEventId: string | null
): IEntityDeepLink | null {
  if (!selectedEventId) {
    return null;
  }
  for (const node of nodes) {
    const pair = resolveStepEvents(node, events);
    if (
      pair.started?.eventId === selectedEventId ||
      pair.completed?.eventId === selectedEventId
    ) {
      return resolveStepDeepLink(node, events);
    }
  }
  return null;
}
