import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  type IRunCastEntry,
  type IRunResponse,
  RunViewService,
} from "../../../core/services/run-view.service";
import type { IWorkflowDefinitionDto } from "../../automation/workflows/services/workflow-api.service";
import { layoutRun } from "./domain/layout-run";
import { mergeRun } from "./domain/merge-run";
import type { ILayoutNode, IRunLayout } from "./domain/run-view.model";
import { RunViewPopupComponent } from "./run-view-popup.component";
import type { IAnchorRect } from "./run-view-popup-render";
import {
  computeForkCollapseChips,
  computeNodePositions,
  computeRenderedEdges,
  computeViewBox,
  formatDecisionSubtitle,
  formatNodeStatusLabel,
  formatRunStatusChip,
  type IPositionedNode,
  NODE_HEIGHT,
  NODE_WIDTH,
  resolveCastColor,
} from "./run-view-render";

/** View state for the component's own fetch (T04 owns the seam per
 * SPEC.md T04: "recommend the component receives `workflowId`/`runId`
 * inputs and fetches via RunViewService internally" — both planned entries
 * (T06: Executions row click, trace "Run view" tab) resolve ids, not a
 * ready-made `IRunResponse`, so a single internal fetch here avoids two
 * near-identical fetch wrappers at the call sites). */
type RunState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "loaded";
      readonly run: IRunResponse;
      readonly layout: IRunLayout;
    };

/**
 * Run view flow (T04 of `manual-loops/run-view.md`): renders T03's pure
 * `IRunLayout` geometry model as inline SVG (sparkline/causal-graph
 * precedent — geometry in `computed()`, `[attr.*]` bindings, no chart
 * lib), plus the header chips and cast strip DESIGN-run-view.md specifies.
 * Node click emits the clicked node for T05's popup; this component owns
 * no popup itself.
 */
@Component({
  selector: "app-run-view",
  imports: [RouterLink, RunViewPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state().kind) {
      @case ("loading") {
        <p class="rv-status" role="status">Loading run…</p>
      }
      @case ("error") {
        <p class="rv-status rv-status-error" role="alert">
          Failed to load run.
        </p>
      }
      @case ("loaded") {
        <div class="rv">
          @if (layout().degraded) {
            <p class="rv-degraded-banner" role="status">
              Step detail unavailable for this run
            </p>
          }

          <header class="rv-chips">
            <span class="rv-chip">
              <span class="rv-chip-label">workflow</span>
              <span class="rv-chip-value">{{ workflowName() }}</span>
            </span>
            <span class="rv-chip">
              <span class="rv-chip-label">run</span>
              <span class="rv-chip-value rv-mono">{{ runId() }}</span>
            </span>
            <span class="rv-chip">
              <span class="rv-chip-label">status</span>
              <span class="rv-chip-value">{{ statusChip() }}</span>
            </span>
            <span class="rv-chip">
              <span class="rv-chip-label">duration</span>
              <span class="rv-chip-value"
                >{{ run().summary.total_ms }} ms</span
              >
            </span>
            @if (entryChannel(); as channel) {
              <span class="rv-chip">
                <span class="rv-chip-label">entry / channel</span>
                <span class="rv-chip-value">{{ channel }}</span>
              </span>
            }
            <span class="rv-chip">
              <span class="rv-chip-label">correlation</span>
              <a
                class="rv-chip-value rv-mono"
                [routerLink]="['/processes/trace', run().correlation_id]"
              >
                {{ run().correlation_id }}
              </a>
            </span>
          </header>

          <div class="rv-cast" role="group" aria-label="Cast">
            @for (entry of run().cast; track entry.id) {
              <button
                type="button"
                class="rv-cast-chip"
                [class.rv-cast-chip--selected]="selectedInstanceId() === entry.id"
                [attr.data-color]="resolveCastColor(entry.kind)"
                (click)="toggleHighlight(entry)"
              >
                <span class="rv-cast-kind">{{ entry.kind }}</span>
                <span class="rv-cast-name">{{ entry.name }}</span>
                <span class="rv-cast-count">×{{ entry.count }}</span>
              </button>
            }
          </div>

          <svg
            class="rv-svg"
            [attr.viewBox]="viewBox()"
            role="img"
            aria-label="Run flow"
          >
            @for (edge of renderedEdges(); track edge.id) {
              <g class="rv-edge" [class.rv-edge-dashed]="edge.dashed" [class.rv-edge-thick]="edge.thick">
                <line
                  [attr.x1]="edge.x1"
                  [attr.y1]="edge.y1"
                  [attr.x2]="edge.x2"
                  [attr.y2]="edge.y2"
                />
                @if (edge.label) {
                  <text
                    class="rv-edge-label"
                    [attr.x]="(edge.x1 + edge.x2) / 2"
                    [attr.y]="(edge.y1 + edge.y2) / 2"
                  >
                    {{ edge.label }}
                  </text>
                }
              </g>
            }

            @for (node of positionedNodes(); track node.id) {
              <g
                class="rv-node"
                [class.rv-node-dashed]="node.dashed"
                [class.rv-node-highlighted]="isHighlighted(node)"
                [attr.data-kind]="node.kind"
                [attr.data-color]="node.color"
                [attr.data-status]="node.status"
                [attr.transform]="'translate(' + node.x + ',' + node.y + ')'"
                (click)="onNodeClick(node, $event)"
              >
                <rect
                  class="rv-node-rect"
                  [attr.width]="nodeWidth"
                  [attr.height]="nodeHeight"
                  rx="6"
                />
                <text class="rv-node-label" x="10" y="18">
                  {{ node.label }}
                </text>
                <text class="rv-node-status" x="10" y="34">
                  {{ formatNodeStatusLabel(node.status) }}
                  @if (node.durationMs !== null) {
                    · {{ node.durationMs }}ms
                  }
                </text>
                @if (decisionSubtitle(node); as subtitle) {
                  <text class="rv-node-subtitle" x="10" [attr.y]="nodeHeight + 14">
                    {{ subtitle }}
                  </text>
                }
              </g>
            }

            @for (chip of forkChips(); track chip.forkId) {
              <text
                class="rv-fork-chip"
                [attr.x]="chip.x"
                [attr.y]="chip.y"
              >
                {{ chip.text }}
              </text>
            }
          </svg>

          @if (selectedNode(); as node) {
            <app-run-view-popup
              [run]="run()"
              [node]="node"
              [anchorRect]="anchorRect()!"
              [definition]="definition()"
              (closed)="closePopup()"
            />
          }
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .rv {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .rv-status {
      font-size: 13px;
      color: var(--text3, #888);
    }
    .rv-status-error {
      color: var(--red, #b3261e);
    }
    .rv-degraded-banner {
      margin: 0;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--amber-bg, #fff3cd);
      color: var(--amber-text, #7a5900);
      font-size: 12px;
    }
    .rv-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      border: 1px solid var(--border-subtle, #ddd);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
    }
    .rv-chip {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .rv-chip-label {
      color: var(--text3, #888);
      font-size: 11px;
    }
    .rv-chip-value {
      font-weight: 500;
    }
    .rv-mono {
      font-family: var(--font-mono, monospace);
    }
    .rv-cast {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .rv-cast-chip {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--border, #185fa5);
      background: var(--bg, #fff);
      cursor: pointer;
      font-size: 11px;
    }
    .rv-cast-chip--selected {
      outline: 2px solid var(--accent, #185fa5);
    }
    .rv-cast-chip[data-color="platform"] {
      border-color: #868e96;
    }
    .rv-cast-chip[data-color="agent"] {
      border-color: #8a63d2;
    }
    .rv-cast-chip[data-color="channel"] {
      border-color: #1a9e8f;
    }
    .rv-svg {
      width: 100%;
      min-height: 320px;
      background: var(--bg2, #f8f9fa);
      border-radius: 8px;
    }
    .rv-edge line {
      stroke: #495057;
      stroke-width: 1.5;
    }
    .rv-edge-dashed line {
      stroke: #adb5bd;
      stroke-dasharray: 4 3;
    }
    .rv-edge-thick line {
      stroke-width: 3;
    }
    .rv-edge-label {
      font-size: 9px;
      fill: #868e96;
      text-anchor: middle;
    }
    .rv-node {
      cursor: pointer;
    }
    .rv-node-rect {
      fill: #fff;
      stroke: #868e96;
      stroke-width: 1.5;
    }
    .rv-node[data-color="decision"] .rv-node-rect {
      fill: #fff8e1;
      stroke: #b8860b;
    }
    .rv-node[data-color="agent"] .rv-node-rect {
      fill: #f3edfb;
      stroke: #8a63d2;
    }
    .rv-node[data-color="channel"] .rv-node-rect {
      fill: #e6f7f5;
      stroke: #1a9e8f;
    }
    .rv-node-dashed .rv-node-rect {
      stroke-dasharray: 4 3;
    }
    .rv-node-highlighted .rv-node-rect {
      stroke-width: 3;
    }
    .rv-node-label {
      font-size: 11px;
      font-weight: 600;
    }
    .rv-node-status {
      font-size: 10px;
      fill: #868e96;
    }
    .rv-node-subtitle {
      font-size: 10px;
      fill: #7a5900;
    }
    .rv-fork-chip {
      font-size: 11px;
      fill: #495057;
    }
  `,
})
export class RunViewComponent {
  private readonly runViewService = inject(RunViewService);

  readonly workflowId = input.required<string>();
  readonly runId = input.required<string>();

  /** T06 finding fix (`manual-loops/run-view.md`): `workflowId` is the
   * TEMPORAL workflow id (`{tenantId}:{name}:{nanoid}}` per
   * `workflows.service.ts#executeWorkflow`) — it is NOT the workflow
   * DEFINITION id `WorkflowApiService.get`/`getDefinition` need (those are
   * separate `nanoid()`s minted independently in `workflow_definitions.id`,
   * confirmed via `workflows.postgres.repository.ts`). Passing `workflowId`
   * to `getDefinition` 404s in production. There is no reliable way to
   * derive the definition id from the Temporal id by parsing (the last
   * colon segment is the per-execution nanoid/idempotency key, not the
   * definition id) — so callers that KNOW the definition id (e.g. the
   * Executions list, which is already scoped by it) pass it explicitly via
   * this optional input. Callers that don't (e.g. the trace "Run view" tab,
   * which only has the Temporal ids from the chain) leave it unset and the
   * component degrades gracefully: no definition fetch, no 404, header
   * shows the raw workflow id instead of the name. */
  readonly definitionId = input<string | undefined>(undefined);

  /** T05 consumes the clicked node to open its anchored popup — this
   * component stays popup-free (SPEC.md T04: "leave a clean output, no
   * popup here"). */
  readonly nodeSelected = output<ILayoutNode>();

  readonly nodeWidth = NODE_WIDTH;
  readonly nodeHeight = NODE_HEIGHT;

  protected readonly state = signal<RunState>({ kind: "loading" });
  private readonly selected = signal<string | null>(null);
  readonly selectedInstanceId = computed(() => this.selected());

  /** DESIGN-run-view.md §Layout: header chip shows "workflow name +
   * definition version". The definition version does not exist in the
   * backend API (T02 finding, escalated separately) — this holds the
   * FULL definition (`name` for the header chip, `actions`/`application`
   * for T05's "workflow definition" peek), falling back to the raw id for
   * the header chip while loading or if the definition fetch fails. */
  private readonly definitionSignal = signal<IWorkflowDefinitionDto | null>(
    null
  );
  readonly definition = computed(() => this.definitionSignal());
  readonly workflowName = computed(
    () => this.definitionSignal()?.name ?? this.workflowId()
  );

  /** T05's popup state: the clicked node (`null` = closed) and the DOM
   * rect of the `<g>` that was clicked, captured on click so the popup
   * can anchor beside it (SPEC.md T05: "anchored to the clicked step").
   * Reset whenever the run identity changes so a stale popup never
   * survives a workflowId/runId navigation. */
  private readonly selectedNodeSignal = signal<ILayoutNode | null>(null);
  readonly selectedNode = computed(() => this.selectedNodeSignal());
  private readonly anchorRectSignal = signal<IAnchorRect | null>(null);
  readonly anchorRect = computed(() => this.anchorRectSignal());

  constructor() {
    effect(() => {
      const workflowId = this.workflowId();
      const runId = this.runId();
      const definitionId = this.definitionId();
      this.state.set({ kind: "loading" });
      this.selected.set(null);
      this.definitionSignal.set(null);
      this.selectedNodeSignal.set(null);
      this.anchorRectSignal.set(null);
      this.runViewService.getRun(workflowId, runId).subscribe({
        next: (run) => {
          if (!definitionId) {
            // No definition id known by this entry (T06 finding fix) —
            // skip the fetch entirely rather than 404 against the
            // TEMPORAL workflowId. Merge with an empty action list:
            // `mergeRun` detects the empty definition and falls back to its
            // events-only spine (executed steps only, flat, no
            // plan-vs-executed dashed overlay — see merge-run.ts's
            // `buildStepsFromEvents`), and the header falls back to the raw
            // id via `workflowName()`.
            const merged = mergeRun(run.events, run.spans, { actions: [] });
            const layout = layoutRun(merged);
            this.state.set({ kind: "loaded", run, layout });
            return;
          }
          this.runViewService.getDefinition(definitionId).subscribe({
            next: (definition) => {
              this.definitionSignal.set(definition);
              const merged = mergeRun(run.events, run.spans, definition);
              const layout = layoutRun(merged);
              this.state.set({ kind: "loaded", run, layout });
            },
            error: () => this.state.set({ kind: "error" }),
          });
        },
        error: (err: HttpErrorResponse) => {
          void err;
          this.state.set({ kind: "error" });
        },
      });
    });
  }

  readonly run = computed<IRunResponse>(() => {
    const s = this.state();
    if (s.kind !== "loaded") {
      throw new Error("run-view: run() read before loaded state");
    }
    return s.run;
  });

  readonly layout = computed<IRunLayout>(() => {
    const s = this.state();
    if (s.kind !== "loaded") {
      throw new Error("run-view: layout() read before loaded state");
    }
    return s.layout;
  });

  readonly positionedNodes = computed<readonly IPositionedNode[]>(() =>
    computeNodePositions(this.layout().nodes)
  );

  private readonly positionsById = computed(() => {
    const map = new Map<string, IPositionedNode>();
    for (const node of this.positionedNodes()) {
      map.set(node.id, node);
    }
    return map;
  });

  readonly renderedEdges = computed(() =>
    computeRenderedEdges(this.layout().edges, this.positionsById())
  );

  readonly forkChips = computed(() =>
    computeForkCollapseChips(this.layout().forks, this.positionsById())
  );

  readonly viewBox = computed(() =>
    computeViewBox(this.positionedNodes(), this.forkChips())
  );

  readonly notExecutedCount = computed(
    () => this.layout().nodes.filter((n) => n.dashed).length
  );

  readonly statusChip = computed(() =>
    formatRunStatusChip(this.run().summary, this.notExecutedCount())
  );

  /** DESIGN.md header: "entry/channel" — the run's channel-kind cast
   * entry (the workflow's channel trigger/send actor), when present. */
  readonly entryChannel = computed(() => {
    const channelEntry = this.run().cast.find((c) => c.kind === "channel");
    return channelEntry?.name ?? null;
  });

  resolveCastColor = resolveCastColor;
  formatNodeStatusLabel = formatNodeStatusLabel;

  decisionSubtitle(node: ILayoutNode): string | null {
    return formatDecisionSubtitle(node);
  }

  isHighlighted(node: ILayoutNode): boolean {
    const selected = this.selected();
    return selected !== null && node.instanceId === selected;
  }

  /** Cast chip click toggles highlight of that instance's steps
   * (DESIGN.md: "Click = highlight that artifact's steps in the flow").
   * Clicking the already-selected chip clears the highlight. */
  toggleHighlight(entry: IRunCastEntry): void {
    this.selected.set(this.selected() === entry.id ? null : entry.id);
  }

  /** Emits the clicked node (unchanged output contract T04 shipped) AND
   * opens T05's own popup, anchored to the clicked `<g>`'s screen rect. */
  onNodeClick(node: ILayoutNode, event: MouseEvent): void {
    const target = event.currentTarget as Element | null;
    const rect = target?.getBoundingClientRect();
    this.anchorRectSignal.set(
      rect
        ? {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
    );
    this.selectedNodeSignal.set(node);
    this.nodeSelected.emit(node);
  }

  closePopup(): void {
    this.selectedNodeSignal.set(null);
    this.anchorRectSignal.set(null);
  }
}
