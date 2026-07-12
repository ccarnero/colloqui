// resolve-step-events.ts — ILayoutNode -> the run's OWN "started"/
// "completed" event refs (T05 of manual-loops/run-view.md: the popup's
// "events pair (started/completed ids/times from the run's events)" row).
// Pure function, no Angular/DOM.
//
// Two different identity strategies, because the underlying events carry
// different identity themselves:
// - `action`/`fork` nodes: `layoutRun`'s node `id` encodes
//   `(branchPath, actionIndex)` (`layout-run.ts`'s `nodeId` helper), and
//   `action_started`/`action_completed` events carry BOTH fields
//   (`payload_branch`/`payload_action_index`) unambiguously — so this
//   module reverses the `id` encoding and re-runs the SAME
//   `(branchPath, actionIndex)` match `merge-run.ts`'s `indexActionEvents`
//   uses. Safe to re-derive per click: the match is a pure function of
//   `(branchPath, actionIndex)`, no ordering/state involved.
// - `conditional` nodes: `condition_evaluated` events carry NO `branch`
//   field (see `merge-run.ts`'s `indexConditionEvents` header), so two
//   conditionals sharing the same local `actionIndex` (a root `if` and a
//   nested `if` both at position 1 — routine, not an edge case) can only
//   be disambiguated by the FIFO-in-tree-order consumption `merge-run.ts`
//   already performed once, correctly, while building the step tree. This
//   module does NOT re-derive that match — it reads the exact
//   `event_id` merge-run associated with the clicked node
//   (`ILayoutNode.conditionEventId`, threaded through from
//   `IConditionalStep.conditionEventId`) and looks it up by identity.

import type { IRunEvent } from "../../../../core/services/run-view.service";
import type { ILayoutNode } from "./run-view.model";

/** One matched event, trimmed to what the popup's events-pair row needs. */
export interface IStepEventRef {
  readonly eventId: string;
  readonly occurredAt: string;
}

export interface IStepEventPair {
  readonly started: IStepEventRef | null;
  readonly completed: IStepEventRef | null;
}

interface IParsedNodeId {
  readonly branchPath: string | null;
  readonly actionIndex: number | null;
  readonly isJoin: boolean;
}

/**
 * Reverses `layout-run.ts`'s `nodeId`/`joinId` encoding:
 * `` `${branchPath ?? "root"}::${actionIndex}` `` for action/conditional/
 * fork nodes, `` `${forkId}::join` `` (i.e. a trailing `::join`) for join
 * pills. `branchPath` itself is slash-separated (`combineBranchLabel` in
 * `merge-run.ts`) and never contains `::`, so a plain split is safe.
 */
export function parseNodeId(id: string): IParsedNodeId {
  const parts = id.split("::");
  if (parts.length === 3 && parts[2] === "join") {
    const index = Number(parts[1]);
    return {
      branchPath: parts[0] === "root" ? null : (parts[0] ?? null),
      actionIndex: Number.isNaN(index) ? null : index,
      isJoin: true,
    };
  }
  if (parts.length === 2) {
    const index = Number(parts[1]);
    return {
      branchPath: parts[0] === "root" ? null : (parts[0] ?? null),
      actionIndex: Number.isNaN(index) ? null : index,
      isJoin: false,
    };
  }
  return { branchPath: null, actionIndex: null, isJoin: false };
}

function toRef(event: IRunEvent): IStepEventRef {
  return { eventId: event.event_id, occurredAt: event.occurred_at };
}

/**
 * Resolves the clicked node's own `started`/`completed` event refs.
 * - `join` pills carry no event of their own (the fork's `action_started`/
 *   `action_completed` pair belongs to the FORK node, not the join) — both
 *   `null`.
 * - `conditional` pills look up their OWN `condition_evaluated` event by
 *   exact `event_id` (`node.conditionEventId`, already correctly
 *   disambiguated by `merge-run.ts`'s tree-order consumption — see this
 *   file's header) and report it as both `started`/`completed` (a point
 *   event, same instant).
 * - `action`/`fork` nodes match `action_started`/`action_completed` by the
 *   SAME `(branchPath, actionIndex)` key `merge-run.ts` uses.
 */
export function resolveStepEvents(
  node: ILayoutNode,
  events: readonly IRunEvent[]
): IStepEventPair {
  const { branchPath, actionIndex, isJoin } = parseNodeId(node.id);
  if (isJoin || actionIndex === null) {
    return { started: null, completed: null };
  }

  if (node.kind === "conditional") {
    if (!node.conditionEventId) {
      return { started: null, completed: null };
    }
    const match = events.find(
      (event) => event.event_id === node.conditionEventId
    );
    return match
      ? { started: toRef(match), completed: toRef(match) }
      : { started: null, completed: null };
  }

  const started = events.find(
    (event) =>
      event.kind === "action_started" &&
      event.payload_action_index === actionIndex &&
      (event.payload_branch ?? null) === branchPath
  );
  const completed = events.find(
    (event) =>
      event.kind === "action_completed" &&
      event.payload_action_index === actionIndex &&
      (event.payload_branch ?? null) === branchPath
  );
  return {
    started: started ? toRef(started) : null,
    completed: completed ? toRef(completed) : null,
  };
}
