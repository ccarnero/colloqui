// causal-chain.ts — pure ancestor-walk deriving the "causal chain" inspector
// content for causal-graph-mode selections (SPEC.md
// manual-loops/admin-console/console-redesign-trace.md T04, decision 3:
// "causal chain in causal graph"). Walks `causation_id` parent links from
// the selected event back to its root, mirroring
// causal-graph-geometry.ts's `resolveParentIds` hardening intent
// (self-loop/cycle guard against un-validated producer-set `causation_id`)
// but without the layout math — this only needs the linear ancestor path
// for the currently-selected event, not the full forest.
import type { ITrackedEvent } from "../../../../core/services/tracking-chain.service";

/** One entry in the derived causal chain, ROOT-FIRST, selected event last —
 * matches the inspector's top-to-bottom reading order. */
export interface ICausalChainEntry {
  readonly eventId: string;
  readonly kind: string;
  readonly causationId: string | null;
  readonly causationDepth: number | null;
  readonly isSelected: boolean;
}

export interface ICausalChainResult {
  /** Root-first ancestor path ending at the selected event. Empty when the
   * selected event id is not present in `events`. */
  readonly entries: readonly ICausalChainEntry[];
  /** Set when the walk's earliest-reached event still carries a non-null
   * `causation_id` that does NOT resolve to any event in `events` — the
   * "orphan" case (SPEC T01 finding: the same population
   * `summary.orphan_count` counts). `null` when the walk reached a true
   * root (`causation_id === null`), stopped on a cycle, or the selection
   * itself was not found. */
  readonly rootUnresolvedParentId: string | null;
}

const EMPTY_RESULT: ICausalChainResult = {
  entries: [],
  rootUnresolvedParentId: null,
};

/**
 * Walks `causation_id` parent links from `eventId` back to its root.
 * Handles the three cases `causal-chain.spec.ts` unit-tests:
 * - LINEAR: A -> B -> C (each `causation_id` pointing at the previous
 *   event's `event_id`) — selecting C returns entries `[A, B, C]`.
 * - BRANCHED: A has two children B and D (both `causation_id: A`) —
 *   selecting D returns `[A, D]`; sibling B is never included (this derives
 *   an ANCESTOR path, not the full subtree/forest).
 * - ORPHAN: the walk's earliest reached event has a non-null
 *   `causation_id` that does not resolve within `events` —
 *   `rootUnresolvedParentId` surfaces it instead of silently stopping (same
 *   "solo correlation" case `causal-graph-geometry.ts`'s dashed edges
 *   render).
 *
 * Self-loop/cycle guarded via a `visited` set: if the walk would revisit an
 * already-collected event id, it stops there rather than looping forever —
 * producer-set `causation_id` is never validated for acyclicity on the
 * write path (same premise as `causal-graph-geometry.ts`'s
 * `resolveParentIds`), but a single linear ancestor walk only needs a
 * visited-set guard, not that file's full three-color forest walk.
 */
export function computeCausalChain(
  events: readonly ITrackedEvent[],
  eventId: string
): ICausalChainResult {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const target = byId.get(eventId);
  if (!target) {
    console.debug("[computeCausalChain] selected event not found in chain", {
      eventId,
    });
    return EMPTY_RESULT;
  }

  const descendingFromSelected: ITrackedEvent[] = [target];
  const visited = new Set<string>([eventId]);
  let cursor = target;
  let rootUnresolvedParentId: string | null = null;

  while (cursor.causation_id !== null && cursor.causation_id !== undefined) {
    const parentId = cursor.causation_id;
    if (visited.has(parentId)) {
      // Cycle guard: the walk would revisit an already-collected event —
      // stop instead of looping forever.
      console.debug("[computeCausalChain] cycle detected, stopping walk", {
        eventId,
        parentId,
      });
      break;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      // Orphan case: causation_id set but not resolvable within this chain.
      rootUnresolvedParentId = parentId;
      break;
    }
    descendingFromSelected.push(parent);
    visited.add(parentId);
    cursor = parent;
  }

  const entries: ICausalChainEntry[] = descendingFromSelected
    .slice()
    .reverse()
    .map((event) => ({
      eventId: event.event_id,
      kind: event.kind ?? event.subject,
      causationId: event.causation_id,
      causationDepth: event.causation_depth,
      isSelected: event.event_id === eventId,
    }));

  console.debug("[computeCausalChain] derived causal chain", {
    eventId,
    entryCount: entries.length,
    rootUnresolvedParentId,
  });

  return { entries, rootUnresolvedParentId };
}
