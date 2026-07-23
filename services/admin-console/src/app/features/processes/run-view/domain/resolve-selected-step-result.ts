// resolve-selected-step-result.ts — maps the trace screen's shared
// `TraceSelectionService.selectedEventId()` back onto the run's OWN
// `ILayoutNode`, producing the "step result" summary the inspector's
// run-mode content renders (T05 of
// manual-loops/admin-console/console-redesign-trace.md, decision 3: "step
// result in run view"). Pure function, no Angular/DOM — same split as
// `resolve-step-events.ts` (that module maps node -> event; this one is
// its inverse, event -> node, reusing the SAME per-node resolution rather
// than deriving a second heuristic).
//
// Real fields only (SPEC.md "nothing invented"): every field below is a
// verbatim `ILayoutNode` field the domain layer already computed
// (`layout-run.ts`) — no synthesized status/label.

import type { IRunEvent } from "../../../../core/services/run-view.service";
import { resolveStepEvents } from "./resolve-step-events";
import type {
  ActionStatus,
  ILayoutNode,
  LayoutNodeKind,
} from "./run-view.model";

/** Trimmed, inspector-facing view of the matched `ILayoutNode` — real
 * fields only, passed through verbatim from the layout node the selected
 * event resolved to. */
export interface IRunStepResult {
  readonly nodeId: string;
  readonly stepName: string;
  readonly kind: LayoutNodeKind;
  readonly actionType: string | null;
  readonly status: ActionStatus;
  readonly durationMs: number | null;
  readonly branchTaken: string | null;
  readonly evaluatedValue: string | null;
  readonly instanceId: string | null;
}

function toStepResult(node: ILayoutNode): IRunStepResult {
  return {
    nodeId: node.id,
    stepName: node.stepName,
    kind: node.kind,
    actionType: node.actionType,
    status: node.status,
    durationMs: node.durationMs,
    branchTaken: node.branchTaken,
    evaluatedValue: node.evaluatedValue,
    instanceId: node.instanceId,
  };
}

/**
 * Finds the `ILayoutNode` whose OWN `started`/`completed` event
 * (`resolveStepEvents`, same resolution `onNodeClick`'s select-on-click
 * path uses) matches `selectedEventId`, and returns its step-result
 * summary. `null` when nothing is selected, or the selection came from a
 * different view's event (not one of this run's own step events — the
 * inspector simply shows no run-mode content in that case, per SPEC.md
 * "nothing invented").
 */
export function resolveSelectedStepResult(
  nodes: readonly ILayoutNode[],
  events: readonly IRunEvent[],
  selectedEventId: string | null
): IRunStepResult | null {
  if (!selectedEventId) {
    return null;
  }
  for (const node of nodes) {
    const pair = resolveStepEvents(node, events);
    if (
      pair.started?.eventId === selectedEventId ||
      pair.completed?.eventId === selectedEventId
    ) {
      return toStepResult(node);
    }
  }
  return null;
}
