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
/** Fork/join render as small rounded PILLS, not full two-line boxes
 * (mockup contract: `workflow_run_full_combined_mockup.html` ~110×30,
 * rx≈15, centered single-line label) — narrower/shorter than the
 * standard action box but still centered within the same lane slot, so
 * `nodePosition`'s `x`/`row`/`lane` math (and the fork lane x-positions
 * it drives) is untouched; only the VISUAL rect/label offsets differ. */
export const PILL_WIDTH = 110;
export const PILL_HEIGHT = 30;
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

/** `true` for the two structural node kinds the mockup renders as pills
 * instead of full boxes. */
export function isPillNode(kind: ILayoutNode["kind"]): boolean {
  return kind === "fork" || kind === "join";
}

/** Rendered box/pill height for a node — pills are shorter than the
 * standard action box, so edges must leave from the pill's own bottom
 * edge, not `NODE_HEIGHT`. */
export function nodeVisualHeight(kind: ILayoutNode["kind"]): number {
  return isPillNode(kind) ? PILL_HEIGHT : NODE_HEIGHT;
}

/** `x` offset (within the node's `NODE_WIDTH`-wide lane slot) of a pill's
 * narrower rect, so it renders centered on the same lane column a full
 * box would occupy. */
export function pillOffsetX(): number {
  return (NODE_WIDTH - PILL_WIDTH) / 2;
}

/**
 * Pill label wording (T04's own wording layer, same split as
 * `formatEdgeLabel`/`formatDecisionSubtitle`): the domain's fork label
 * already ends in `"· fork"` (`layout-run.ts`'s `labelFor`) — this appends
 * the mockup's "∥" parallel glyph (`"fanout ∥"`-style) rather than
 * reformatting the domain string. Join's domain label is already the bare
 * `"join"` word, so it passes through unchanged.
 */
export function formatPillLabel(node: ILayoutNode): string {
  if (node.kind === "fork") {
    return `${node.label} ∥`;
  }
  return node.label;
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
  /** Label anchor, nudged perpendicular off the line's own midpoint (see
   * `labelPosition`) so a diagonal fork-out/taken/bypass edge's label does
   * not sit dead-center on top of the line/node rects it crosses. */
  readonly labelX: number;
  readonly labelY: number;
}

/** Perpendicular offset applied to an edge's label so it clears the line
 * itself instead of sitting directly on top of it (mockup: labels float
 * just off the edge). Falls back to a small upward nudge for a
 * (near-)vertical edge, where the perpendicular is (near-)horizontal and
 * would otherwise push the label sideways into a neighboring lane. */
const EDGE_LABEL_OFFSET = 8;

function labelPosition(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { readonly x: number; readonly y: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { x: mx, y: my - EDGE_LABEL_OFFSET };
  }
  // Perpendicular unit vector, offset toward the right of the edge's own
  // direction — matches the mockup's labels sitting to the right of/above
  // the line they annotate.
  const nx = -dy / length;
  const ny = dx / length;
  return {
    x: mx + nx * EDGE_LABEL_OFFSET,
    y: my + ny * EDGE_LABEL_OFFSET - 2,
  };
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
    const x1 = from.x + NODE_WIDTH / 2;
    const y1 = from.y + nodeVisualHeight(from.kind);
    const x2 = to.x + NODE_WIDTH / 2;
    const y2 = to.y;
    const { x: labelX, y: labelY } = labelPosition(x1, y1, x2, y2);
    rendered.push({
      id: edge.id,
      kind: edge.kind,
      dashed: edge.dashed,
      thick: edge.thick,
      label: formatEdgeLabel(edge),
      x1,
      y1,
      x2,
      y2,
      labelX,
      labelY,
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

/** Content bounding box, in SVG user units (== pixels at 1:1, T04's "no
 * upscale" fix — SPEC.md run-view visual rewrite slice 1, Change B). Shared
 * by `computeViewBox` (the `viewBox` attribute) and `computeContentWidth`
 * (the svg's intrinsic `width`, bound with `preserveAspectRatio="xMinYMin
 * meet"` so a narrow tree renders at its natural size instead of stretching
 * to fill the container). */
function computeContentBox(
  positions: readonly IPositionedNode[],
  chips: readonly IForkCollapseChip[]
): { readonly width: number; readonly height: number } {
  if (positions.length === 0) {
    return {
      width: LANE_BASE_X * 2 + NODE_WIDTH,
      height: ROW_PAD_TOP * 2 + ROW_HEIGHT,
    };
  }
  const maxX = Math.max(
    ...positions.map((n) => n.x + NODE_WIDTH),
    ...chips.map((c) => c.x + NODE_WIDTH)
  );
  const maxY = Math.max(
    ...positions.map((n) => n.y + NODE_HEIGHT),
    ...chips.map((c) => c.y + NODE_HEIGHT)
  );
  return { width: maxX + LANE_BASE_X, height: maxY + ROW_PAD_TOP };
}

export function computeViewBox(
  positions: readonly IPositionedNode[],
  chips: readonly IForkCollapseChip[] = []
): string {
  const { width, height } = computeContentBox(positions, chips);
  return `0 0 ${width} ${height}`;
}

/** Intrinsic pixel width of the flow's content — bound to the svg's
 * `[style.width.px]` (capped to the container via `max-width: 100%` in CSS)
 * so boxes render at their natural size and only scale DOWN (never up) when
 * the container is narrower than the content (Change B: "stop the SVG
 * stretch"). */
export function computeContentWidth(
  positions: readonly IPositionedNode[],
  chips: readonly IForkCollapseChip[] = []
): number {
  return computeContentBox(positions, chips).width;
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
