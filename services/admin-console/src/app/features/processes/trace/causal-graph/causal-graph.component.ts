import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from "@angular/core";
import type {
  ITrackedEvent,
  ITrackingChainResponse,
} from "../../../../core/services/tracking-chain.service";
import {
  computeChainCompleteness,
  computeChannel,
  computeEdgePoints,
  computeGraphEdges,
  computeGraphNodes,
  type IGraphEdgePoints,
  type IGraphNode,
} from "./causal-graph-geometry";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 52;
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
 * for the solo-correlation case, and clicking a node opens a detail card
 * (SPEC.md `manual-loops/trace-console.md` T06).
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

      <div class="cg-body">
        <svg
          class="cg-svg"
          [attr.viewBox]="viewBox()"
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
              [class.cg-node-selected]="node.eventId === selectedEventId()"
              [attr.transform]="'translate(' + (node.x - NODE_WIDTH / 2) + ',' + (node.y - NODE_HEIGHT / 2) + ')'"
              (click)="select(node.eventId)"
            >
              <rect
                class="cg-node-rect"
                [attr.width]="NODE_WIDTH"
                [attr.height]="NODE_HEIGHT"
                rx="8"
              />
              <text class="cg-node-line1" [attr.x]="NODE_WIDTH / 2" y="20">
                {{ node.kind }}
              </text>
              <text class="cg-node-line2" [attr.x]="NODE_WIDTH / 2" y="38">
                {{ node.producer }} · t+{{ node.offsetMs }}ms
              </text>
            </g>
          }
        </svg>

        @if (selectedEvent(); as event) {
          <aside class="cg-detail" aria-label="Event detail">
            <h3 class="cg-detail-title">Event detail</h3>
            <dl class="cg-detail-list">
              <dt>event_id</dt>
              <dd class="cg-mono">{{ event.event_id }}</dd>
              <dt>causation_id</dt>
              <dd class="cg-mono">{{ event.causation_id ?? "—" }}</dd>
              <dt>tech</dt>
              <dd>{{ event.tech }}</dd>
              <dt>business_fn</dt>
              <dd>{{ event.business_fn }}</dd>
              <dt>causation_depth</dt>
              <dd>{{ event.causation_depth ?? "—" }}</dd>
              <dt>is_claim_check</dt>
              <dd>{{ event.is_claim_check }}</dd>
              <dt>compliance</dt>
              <dd>
                {{ event.compliance }}
                @if (event.tenant === null) {
                  <span class="cg-flag">null tenant</span>
                }
              </dd>
            </dl>
          </aside>
        }
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
    .cg-body {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .cg-svg {
      flex: 1 1 auto;
      min-height: 300px;
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
    .cg-detail {
      flex: 0 0 260px;
      border: 1px solid var(--border-subtle, #ddd);
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 12px;
    }
    .cg-detail-title {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .cg-detail-list {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 8px;
      margin: 0;
    }
    .cg-detail-list dt {
      color: var(--text3, #888);
    }
    .cg-detail-list dd {
      margin: 0;
      word-break: break-all;
    }
    .cg-flag {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--red-bg, #fbe9e7);
      color: var(--red, #b3261e);
      font-size: 10px;
    }
  `,
})
export class CausalGraphComponent {
  readonly chain = input.required<ITrackingChainResponse>();

  readonly NODE_WIDTH = NODE_WIDTH;
  readonly NODE_HEIGHT = NODE_HEIGHT;

  private readonly selected = signal<string | null>(null);
  readonly selectedEventId = computed(() => this.selected());

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

  readonly viewBox = computed(() => {
    const nodes = this.nodes();
    if (nodes.length === 0) {
      return `0 0 ${NODE_WIDTH + NODE_PAD_X * 2} ${NODE_HEIGHT + NODE_PAD_Y * 2}`;
    }
    const minX =
      Math.min(...nodes.map((n) => n.x)) - NODE_WIDTH / 2 - NODE_PAD_X;
    const maxX =
      Math.max(...nodes.map((n) => n.x)) + NODE_WIDTH / 2 + NODE_PAD_X;
    const minY =
      Math.min(...nodes.map((n) => n.y)) - NODE_HEIGHT / 2 - NODE_PAD_Y;
    const maxY =
      Math.max(...nodes.map((n) => n.y)) + NODE_HEIGHT / 2 + NODE_PAD_Y;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  });

  readonly selectedEvent = computed<ITrackedEvent | null>(() => {
    const id = this.selected();
    if (!id) {
      return null;
    }
    return this.chain().events.find((event) => event.event_id === id) ?? null;
  });

  select(eventId: string): void {
    this.selected.set(this.selected() === eventId ? null : eventId);
  }
}
