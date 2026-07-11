// causal-graph-geometry.ts — pure layout/edge-derivation helpers for the
// causal graph view. Kept separate from the component so they stay
// unit-testable without TestBed, mirroring the waterfall-geometry.ts /
// sparkline precedent (geometry lives in computed()-friendly pure functions).
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";

/** One graph node — an event, positioned on the causal spine. */
export interface IGraphNode {
  readonly eventId: string;
  readonly kind: string;
  readonly producer: string;
  readonly offsetMs: number;
  readonly depth: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
}

/**
 * One graph edge. `dashed` distinguishes the two link kinds:
 * - `false` (solid): `causation_id` resolves to an `event_id` present in
 *   the chain — a real causal edge, drawn parent -> child.
 * - `true` (dashed, the "solo correlation" case): `causation_id` is set
 *   but does NOT resolve to any event in the chain (the same population
 *   `summary.orphan_count` counts). The parent has no coordinates to draw
 *   from, so the component renders a short dashed stub above the child
 *   node instead of a parent->child line.
 *
 * Events with a null `causation_id` (true roots) produce no edge at all.
 */
export interface IGraphEdge {
  readonly id: string;
  readonly fromEventId: string | null;
  readonly toEventId: string;
  readonly dashed: boolean;
}

const ROW_HEIGHT = 90;
const SUB_ROW_HEIGHT = 70;
const COL_WIDTH = 260;
const MARGIN_X = 40;
const MARGIN_Y = 40;
/** Length of the dashed "missing parent" stub drawn above an orphaned node. */
export const DASHED_STUB_LENGTH = 40;

function producerOf(event: ITrackedEvent): string {
  return event.producer || "—";
}

/**
 * For every event whose `causation_id` resolves within the chain, records
 * the event's zero-based index among its siblings (other events sharing the
 * same `causation_id`), in chain (array) order. Used to decide branch
 * columns deterministically.
 */
function siblingIndexByEventId(
  events: readonly ITrackedEvent[],
  idSet: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const childrenByParent = new Map<string, string[]>();
  for (const event of events) {
    if (event.causation_id && idSet.has(event.causation_id)) {
      const list = childrenByParent.get(event.causation_id) ?? [];
      list.push(event.event_id);
      childrenByParent.set(event.causation_id, list);
    }
  }

  const result = new Map<string, number>();
  for (const children of childrenByParent.values()) {
    children.forEach((eventId, index) => result.set(eventId, index));
  }
  return result;
}

/**
 * Lays out chain events on the causal graph's vertical spine: `depth`
 * (`causation_depth`, defaulting to 0) drives the primary row, siblings
 * sharing a depth are stacked with a secondary row offset, and a node is
 * offset into a second column when its parent has more than one child
 * (SPEC.md `manual-loops/trace-console.md` T06 — "agent-branch offset to a
 * second column when depth branches"). Deterministic: identical input
 * produces identical coordinates (same array order, same arithmetic).
 */
export function computeGraphNodes(
  chain: ITrackingChainResponse
): readonly IGraphNode[] {
  const events = chain.events;
  const idSet = new Set(events.map((event) => event.event_id));
  const firstAt = chain.summary.first_at
    ? new Date(chain.summary.first_at).getTime()
    : 0;
  const siblingIndex = siblingIndexByEventId(events, idSet);

  const rowsSeenAtDepth = new Map<number, number>();

  return events.map((event) => {
    const depth = event.causation_depth ?? 0;
    const rowInDepth = rowsSeenAtDepth.get(depth) ?? 0;
    rowsSeenAtDepth.set(depth, rowInDepth + 1);

    // Second column only for the 2nd+ sibling of a branching parent — the
    // first child stays on the main spine (column 0).
    const column = (siblingIndex.get(event.event_id) ?? 0) > 0 ? 1 : 0;

    const occurredMs = new Date(event.occurred_at).getTime();
    const offsetMs = Math.max(0, occurredMs - firstAt);

    return {
      eventId: event.event_id,
      kind: event.kind ?? event.subject,
      producer: producerOf(event),
      offsetMs,
      depth,
      column,
      x: MARGIN_X + column * COL_WIDTH,
      y: MARGIN_Y + depth * ROW_HEIGHT + rowInDepth * SUB_ROW_HEIGHT,
    };
  });
}

/**
 * Derives the graph's edges from each event's `causation_id`:
 * - resolves within the chain -> solid edge (`dashed: false`).
 * - set but unresolved within the chain -> dashed edge, the "solo
 *   correlation" case (SPEC.md T06); this is the same population
 *   `summary.orphan_count` counts (see `to-chain-response.ts`).
 * - null -> no edge (a true root, no causal parent at all).
 */
export function computeGraphEdges(
  chain: ITrackingChainResponse
): readonly IGraphEdge[] {
  const idSet = new Set(chain.events.map((event) => event.event_id));
  const edges: IGraphEdge[] = [];

  for (const event of chain.events) {
    if (!event.causation_id) {
      continue;
    }
    const resolved = idSet.has(event.causation_id);
    edges.push({
      id: `${event.causation_id}->${event.event_id}`,
      fromEventId: event.causation_id,
      toEventId: event.event_id,
      dashed: !resolved,
    });
  }

  return edges;
}

/** Screen-space line endpoints for one edge, given the laid-out nodes. */
export interface IGraphEdgePoints {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Computes the visual line for an edge. Solid edges connect the parent
 * node's coordinates to the child's. Dashed edges have no parent node to
 * connect from (it is missing from the chain), so a short vertical stub is
 * drawn directly above the child node instead (`DASHED_STUB_LENGTH`).
 */
export function computeEdgePoints(
  edge: IGraphEdge,
  nodesById: ReadonlyMap<string, IGraphNode>
): IGraphEdgePoints | null {
  const to = nodesById.get(edge.toEventId);
  if (!to) {
    return null;
  }

  if (edge.dashed || !edge.fromEventId) {
    return { x1: to.x, y1: to.y - DASHED_STUB_LENGTH, x2: to.x, y2: to.y };
  }

  const from = nodesById.get(edge.fromEventId);
  if (!from) {
    return null;
  }
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
}

/**
 * "channel" header chip: `tech` of the first ingress event in chain order
 * (`business_fn === "ingress"`, TAXONOMY.md §4 rule 2). Falls back to the
 * first event's `tech` when no ingress event is present in the chain.
 */
export function computeChannel(chain: ITrackingChainResponse): string {
  const ingress = chain.events.find((event) => event.business_fn === "ingress");
  return ingress?.tech ?? chain.events[0]?.tech ?? "unknown";
}

/** `spans closed n/m` chain-completeness badge. */
export interface IChainCompleteness {
  readonly closed: number;
  readonly total: number;
}

/**
 * Chain-completeness badge data. T01's `summary` (`to-chain-response.ts`)
 * has no direct "spans closed" field, so this is honestly derived here:
 * `closed` = spans carrying actual duration data (`duration_ms > 0` — a
 * matched started/completed pair per `span-pairs.sql`), `total` = the
 * chain's event count (`summary.count`), matching the badge's own label
 * ("spans closed n/m") against the population size of events they could
 * cover.
 */
export function computeChainCompleteness(
  chain: ITrackingChainResponse
): IChainCompleteness {
  const closed = chain.spans.filter((span) => span.duration_ms > 0).length;
  return { closed, total: chain.summary.count };
}
