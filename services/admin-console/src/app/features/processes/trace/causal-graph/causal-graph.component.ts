import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";
import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import { TraceSelectionService } from "../trace-selection.service";
import {
  computeChainCompleteness,
  computeChannel,
  computeEdgePoints,
  computeGraphEdges,
  computeGraphNodes,
  type IGraphEdgePoints,
  type IGraphNode,
} from "./causal-graph-geometry";

const NODE_WIDTH = 168;
const NODE_HEIGHT = 46;
const NODE_PAD_X = 30;
const NODE_PAD_Y = 40;

/** One rendered edge, resolved to screen-space endpoints. */
interface IRenderedEdge {
  readonly id: string;
  readonly dashed: boolean;
  readonly points: IGraphEdgePoints;
}

/**
 * Causal graph view for a correlation's tracked-event chain: nodes are
 * events laid out on a causal spine by `causation_depth`, edges are drawn
 * `causation_id -> event_id` (solid) or as a dashed "missing parent" stub
 * for the solo-correlation case (SPEC.md `manual-loops/trace-console.md`
 * T06).
 *
 * T04 (`manual-loops/admin-console/console-redesign-trace.md`) MIGRATED
 * this component's selection off a local `selected` signal onto the shared
 * `TraceSelectionService.select(eventId, "causal")` (decision 2: view-local
 * selection state is automatic rejection) — node click and highlight both
 * go through the service now. The inline `.cg-detail` card (base fields,
 * on-demand payload fetch, "Open connector" deep link) that used to live
 * here has been REPLACED by `TraceDetailComponent`'s shared inspector,
 * which renders the same content (plus the new "causal chain" block,
 * decision 3) for causal-mode selections — see that component's header
 * comment and `causal-chain.ts`. This component is now purely presentational:
 * geometry in, selection events out.
 *
 * Data-agnostic: the chain is provided by the parent (T07 wires the fetch).
 */
@Component({
  selector: "app-causal-graph",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cg">
      <header class="cg-chips">
        <span class="cg-chip">
          <span class="cg-chip-label">correlation</span>
          <span class="cg-chip-value cg-mono">{{ chain().correlation_id }}</span>
        </span>
        <span class="cg-chip">
          <span class="cg-chip-label">channel</span>
          <span class="cg-chip-value">{{ channel() }}</span>
        </span>
        <span class="cg-chip">
          <span class="cg-chip-label">events</span>
          <span class="cg-chip-value">{{ chain().summary.count }}</span>
        </span>
        <span class="cg-chip">
          <span class="cg-chip-label">duration</span>
          <span class="cg-chip-value">{{ chain().summary.total_ms }} ms</span>
        </span>
        <span class="cg-chip">
          <span class="cg-chip-label">chain completeness</span>
          <span class="cg-chip-value"
            >spans closed {{ completeness().closed }}/{{ completeness().total }}</span
          >
        </span>
      </header>

      <div class="cg-svg-scroll">
        <svg
          class="cg-svg"
          [attr.viewBox]="viewBox()"
          [attr.width]="graphWidth()"
          [attr.height]="graphHeight()"
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label="Causal graph"
        >
          <defs>
            <marker
              id="cg-arrow-solid"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#495057" />
            </marker>
            <marker
              id="cg-arrow-dashed"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#adb5bd" />
            </marker>
          </defs>

          @for (edge of renderedEdges(); track edge.id) {
            <line
              class="cg-edge"
              [class.cg-edge-dashed]="edge.dashed"
              [attr.x1]="edge.points.x1"
              [attr.y1]="edge.points.y1"
              [attr.x2]="edge.points.x2"
              [attr.y2]="edge.points.y2"
              [attr.marker-end]="edge.dashed ? 'url(#cg-arrow-dashed)' : 'url(#cg-arrow-solid)'"
            />
          }

          @for (node of nodes(); track node.eventId) {
            <g
              class="cg-node"
              [class.cg-node-selected]="isSelected(node)"
              [attr.transform]="'translate(' + (node.x - NODE_WIDTH / 2) + ',' + (node.y - NODE_HEIGHT / 2) + ')'"
              (click)="onNodeClick(node)"
            >
              <rect
                class="cg-node-rect"
                [attr.width]="NODE_WIDTH"
                [attr.height]="NODE_HEIGHT"
                rx="8"
              />
              <text class="cg-node-line1" [attr.x]="NODE_WIDTH / 2" y="18">
                {{ node.kind }}
              </text>
              <text class="cg-node-line2" [attr.x]="NODE_WIDTH / 2" y="34">
                {{ node.producer }} · t+{{ node.offsetMs }}ms
              </text>
            </g>
          }
        </svg>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .cg {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cg-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      border: 1px solid var(--border-subtle, #ddd);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
    }
    .cg-chip {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cg-chip-label {
      color: var(--text3, #888);
      font-size: 11px;
    }
    .cg-chip-value {
      font-weight: 500;
    }
    .cg-mono {
      font-family: var(--font-mono, monospace);
    }
    .cg-svg-scroll {
      min-width: 0;
      min-height: 300px;
      overflow: auto;
    }
    .cg-svg {
      display: block;
      background: var(--bg2, #f8f9fa);
      border-radius: 8px;
    }
    .cg-edge {
      stroke: #495057;
      stroke-width: 1.5;
      fill: none;
    }
    .cg-edge-dashed {
      stroke: #adb5bd;
      stroke-dasharray: 4 3;
    }
    .cg-node {
      cursor: pointer;
    }
    .cg-node-rect {
      fill: #fff;
      stroke: #185fa5;
      stroke-width: 1.5;
    }
    .cg-node-selected .cg-node-rect {
      stroke: #b3261e;
      stroke-width: 2.5;
    }
    .cg-node-line1 {
      font-size: 12px;
      font-weight: 600;
      text-anchor: middle;
    }
    .cg-node-line2 {
      font-size: 10px;
      fill: #868e96;
      text-anchor: middle;
    }
  `,
})
export class CausalGraphComponent {
  readonly chain = input.required<ITrackingChainResponse>();

  /** Shared cross-view selection (T02-T04) — walks up to the
   * `TraceDetailComponent`-provided instance; NOT `providedIn: "root"` (see
   * `TraceSelectionService`'s header comment). T04 removed this
   * component's OWN local `selected` signal (T01 finding, item 2) —
   * Constraints: "a view holding its own selected-event state is automatic
   * rejection" (decision 2). */
  private readonly selection = inject(TraceSelectionService);

  readonly NODE_WIDTH = NODE_WIDTH;
  readonly NODE_HEIGHT = NODE_HEIGHT;

  readonly nodes = computed(() => computeGraphNodes(this.chain()));
  readonly edges = computed(() => computeGraphEdges(this.chain()));
  readonly channel = computed(() => computeChannel(this.chain()));
  readonly completeness = computed(() =>
    computeChainCompleteness(this.chain())
  );

  private readonly nodesById = computed(() => {
    const map = new Map<string, IGraphNode>();
    for (const node of this.nodes()) {
      map.set(node.eventId, node);
    }
    return map;
  });

  readonly renderedEdges = computed<readonly IRenderedEdge[]>(() => {
    const byId = this.nodesById();
    const rendered: IRenderedEdge[] = [];
    for (const edge of this.edges()) {
      const points = computeEdgePoints(edge, byId);
      if (points) {
        rendered.push({ id: edge.id, dashed: edge.dashed, points });
      }
    }
    return rendered;
  });

  /** Shared node-extent bounding box, in graph coordinates — the single
   * source of truth for both `viewBox` (coordinate space) and
   * `graphWidth`/`graphHeight` (the SVG's intrinsic pixel size), so the two
   * never drift apart. */
  private readonly extents = computed(() => {
    const nodes = this.nodes();
    if (nodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        width: NODE_WIDTH + NODE_PAD_X * 2,
        height: NODE_HEIGHT + NODE_PAD_Y * 2,
      };
    }
    const minX =
      Math.min(...nodes.map((n) => n.x)) - NODE_WIDTH / 2 - NODE_PAD_X;
    const maxX =
      Math.max(...nodes.map((n) => n.x)) + NODE_WIDTH / 2 + NODE_PAD_X;
    const minY =
      Math.min(...nodes.map((n) => n.y)) - NODE_HEIGHT / 2 - NODE_PAD_Y;
    const maxY =
      Math.max(...nodes.map((n) => n.y)) + NODE_HEIGHT / 2 + NODE_PAD_Y;
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  });

  readonly viewBox = computed(() => {
    const { minX, minY, width, height } = this.extents();
    return `${minX} ${minY} ${width} ${height}`;
  });

  /** Intrinsic pixel width/height the SVG renders at — same extents as
   * `viewBox`, so the tree is drawn at full readable size and the
   * `.cg-svg-scroll` wrapper scrolls instead of scaling it down. */
  readonly graphWidth = computed(() => this.extents().width);
  readonly graphHeight = computed(() => this.extents().height);

  /** Selected-node highlight — reads the shared service's signal directly,
   * no local state (mirrors `TraceWaterfallComponent.isSelected`). */
  isSelected(node: IGraphNode): boolean {
    return this.selection.selectedEventId() === node.eventId;
  }

  /** Node click -> shared selection, sourced as "causal" — replaces the old
   * local toggle-open/toggle-closed `select()` (T01 finding: this component
   * used to own a `selected` signal and an inline detail card). The
   * inspector's own close (×) button / Esc handling now owns "closing" the
   * selection; a node click here always just (re-)selects. Verbose
   * logging: every new selection-triggering path logs the node it
   * selected. */
  onNodeClick(node: IGraphNode): void {
    console.debug("[CausalGraphComponent] node clicked, selecting event", {
      eventId: node.eventId,
      kind: node.kind,
      correlationId: this.chain().correlation_id,
    });
    this.selection.select(node.eventId, "causal");
  }
}
