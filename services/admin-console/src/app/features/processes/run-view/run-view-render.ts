// run-view-render.ts — pure screen-geometry + display-string helpers for
// `run-view.component.ts`. Kept separate from the component so the pixel
// math and string formatting stay unit-testable without TestBed, mirroring
// `causal-graph-geometry.ts`'s precedent (that file computes `x`/`y` from
// `causal_depth`; this one computes `x`/`y` from the domain layer's
// `row`/`lane`/`nestingDepth`). IMPORTANT: this file does NOT make any
// branch/fork/if/critical-path decision — those are 100% owned by
// `domain/layout-run.ts` (SPEC.md hard rule). It only:
//   1. maps the domain's row/lane/nestingDepth to SVG pixels, and
//   2. formats a handful of DISPLAY STRINGS the domain deliberately does
//      NOT own (T03's own reviewer note: "not-executed display strings are
//      T04's job (domain carries semantics only)" — the same split applies
//      to the decision "evaluated: X -> case Y" chip and the run-status
//      summary chip, which are new in T04, not reformats of anything T03
//      already shipped).

import type {
  IRunCastEntry,
  IRunSummary,
  RunCastKind,
} from "../../../core/services/run-view.service";
import type {
  ActionStatus,
  IForkGeometry,
  ILayoutEdge,
  ILayoutNode,
  StepColor,
} from "./domain/run-view.model";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 44;
const ROW_HEIGHT = 92;
const ROW_PAD_TOP = 30;
const LANE_GAP = 240;
const LANE_BASE_X = 50;
const NEST_INDENT = 18;
/** Extra virtual lane column collapsed-fork chips render into, one lane
 * past the highest visible lane a fork can produce (`FORK_LANE_CAP`). */
const COLLAPSED_LANE_OFFSET = 4;

export interface IPositionedNode extends ILayoutNode {
  readonly x: number;
  readonly y: number;
}

export interface IRenderedRunEdge {
  readonly id: string;
  readonly kind: ILayoutEdge["kind"];
  readonly dashed: boolean;
  readonly thick: boolean;
  readonly label: string | null;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface IForkCollapseChip {
  readonly forkId: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** Top-left corner of a node's box, from its domain-owned `row`/`lane`/
 * `nestingDepth` — NOT time-scaled (SPEC decision 1: equally-spaced). */
export function nodePosition(node: {
  readonly row: number;
  readonly lane: number;
  readonly nestingDepth: number;
}): { readonly x: number; readonly y: number } {
  return {
    x: LANE_BASE_X + node.lane * LANE_GAP + node.nestingDepth * NEST_INDENT,
    y: ROW_PAD_TOP + node.row * ROW_HEIGHT,
  };
}

export function computeNodePositions(
  nodes: readonly ILayoutNode[]
): readonly IPositionedNode[] {
  return nodes.map((node) => ({ ...node, ...nodePosition(node) }));
}

/** Straight line from the source box's bottom-center to the target box's
 * top-center — same "no chart lib, plain line" approach `computeEdgePoints`
 * uses in `causal-graph-geometry.ts`, including for cross-lane edges
 * (fork-out/join-in/taken/not-taken). */
export function computeRenderedEdges(
  edges: readonly ILayoutEdge[],
  positionsById: ReadonlyMap<string, IPositionedNode>
): readonly IRenderedRunEdge[] {
  const rendered: IRenderedRunEdge[] = [];
  for (const edge of edges) {
    const from = positionsById.get(edge.fromId);
    const to = positionsById.get(edge.toId);
    if (!from || !to) {
      continue;
    }
    rendered.push({
      id: edge.id,
      kind: edge.kind,
      dashed: edge.dashed,
      thick: edge.thick,
      label: formatEdgeLabel(edge),
      x1: from.x + NODE_WIDTH / 2,
      y1: from.y + NODE_HEIGHT,
      x2: to.x + NODE_WIDTH / 2,
      y2: to.y,
    });
  }
  return rendered;
}

/** `↔ N more` collapse chip for lanes beyond `FORK_LANE_CAP`
 * (DESIGN.md: "max 2-3, then collapse to summary"), one per fork whose
 * `collapsedCount > 0`, anchored to the fork node's row. */
export function computeForkCollapseChips(
  forks: readonly IForkGeometry[],
  positionsById: ReadonlyMap<string, IPositionedNode>
): readonly IForkCollapseChip[] {
  const chips: IForkCollapseChip[] = [];
  for (const fork of forks) {
    if (fork.collapsedCount <= 0) {
      continue;
    }
    const forkNode = positionsById.get(fork.forkId);
    if (!forkNode) {
      continue;
    }
    chips.push({
      forkId: fork.forkId,
      x: LANE_BASE_X + COLLAPSED_LANE_OFFSET * LANE_GAP,
      y: forkNode.y + ROW_HEIGHT,
      text: `↔ ${fork.collapsedCount} more`,
    });
  }
  return chips;
}

export function computeViewBox(
  positions: readonly IPositionedNode[],
  chips: readonly IForkCollapseChip[] = []
): string {
  if (positions.length === 0) {
    return `0 0 ${LANE_BASE_X * 2 + NODE_WIDTH} ${ROW_PAD_TOP * 2 + ROW_HEIGHT}`;
  }
  const maxX = Math.max(
    ...positions.map((n) => n.x + NODE_WIDTH),
    ...chips.map((c) => c.x + NODE_WIDTH)
  );
  const maxY = Math.max(
    ...positions.map((n) => n.y + NODE_HEIGHT),
    ...chips.map((c) => c.y + NODE_HEIGHT)
  );
  return `0 0 ${maxX + LANE_BASE_X} ${maxY + ROW_PAD_TOP}`;
}

/** `ActionStatus` -> readable English label — the not-executed/failed/ok
 * word choice T03's reviewer note reserves for T04. */
export function formatNodeStatusLabel(status: ActionStatus): string {
  if (status === "not_executed") {
    return "not executed";
  }
  return status;
}

/**
 * Edge label: taken/fork-out/join-in labels pass through the domain's own
 * string VERBATIM (e.g. the join's critical-path label, or a fork lane
 * name) — `layout-run.ts` already owns that text and T04 must not
 * reformat it (never weaken/second-guess a committed domain decision).
 * The two cases the domain deliberately leaves blank/bare for T04 to
 * phrase in English (per the same reviewer note as the not-executed
 * dashed-box labels): a not-taken conditional branch, and the
 * if-without-else bypass edge.
 */
export function formatEdgeLabel(edge: ILayoutEdge): string | null {
  if (edge.kind === "not-taken") {
    return edge.label ? `${edge.label} — not executed` : "not executed";
  }
  if (edge.kind === "bypass") {
    return "bypass — skipped";
  }
  return edge.label;
}

/**
 * Amber decision box subtitle (DESIGN.md: `evaluó: <value> -> caso "X" ✓`)
 * — English per SPEC decision 5 ("Console UI strings in English"). Built
 * from `evaluatedValue`/`branchTaken`, which `layout-run.ts` now passes
 * through raw on the conditional `ILayoutNode` (this file owns the
 * wording, not the semantics). `null` for non-conditional nodes and for
 * not-executed conditionals (their dashed box only needs the generic
 * "not executed" status label, no evaluation happened).
 */
export function formatDecisionSubtitle(node: ILayoutNode): string | null {
  if (node.kind !== "conditional" || node.status === "not_executed") {
    return null;
  }
  if (node.branchTaken !== null) {
    return `evaluated: ${node.evaluatedValue} → case "${node.branchTaken}" ✓`;
  }
  // If-without-else, evaluated false: no branch taken, no default —
  // DESIGN.md's bypass case ("evaluó: false -> salteado").
  return `evaluated: ${node.evaluatedValue} → skipped`;
}

/** Header status chip (DESIGN.md: `completed · 5/5 · 3 not executed`).
 * `notExecutedCount` is supplied by the caller (count of dashed layout
 * nodes) since the domain's `IRunSummary` (T01/T02) only tracks
 * ok/failed, not the definition-only not-executed population. */
export function formatRunStatusChip(
  summary: IRunSummary,
  notExecutedCount: number
): string {
  const executedTotal = summary.steps_ok + summary.steps_failed;
  return `${summary.status} · ${summary.steps_ok}/${executedTotal} · ${notExecutedCount} not executed`;
}

/** Colors per DESIGN.md's table: gray = platform/structural, purple =
 * agent, teal = channel. `tool` (agent sub-events, e.g. `tool_call`) is
 * part of the agent family visually, so it maps to the same purple. */
export function resolveCastColor(kind: RunCastKind): StepColor {
  if (kind === "agent" || kind === "tool") {
    return "agent";
  }
  if (kind === "channel") {
    return "channel";
  }
  return "platform";
}

export function castEntryId(entry: IRunCastEntry): string {
  return entry.id;
}
