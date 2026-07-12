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
const EDGE_LABEL_OFFSET = 10;

/**
 * Bug 3 fix (run-view visual rewrite slice 4): the fork/branch lane edges
 * in a crowded fanout (3+ parallel lanes leaving one fork pill) are steep
 * diagonals in EITHER direction, so a plain "offset to the right of travel"
 * perpendicular sometimes pushed the label DOWN, straight onto the target
 * lane's box. The perpendicular is still used (it keeps the label off the
 * line itself), but its vertical component is now always forced negative
 * (screen-up) so every fork/branch label floats ABOVE its line — never on
 * top of the node rect the line terminates into — regardless of which way
 * the edge itself is sloping.
 */
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
  let offX = nx * EDGE_LABEL_OFFSET;
  let offY = ny * EDGE_LABEL_OFFSET;
  // Force the vertical component upward (screen-up is negative y) so the
  // label never drifts onto a box below the line.
  if (offY > 0) {
    offX = -offX;
    offY = -offY;
  }
  return {
    x: mx + offX,
    y: my + offY - 2,
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
  chips: readonly IForkCollapseChip[],
  artifactBoxes: readonly IArtifactBox[] = []
): { readonly width: number; readonly height: number } {
  if (positions.length === 0) {
    return {
      width: LANE_BASE_X * 2 + NODE_WIDTH,
      height: ROW_PAD_TOP * 2 + ROW_HEIGHT,
    };
  }
  const maxX = Math.max(
    ...positions.map((n) => n.x + NODE_WIDTH),
    ...chips.map((c) => c.x + NODE_WIDTH),
    // Slice 3/4: widen the content box to include the FULL right-hand
    // artifact box extent (column x + the box's own width), never just the
    // column's x — otherwise the widest artifact box's text/rect clips off
    // the right edge of the viewBox (bug 1, slice 4).
    ...artifactBoxes.map((b) => b.x + ARTIFACT_BOX_WIDTH)
  );
  const maxY = Math.max(
    ...positions.map((n) => n.y + NODE_HEIGHT),
    ...chips.map((c) => c.y + NODE_HEIGHT),
    ...artifactBoxes.map((b) => b.y + ARTIFACT_BOX_HEIGHT)
  );
  return { width: maxX + LANE_BASE_X, height: maxY + ROW_PAD_TOP };
}

export function computeViewBox(
  positions: readonly IPositionedNode[],
  chips: readonly IForkCollapseChip[] = [],
  artifactBoxes: readonly IArtifactBox[] = []
): string {
  const { width, height } = computeContentBox(positions, chips, artifactBoxes);
  return `0 0 ${width} ${height}`;
}

/** Intrinsic pixel width of the flow's content — bound to the svg's
 * `[style.width.px]` (capped to the container via `max-width: 100%` in CSS)
 * so boxes render at their natural size and only scale DOWN (never up) when
 * the container is narrower than the content (Change B: "stop the SVG
 * stretch"). */
export function computeContentWidth(
  positions: readonly IPositionedNode[],
  chips: readonly IForkCollapseChip[] = [],
  artifactBoxes: readonly IArtifactBox[] = []
): number {
  return computeContentBox(positions, chips, artifactBoxes).width;
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

// ── Artifact lane (run-view visual rewrite slice 3) ──────────────────
//
// RENDER-LAYER OVERLAY ONLY — derives a right-hand "artefactos" column
// from the existing `IPositionedNode`s. The domain step tree
// (`layout-run.ts`/`merge-run.ts`) is NOT touched; this reads the
// already-computed `actionType`/`instanceId`/`durationMs`/`status` fields
// the domain already carries and adds screen geometry + display strings,
// same split as the rest of this file.
//
// DATA REALITY (verified against the ingester's run endpoint, do not
// fabricate beyond this): the connector's `connector.endpoint_call.completed`
// event carries no correlation id, so it never lands in the run's own
// events, and there is no agent tool/memory event family either. So the
// artifact box shows only what IS on the layout node already — the
// instance kind + id/name (via the run's `cast`), the step's own
// duration/status — and the req/resp edges carry duration + status, NOT
// invented byte sizes / HTTP status / cache result / tool counts.

export type ArtifactKind = "connector" | "agent" | "channel";

/** `WorkflowActionKind`s that resolve to a "connector" artifact — mirrors
 * `IWorkflowLeafAction.activity`'s connector-shaped variants (mockup:
 * `endpointCall`/`mcpCall`/`serviceCall`/`serviceBusCall` all render the
 * same paired "connector-runtime"-style box). */
const CONNECTOR_ACTION_TYPES: ReadonlySet<string> = new Set([
  "endpointCall",
  "mcpCall",
  "serviceCall",
  "serviceBusCall",
]);

/** Which artifact family (if any) a node's `actionType` belongs to.
 * `null` for every structural node (`conditional`/`fork`/`join` — their
 * `actionType` is `null`/`"branch"`, neither of which is in the leaf sets
 * below) and for plain non-artifact leaf actions (`jsFunction`,
 * `setVariable`). */
export function resolveArtifactKind(node: ILayoutNode): ArtifactKind | null {
  if (node.kind !== "action" || node.actionType === null) {
    return null;
  }
  if (CONNECTOR_ACTION_TYPES.has(node.actionType)) {
    return "connector";
  }
  if (node.actionType === "agentCall") {
    return "agent";
  }
  if (node.actionType === "channelSend") {
    return "channel";
  }
  return null;
}

/** `true` when a node gets a paired artifact box: it must resolve to an
 * `ArtifactKind` AND either carry a real `instanceId` (connector/agent —
 * `merge-run.ts` only fills `instanceId` from `payload_connector_id`/
 * `payload_agent_id`) or be a `channelSend` (which never carries an
 * `instanceId` per the domain model's own doc comment, but still gets a
 * box per SPEC.md — its instance ref falls back to the run's `cast`). */
export function isArtifactNode(node: ILayoutNode): boolean {
  const kind = resolveArtifactKind(node);
  if (kind === null) {
    return false;
  }
  return kind === "channel" || node.instanceId !== null;
}

/**
 * Run-view visual rewrite slice 5: the mockup only pairs a SEPARATE
 * right-column artifact box with TOP-LEVEL SPINE artifact steps (the main
 * connector/channel steps, `nestingDepth === 0 && lane === 0` —
 * `layoutSequence`'s top-level call always lays out at `lane: 0`, and every
 * fork lane/conditional branch nests at `lane >= 1` or `nestingDepth >= 1`,
 * see `layout-run.ts`). A step inside a fork lane or a condition branch
 * gets its artifact info rendered INLINE in its own box instead (see
 * `isNestedArtifactNode`/`nodeSubLabel` below) — this is what avoids the
 * same-row collision the old vertical-stacking hack used to paper over.
 */
export function isSpineArtifactNode(node: ILayoutNode): boolean {
  return isArtifactNode(node) && node.nestingDepth === 0 && node.lane === 0;
}

/** The complement of `isSpineArtifactNode`: an artifact-eligible step
 * nested inside a fork lane (`lane > 0`) or a condition branch
 * (`nestingDepth > 0`) — gets the mockup's collapsed "↔" inline chip in its
 * own sub-label instead of a paired right-column box. */
export function isNestedArtifactNode(node: ILayoutNode): boolean {
  return isArtifactNode(node) && (node.nestingDepth > 0 || node.lane > 0);
}

/** Same rect footprint as a standard action box, so the artifact column
 * lines up row-for-row with the spine's own `NODE_HEIGHT`. */
export const ARTIFACT_BOX_WIDTH = NODE_WIDTH;
export const ARTIFACT_BOX_HEIGHT = NODE_HEIGHT;
/** Horizontal gap between the widest spine content and the artifact
 * column (mockup: spine boxes end at x=300, artifact boxes start at
 * x=400 — a 100px gap; padded slightly wider here to leave room for the
 * req/resp edge labels sitting in between). */
const ARTIFACT_COL_GAP = 140;

export interface IArtifactBox {
  /** Id of the underlying spine `ILayoutNode` this box is paired with —
   * T05's popup wiring resolves back to that node via this id rather than
   * the artifact box carrying its own click/popup logic. */
  readonly stepId: string;
  readonly kind: ArtifactKind;
  readonly color: StepColor;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly subLabel: string;
}

/** Fixed right-column `x` for every artifact box in the run (mockup: one
 * shared column, not per-lane) — one gap past the rightmost spine node,
 * so nothing the domain's fork lanes produce ever overlaps it. */
export function computeArtifactColumnX(
  positions: readonly IPositionedNode[]
): number {
  if (positions.length === 0) {
    return LANE_BASE_X + NODE_WIDTH + ARTIFACT_COL_GAP;
  }
  const maxRight = Math.max(...positions.map((p) => p.x + NODE_WIDTH));
  return maxRight + ARTIFACT_COL_GAP;
}

/** `ArtifactKind` -> `StepColor` — connector reuses the platform/gray
 * family (DESIGN.md's color table has no separate "connector" color),
 * agent/channel reuse their own existing families. */
function artifactColor(kind: ArtifactKind): StepColor {
  if (kind === "connector") {
    return "platform";
  }
  return kind;
}

function findCastEntry(
  node: ILayoutNode,
  kind: ArtifactKind,
  cast: readonly IRunCastEntry[]
): IRunCastEntry | null {
  if (node.instanceId !== null) {
    return cast.find((entry) => entry.id === node.instanceId) ?? null;
  }
  // `channelSend` carries no `instanceId` (domain model doc comment) — the
  // run's cast still lists the channel actor (same fallback the header's
  // "entry/channel" chip already uses), so fall back to the first
  // `channel`-kind cast entry rather than showing no instance ref at all.
  if (kind === "channel") {
    return cast.find((entry) => entry.kind === "channel") ?? null;
  }
  return null;
}

/** Max characters of a raw instance ref (e.g. a connector UUID) shown
 * before truncating — bug 1 fix (slice 4): an untruncated UUID like
 * `"d021a4ce-9112-4835-a1fa-74aedd2d2133"` renders far wider than
 * `ARTIFACT_BOX_WIDTH` and overflows the box. 8 chars + the ellipsis glyph
 * keeps the label within the box at the artifact font size. */
const INSTANCE_REF_TRUNCATE_LEN = 8;

/** Truncates a long raw instance ref (id) to a short display form; short
 * refs (including a resolved cast `name`, which is already human-sized)
 * pass through unchanged. */
function truncateInstanceRef(ref: string): string {
  if (ref.length <= INSTANCE_REF_TRUNCATE_LEN + 1) {
    return ref;
  }
  return `${ref.slice(0, INSTANCE_REF_TRUNCATE_LEN)}…`;
}

/** Canonical UUID shape check (8-4-4-4-12 hex groups). Used to decide
 * whether an artifact ref needs truncation, regardless of whether it came
 * from a resolved cast entry's `name` (which, when the cast has no
 * friendly name, IS the raw UUID) or the unresolved `instanceId` fallback
 * — bug fix: a cast entry `name` that is itself a raw UUID was previously
 * passed through untruncated, overflowing `ARTIFACT_BOX_WIDTH`. */
export function isUuidLike(ref: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    ref
  );
}

/** Box label: `"<kind> · <instance ref>"` — the instance ref prefers the
 * resolved cast entry's human `name`, falling back to the raw `instanceId`
 * or the literal `"unknown"` (no id and no cast match at all — degraded
 * run). Whichever ref is chosen, it is truncated only when UUID-shaped
 * (bug fix, slice 6): a friendly name like `http-generic` passes through
 * unchanged, while a raw connector/agent UUID — whether it arrived via
 * `castEntry.name` or `instanceId` — is always shortened so it fits inside
 * `ARTIFACT_BOX_WIDTH`. */
function formatArtifactLabel(
  kind: ArtifactKind,
  node: ILayoutNode,
  castEntry: IRunCastEntry | null
): string {
  const raw = castEntry?.name ?? node.instanceId ?? "unknown";
  const ref = isUuidLike(raw) ? truncateInstanceRef(raw) : raw;
  return `${kind} · ${ref}`;
}

/** Sub-line: `"↔ · <ms>ms · <status>"` — duration + status only, per the
 * data-reality note above (no byte sizes / HTTP status / tool counts to
 * show). `"↔ · — · <status>"` when the step carries no duration (e.g. a
 * `not_executed` step, which can still resolve to an artifact kind for a
 * definition-only dashed box). */
function formatArtifactSubLabel(node: ILayoutNode): string {
  const ms = node.durationMs !== null ? `${node.durationMs}ms` : "—";
  return `↔ · ${ms} · ${formatNodeStatusLabel(node.status)}`;
}

/**
 * A node's own sub-label (the status/duration line under its title) —
 * `"<status> · <ms>ms"` for every ordinary node, unchanged from before.
 * For a NESTED artifact step (`isNestedArtifactNode` — inside a fork lane
 * or a condition branch, run-view visual rewrite slice 5), the mockup shows
 * the artifact info INLINE instead of a separate right-column box: the
 * sub-label is prefixed with a collapsed "↔ <kind> · " chip (mockup:
 * `"↔ connector · 356 ms · ok"`, `"↔ ai-agent-gateway · 412 ms · ok"`) — the
 * same "↔ = collapsed artifact" glyph the legend already documents,
 * signaling this box's own request/response pair was folded into it rather
 * than drawn as a separate paired box. Clicking the node's own box still
 * opens the same popup peek unchanged (`onNodeClick`, T05's wiring) — this
 * only changes what text renders, not the click behavior.
 */
export function nodeSubLabel(node: ILayoutNode): string {
  const statusLabel = formatNodeStatusLabel(node.status);
  const durationPart = node.durationMs !== null ? `${node.durationMs}ms` : null;
  if (!isNestedArtifactNode(node)) {
    return durationPart !== null
      ? `${statusLabel} · ${durationPart}`
      : statusLabel;
  }
  const kind = resolveArtifactKind(node)!;
  const parts = [kind, durationPart, statusLabel].filter(
    (part): part is string => part !== null
  );
  return `↔ ${parts.join(" · ")}`;
}

/**
 * Right-column artifact box per SPINE artifact-eligible node only
 * (`isSpineArtifactNode` — run-view visual rewrite slice 5), one shared `x`
 * column (`computeArtifactColumnX`). Spine steps are strictly sequential
 * (one per `row`, always `lane === 0`), so two spine artifact boxes can
 * never land on the same `y` — the vertical-stacking offset the old (slice
 * 4) implementation needed for colliding fork-lane boxes on the same `row`
 * is gone, because fork-lane/branch steps no longer get a right-column box
 * at all (they render their artifact info inline instead, see
 * `nodeSubLabel`). This removes the long crossing req/resp edges that
 * stacking used to create when 3 parallel fork lanes pushed their boxes far
 * down the shared column.
 */
export function computeArtifactBoxes(
  positions: readonly IPositionedNode[],
  cast: readonly IRunCastEntry[]
): readonly IArtifactBox[] {
  const columnX = computeArtifactColumnX(positions);
  const boxes: IArtifactBox[] = [];
  for (const node of positions) {
    if (!isSpineArtifactNode(node)) {
      continue;
    }
    const kind = resolveArtifactKind(node)!;
    const castEntry = findCastEntry(node, kind, cast);
    boxes.push({
      stepId: node.id,
      kind,
      color: artifactColor(kind),
      x: columnX,
      y: node.y,
      label: formatArtifactLabel(kind, node, castEntry),
      subLabel: formatArtifactSubLabel(node),
    });
  }
  return boxes;
}

export interface IArtifactEdge {
  readonly id: string;
  /** Id of the paired spine `ILayoutNode` — same wiring key as
   * `IArtifactBox.stepId`. */
  readonly stepId: string;
  readonly direction: "request" | "response";
  /** `false` (solid) for the request edge, `true` (dashed) for the
   * response edge — mirrors the mockup's "sólida = request … punteada =
   * response" legend line, reusing the existing `.rv-edge-dashed` CSS. */
  readonly dashed: boolean;
  readonly label: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Label anchor for the req/resp text (bug 3 fix, slice 4) — centered
   * horizontally in the GAP between the spine box and the artifact box (the
   * pair's `x1`/`x2` midpoint already lands there), but nudged vertically
   * off the connecting line itself: the request label floats just above
   * the line, the response label just below, so the two labels of a pair
   * (which share the same line, only reversed) never render on top of each
   * other or the line. */
  readonly labelX: number;
  readonly labelY: number;
}

/** Vertical clearance an artifact request/response label gets off its own
 * connecting line (bug 3 fix, slice 4). */
const ARTIFACT_EDGE_LABEL_OFFSET = 8;

/** Request (spine → artifact, solid, "req") + response (artifact → spine,
 * dashed, "resp · <ms>ms") edge PAIR per artifact box, both anchored at
 * the shared row's vertical center (spine box's right edge <-> artifact
 * box's left edge) — same "plain line, no chart lib" approach as
 * `computeRenderedEdges`. Duration-only response label (data-reality
 * note: no byte figures to show). */
export function computeArtifactEdges(
  positions: readonly IPositionedNode[],
  boxes: readonly IArtifactBox[]
): readonly IArtifactEdge[] {
  const boxByStepId = new Map(boxes.map((box) => [box.stepId, box]));
  const edges: IArtifactEdge[] = [];
  for (const node of positions) {
    const box = boxByStepId.get(node.id);
    if (!box) {
      continue;
    }
    const stepRightX = node.x + NODE_WIDTH;
    const stepMidY = node.y + nodeVisualHeight(node.kind) / 2;
    const boxLeftX = box.x;
    const boxMidY = box.y + ARTIFACT_BOX_HEIGHT / 2;
    const midX = (stepRightX + boxLeftX) / 2;
    const midY = (stepMidY + boxMidY) / 2;
    edges.push({
      id: `${node.id}->req`,
      stepId: node.id,
      direction: "request",
      dashed: false,
      label: "req",
      x1: stepRightX,
      y1: stepMidY,
      x2: boxLeftX,
      y2: boxMidY,
      labelX: midX,
      labelY: midY - ARTIFACT_EDGE_LABEL_OFFSET,
    });
    const responseMs = node.durationMs !== null ? `${node.durationMs}ms` : "—";
    edges.push({
      id: `${node.id}<-resp`,
      stepId: node.id,
      direction: "response",
      dashed: true,
      label: `resp · ${responseMs}`,
      x1: boxLeftX,
      y1: boxMidY,
      x2: stepRightX,
      y2: stepMidY,
      labelX: midX,
      labelY: midY + ARTIFACT_EDGE_LABEL_OFFSET + 8,
    });
  }
  return edges;
}

export interface IRunColumnHeaders {
  readonly spineX: number;
  readonly artifactX: number;
  readonly y: number;
}

const COLUMN_HEADER_Y = 14;

/** The two column header texts (mockup: "workflow run" / "artefactos",
 * English per SPEC.md decision 5 — "artifacts"). `spineX` centers over the
 * spine's own content bounding box (so it stays correct regardless of how
 * many fork lanes are visible); `artifactX` centers over the artifact
 * box's own fixed width at the shared column `x`. */
export function computeColumnHeaders(
  positions: readonly IPositionedNode[],
  artifactColumnX: number
): IRunColumnHeaders {
  if (positions.length === 0) {
    return {
      spineX: LANE_BASE_X + NODE_WIDTH / 2,
      artifactX: artifactColumnX + ARTIFACT_BOX_WIDTH / 2,
      y: COLUMN_HEADER_Y,
    };
  }
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x + NODE_WIDTH));
  return {
    spineX: (minX + maxX) / 2,
    artifactX: artifactColumnX + ARTIFACT_BOX_WIDTH / 2,
    y: COLUMN_HEADER_Y,
  };
}
