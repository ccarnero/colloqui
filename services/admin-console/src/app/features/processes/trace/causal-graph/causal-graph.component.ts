import type { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";
import { AuthService } from "../../../../core/services/auth.service";
import {
  type IEventPayloadResponse,
  type ITrackedEvent,
  type ITrackingChainResponse,
  TrackingChainService,
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

/** Tenant-admin permission gating the payload viewer (SPEC.md
 * `manual-loops/payload-capture.md` T05 — reuses the console's existing
 * `AuthService.hasPermission()` gate, same mechanism as
 * `message-trace.component.ts`'s `diagnostics:read` gate). */
const PAYLOAD_PERMISSION = "tracking:payload:read";

/** Local view-state for the on-demand payload fetch, keyed to whichever
 * event is currently selected — reset whenever the selection changes. */
type PayloadViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly response: IEventPayloadResponse }
  | { readonly kind: "expired" }
  | { readonly kind: "not-captured"; readonly message: string }
  | { readonly kind: "error" };

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
 * for the solo-correlation case, and clicking a node opens a detail card
 * (SPEC.md `manual-loops/trace-console.md` T06). The detail card also hosts
 * an admin-only "View payload" affordance that fetches the event's payload
 * on demand (SPEC.md `manual-loops/payload-capture.md` T05).
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

            @if (canViewPayload()) {
              <div class="cg-payload">
                <button
                  type="button"
                  class="cg-payload-btn"
                  (click)="viewPayload(event.event_id)"
                >
                  View payload
                </button>

                @switch (payloadState().kind) {
                  @case ("loading") {
                    <p class="cg-payload-status">Loading payload…</p>
                  }
                  @case ("expired") {
                    <p class="cg-payload-status">
                      Payload expired (30-day retention)
                    </p>
                  }
                  @case ("not-captured") {
                    <p class="cg-payload-status">
                      {{ notCapturedMessage() }}
                    </p>
                  }
                  @case ("error") {
                    <p class="cg-payload-status cg-payload-error">
                      Failed to load payload.
                    </p>
                  }
                  @case ("loaded") {
                    <details class="cg-payload-details">
                      <summary>
                        Payload ({{ loadedResponse()?.payload_status }})
                      </summary>
                      <pre class="cg-payload-pre">{{ payloadJson() }}</pre>
                    </details>
                  }
                }
              </div>
            }
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
    .cg-svg-scroll {
      flex: 1 1 auto;
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
    .cg-payload {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border-subtle, #ddd);
    }
    .cg-payload-btn {
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid var(--border, #185fa5);
      border-radius: 6px;
      background: var(--bg, #fff);
      color: #185fa5;
      cursor: pointer;
    }
    .cg-payload-status {
      margin: 8px 0 0;
      color: var(--text3, #888);
    }
    .cg-payload-error {
      color: var(--red, #b3261e);
    }
    .cg-payload-details {
      margin-top: 8px;
    }
    .cg-payload-pre {
      margin: 6px 0 0;
      padding: 8px;
      background: var(--bg2, #f8f9fa);
      border-radius: 6px;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `,
})
export class CausalGraphComponent {
  private readonly auth = inject(AuthService);
  private readonly trackingChainService = inject(TrackingChainService);

  readonly chain = input.required<ITrackingChainResponse>();

  readonly NODE_WIDTH = NODE_WIDTH;
  readonly NODE_HEIGHT = NODE_HEIGHT;

  private readonly selected = signal<string | null>(null);
  readonly selectedEventId = computed(() => this.selected());

  /** Gates the "View payload" action — SPEC.md `manual-loops/payload-capture.md`
   * T05: "visible only when the session user has the admin permission". */
  readonly canViewPayload = computed(() =>
    this.auth.hasPermission(PAYLOAD_PERMISSION)
  );

  private readonly payload = signal<PayloadViewState>({ kind: "idle" });
  readonly payloadState = computed(() => this.payload());

  readonly loadedResponse = computed<IEventPayloadResponse | null>(() => {
    const state = this.payload();
    return state.kind === "loaded" ? state.response : null;
  });

  readonly payloadJson = computed(() => {
    const response = this.loadedResponse();
    return response ? JSON.stringify(response.payload, null, 2) : "";
  });

  readonly notCapturedMessage = computed(() => {
    const state = this.payload();
    return state.kind === "not-captured" ? state.message : "";
  });

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

  readonly selectedEvent = computed<ITrackedEvent | null>(() => {
    const id = this.selected();
    if (!id) {
      return null;
    }
    return this.chain().events.find((event) => event.event_id === id) ?? null;
  });

  select(eventId: string): void {
    const next = this.selected() === eventId ? null : eventId;
    this.selected.set(next);
    // Selecting a different event (or closing the card) discards any
    // in-flight/loaded payload state — the viewer never carries state across
    // events (SPEC.md `manual-loops/payload-capture.md` T05: fetch on demand,
    // never pre-fetched).
    this.payload.set({ kind: "idle" });
  }

  /**
   * Fetches the selected event's payload on demand via
   * `TrackingChainService.getEventPayload` — never pre-fetched with the
   * chain. Maps the gateway's `payload_status`-driven HTTP responses (T04:
   * 200 body, 404 unresolved/none/unknown, 410 scrubbed) to view state.
   */
  viewPayload(eventId: string): void {
    const correlationId = this.chain().correlation_id;
    this.payload.set({ kind: "loading" });
    this.trackingChainService
      .getEventPayload(correlationId, eventId)
      .subscribe({
        next: (response) => this.payload.set({ kind: "loaded", response }),
        error: (err: HttpErrorResponse) => {
          if (err.status === 410) {
            this.payload.set({ kind: "expired" });
            return;
          }
          if (err.status === 404) {
            // The gateway/ingester distinguish unresolved/none/unknown-event
            // only via the `error` message text (handle-payload-request.ts) —
            // surface the claim-check-specific message when detectable, else
            // a generic not-captured message.
            const reason =
              typeof err.error?.error === "string" ? err.error.error : "";
            const message = reason.includes("unresolved")
              ? "Payload was not captured (claim-check expired)"
              : "Payload was not captured";
            this.payload.set({ kind: "not-captured", message });
            return;
          }
          this.payload.set({ kind: "error" });
        },
      });
  }
}
