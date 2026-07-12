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
 *   from, so the component renders a short dashed stub to the left of the
 *   child node instead of a parent->child line.
 *
 * Events with a null `causation_id` (true roots) produce no edge at all.
 */
export interface IGraphEdge {
  readonly id: string;
  readonly fromEventId: string | null;
  readonly toEventId: string;
  readonly dashed: boolean;
}

/** Horizontal distance per structural depth level (time/depth flows rightward). */
const DEPTH_DX = 208;
/** Vertical distance per sibling slot (siblings stack top-to-bottom). */
const SLOT_DY = 56;
const MARGIN_X = 40;
const MARGIN_Y = 40;
/** Length of the dashed "missing parent" stub drawn to the left of an orphaned node. */
export const DASHED_STUB_LENGTH = 40;

function producerOf(event: ITrackedEvent): string {
  return event.producer || "—";
}

/** Internal tree-node shape used while computing the Reingold–Tilford-style layout. */
interface ITreeNode {
  readonly event: ITrackedEvent;
  depth: number;
  readonly children: ITreeNode[];
  slot: number;
}

/**
 * Resolves each event's parent id, guarding against the two ways producer-set
 * `causation_id` (never validated for acyclicity on the write path) can break
 * a naive tree walk — mirrors the visited/attached hardening in
 * `audit-service`'s `build-chain-tree.ts`:
 *
 * - SELF-LOOP (`causation_id === event_id`): treated as "no parent" so the
 *   node can never be pushed as its own child.
 * - CYCLE (A -> B -> ... -> A): detected with an iterative three-color walk
 *   (white/gray/black — no recursion, so it can never infinite-loop even on
 *   pathological input). Every event on a cycle is demoted to "no parent" so
 *   it still gets attached as a forest root instead of being unreachable.
 *
 * Returns, for every event id, its resolved parent id or `null` (forest
 * root). By construction each event maps to at most one parent, so the
 * forest built from this map is guaranteed a real (cycle-free) tree.
 */
function resolveParentIds(
  events: readonly ITrackedEvent[],
  idSet: ReadonlySet<string>
): ReadonlyMap<string, string | null> {
  const rawParentId = new Map<string, string | null>();
  for (const event of events) {
    const causationId = event.causation_id;
    const hasParent =
      causationId !== null &&
      causationId !== undefined &&
      causationId !== event.event_id && // self-loop guard: never your own parent
      idSet.has(causationId);
    rawParentId.set(event.event_id, hasParent ? (causationId as string) : null);
  }

  // Iterative three-color cycle detection (CLEAR -> VISITING -> DONE).
  // Walking up the parent chain from each event; if we re-encounter a node
  // still VISITING, everything from that node onward in the current path is
  // part of a cycle.
  const CLEAR = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const onCycle = new Set<string>();

  for (const start of events) {
    if (state.get(start.event_id) === DONE) {
      continue;
    }
    const path: string[] = [];
    let cursor: string | null = start.event_id;
    while (cursor !== null && state.get(cursor) !== DONE) {
      const status = state.get(cursor) ?? CLEAR;
      if (status === VISITING) {
        const cycleStart = path.indexOf(cursor);
        for (let i = cycleStart; i < path.length; i += 1) {
          onCycle.add(path[i]!);
        }
        break;
      }
      state.set(cursor, VISITING);
      path.push(cursor);
      cursor = rawParentId.get(cursor) ?? null;
    }
    for (const id of path) {
      if (state.get(id) !== DONE) {
        state.set(id, DONE);
      }
    }
  }

  const parentIdOf = new Map<string, string | null>();
  for (const event of events) {
    const parentId = rawParentId.get(event.event_id) ?? null;
    // A node on a cycle can never reach a true root — demote it so it still
    // gets laid out (this file's required invariant: one node per event).
    parentIdOf.set(
      event.event_id,
      onCycle.has(event.event_id) ? null : parentId
    );
  }
  return parentIdOf;
}

/**
 * Builds the causal forest from `causation_id`: parent -> children where the
 * parent resolves within the chain. Events whose `causation_id` is null,
 * does not resolve, is a self-loop, or sits on a cycle become forest roots
 * (see `resolveParentIds`), kept in chain (array) order. Every event appears
 * exactly once (each event has at most one resolved parent), so the
 * resulting forest is guaranteed cycle-free. Children of each node are
 * ordered by `offsetMs` (then chain order, stable) so left-to-right reads
 * chronologically. `depth` is the structural distance from the node's root —
 * NOT the raw `causation_depth` — so it always matches the tree actually
 * drawn.
 */
function buildForest(
  events: readonly ITrackedEvent[],
  offsetMsById: ReadonlyMap<string, number>
): readonly ITreeNode[] {
  const idSet = new Set(events.map((event) => event.event_id));
  const nodeById = new Map<string, ITreeNode>();
  const roots: ITreeNode[] = [];

  for (const event of events) {
    nodeById.set(event.event_id, {
      event,
      depth: 0, // resolved below, once parents are known
      children: [],
      slot: 0,
    });
  }

  const parentIdOf = resolveParentIds(events, idSet);

  for (const event of events) {
    const node = nodeById.get(event.event_id)!;
    const parentId = parentIdOf.get(event.event_id) ?? null;
    if (parentId !== null) {
      const parent = nodeById.get(parentId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Assign structural depth by walking down from each root, and sort each
  // node's children chronologically (offsetMs, then chain order — Array#sort
  // is stable, so ties keep chain order). Recursion here is safe: the forest
  // built above is guaranteed acyclic (each node has at most one parent, and
  // cycle members were demoted to roots), so this always terminates.
  const assignDepth = (node: ITreeNode, depth: number): ITreeNode => {
    node.depth = depth;
    node.children.sort(
      (a, b) =>
        (offsetMsById.get(a.event.event_id) ?? 0) -
        (offsetMsById.get(b.event.event_id) ?? 0)
    );
    for (const child of node.children) {
      assignDepth(child, depth + 1);
    }
    return node;
  };

  return roots.map((root) => assignDepth(root, 0));
}

/**
 * Assigns vertical "slots" via post-order traversal: leaves take
 * consecutive integer slots from a shared cursor (`nextLeafSlot`), and each
 * internal node's slot is the average of its first and last child's slot —
 * centering it over its children, which is what makes the tree
 * crossing-free and visually balanced. In the left-to-right layout, slot
 * drives `y` (siblings stack top-to-bottom).
 */
function assignSlots(node: ITreeNode, nextLeafSlot: { value: number }): number {
  if (node.children.length === 0) {
    node.slot = nextLeafSlot.value;
    nextLeafSlot.value += 1;
    return node.slot;
  }

  const childSlots = node.children.map((child) =>
    assignSlots(child, nextLeafSlot)
  );
  const first = childSlots[0];
  const last = childSlots[childSlots.length - 1];
  node.slot = (first + last) / 2;
  return node.slot;
}

/**
 * Lays out chain events as a compact, crossing-free LEFT-TO-RIGHT TREE
 * (Reingold–Tilford style, rotated 90°): `depth` is the structural tree
 * depth from the event's root (root at depth 0, each child = parent depth
 * + 1) walked over the `causation_id` forest and drives `x` — time/depth
 * flows rightward. `y` comes from a post-order vertical "slot" assignment
 * where leaves get consecutive slots (stacked top-to-bottom, ordered by
 * `offsetMs`) and every parent is centered VERTICALLY over its children
 * (SPEC.md `manual-loops/trace-console.md` T06). `column` is kept for
 * API/back-compat as the rounded integer slot. Deterministic: identical
 * input produces identical coordinates (same array order, same arithmetic,
 * no Date.now/random).
 */
export function computeGraphNodes(
  chain: ITrackingChainResponse
): readonly IGraphNode[] {
  const events = chain.events;
  const firstAt = chain.summary.first_at
    ? new Date(chain.summary.first_at).getTime()
    : 0;

  const offsetMsById = new Map<string, number>();
  for (const event of events) {
    const occurredMs = new Date(event.occurred_at).getTime();
    offsetMsById.set(event.event_id, Math.max(0, occurredMs - firstAt));
  }

  const roots = buildForest(events, offsetMsById);

  // Share one leaf-slot cursor across every root so separate trees in the
  // forest sit side by side without overlapping.
  const nextLeafSlot = { value: 0 };
  for (const root of roots) {
    assignSlots(root, nextLeafSlot);
  }

  const nodeByEventId = new Map<string, ITreeNode>();
  const collect = (node: ITreeNode): void => {
    nodeByEventId.set(node.event.event_id, node);
    for (const child of node.children) {
      collect(child);
    }
  };
  for (const root of roots) {
    collect(root);
  }

  return events.map((event) => {
    const treeNode = nodeByEventId.get(event.event_id)!;
    const column = Math.round(treeNode.slot);

    return {
      eventId: event.event_id,
      kind: event.kind ?? event.subject,
      producer: producerOf(event),
      offsetMs: offsetMsById.get(event.event_id) ?? 0,
      depth: treeNode.depth,
      column,
      x: MARGIN_X + treeNode.depth * DEPTH_DX,
      y: MARGIN_Y + treeNode.slot * SLOT_DY,
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
 * connect from (it is missing from the chain), so a short horizontal stub
 * is drawn directly to the left of the child node instead
 * (`DASHED_STUB_LENGTH`) — the missing parent would sit at a smaller `x`
 * in this left-to-right layout.
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
    return { x1: to.x - DASHED_STUB_LENGTH, y1: to.y, x2: to.x, y2: to.y };
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
