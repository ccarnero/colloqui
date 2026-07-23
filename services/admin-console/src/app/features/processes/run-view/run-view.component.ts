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
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "../../automation/workflows/services/workflow-api.service";
import { TraceSelectionService } from "../trace/trace-selection.service";
import { layoutRun } from "./domain/layout-run";
import { mergeRun } from "./domain/merge-run";
import { resolveSelectedStepDeepLink } from "./domain/resolve-selected-step-deep-link";
import { resolveSelectedStepResult } from "./domain/resolve-selected-step-result";
import { resolveStepEvents } from "./domain/resolve-step-events";
import type { ILayoutNode, IRunLayout } from "./domain/run-view.model";
import { RunViewPopupComponent } from "./run-view-popup.component";
import type { IAnchorRect } from "./run-view-popup-render";
import {
  ARTIFACT_BOX_HEIGHT,
  ARTIFACT_BOX_WIDTH,
  computeArtifactBoxes,
  computeArtifactEdges,
  computeColumnHeaders,
  computeContentWidth,
  computeForkCollapseChips,
  computeNodePositions,
  computeRenderedEdges,
  computeViewBox,
  formatNodeStatusBadge,
  formatPillLabel,
  formatRunStatusChip,
  type IArtifactBox,
  type IPositionedNode,
  isPillNode,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeSubLabel,
  PILL_HEIGHT,
  PILL_WIDTH,
  pillOffsetX,
  resolveCastColor,
  resolveEntryChannel,
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
 *
 * T05 (`manual-loops/admin-console/console-redesign-trace.md`) restyles
 * this renderer's colors onto the trace redesign's `--rd-*` tokens (see
 * the `:host` style block below) and adds TRACE-HOSTED selection: this
 * component is used in TWO contexts — the trace screen's "run" tab
 * (`TraceDetailComponent` component-provides `TraceSelectionService`) and
 * the STANDALONE `/processes/runs/:workflowId/:runId` route
 * (`RunViewPageComponent`, no such provider). `selection` below is
 * injected `{ optional: true }` so ONE component correctly serves both:
 * trace-hosted mode routes node clicks through the shared service instead
 * of opening the local popup (decision 2: "the node-click popup flow is
 * REPLACED by inspector selection"); standalone mode is completely
 * unchanged (the pre-existing T05 popup flow, out of this loop's redesign
 * scope per the task instructions).
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
            [class.rv-has-selection]="selectedInstanceId() !== null"
            [attr.viewBox]="viewBox()"
            preserveAspectRatio="xMinYMin meet"
            [style.width.px]="contentWidth()"
            role="img"
            aria-label="Run flow"
          >
            <defs>
              <marker
                id="rv-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 9 5 L 0 9 z" class="rv-arrow-head" />
              </marker>
            </defs>

            <text
              class="rv-column-header"
              [attr.x]="columnHeaders().spineX"
              [attr.y]="columnHeaders().y"
            >
              workflow run
            </text>
            @if (artifactBoxes().length > 0) {
              <text
                class="rv-column-header"
                [attr.x]="columnHeaders().artifactX"
                [attr.y]="columnHeaders().y"
              >
                artifacts
              </text>
            }

            @for (edge of renderedEdges(); track edge.id) {
              <g class="rv-edge" [class.rv-edge-dashed]="edge.dashed" [class.rv-edge-thick]="edge.thick" [attr.data-kind]="edge.kind">
                <line
                  [attr.x1]="edge.x1"
                  [attr.y1]="edge.y1"
                  [attr.x2]="edge.x2"
                  [attr.y2]="edge.y2"
                  marker-end="url(#rv-arrow)"
                />
                @if (edge.label) {
                  <text
                    class="rv-edge-label"
                    [attr.x]="edge.labelX"
                    [attr.y]="edge.labelY"
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
                [class.rv-node-trace-selected]="isTraceSelected(node)"
                [class.rv-node-pill]="isPillNode(node.kind)"
                [attr.data-kind]="node.kind"
                [attr.data-color]="node.color"
                [attr.data-status]="node.status"
                [attr.transform]="'translate(' + node.x + ',' + node.y + ')'"
                (click)="onNodeClick(node, $event)"
              >
                @if (isPillNode(node.kind)) {
                  <rect
                    class="rv-node-rect rv-node-pill-rect"
                    [attr.x]="pillOffsetX()"
                    [attr.width]="pillWidth"
                    [attr.height]="pillHeight"
                    rx="15"
                  />
                  <text
                    class="rv-node-label rv-node-pill-label"
                    [attr.x]="nodeWidth / 2"
                    [attr.y]="pillHeight / 2 + 4"
                  >
                    {{ formatPillLabel(node) }}
                  </text>
                } @else {
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
                    {{ nodeSubLabel(node) }}
                  </text>
                  @if (node.kind !== "trigger") {
                    <!-- T05 status badge (real ActionStatus values only —
                         "ok"/"failed"/"not_executed", run-view.model.ts;
                         no glyph for the leading trigger node, which the
                         domain hardcodes to "ok" as a status-NEUTRAL
                         placeholder, per that field's own doc comment). -->
                    <text
                      class="rv-node-badge"
                      [attr.x]="nodeWidth - 10"
                      y="18"
                      text-anchor="end"
                    >
                      {{ formatNodeStatusBadge(node.status) }}
                    </text>
                  }
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

            @for (edge of artifactEdges(); track edge.id) {
              <g
                class="rv-artifact-edge"
                [class.rv-artifact-edge-dashed]="edge.dashed"
                [attr.data-direction]="edge.direction"
              >
                <line
                  [attr.x1]="edge.x1"
                  [attr.y1]="edge.y1"
                  [attr.x2]="edge.x2"
                  [attr.y2]="edge.y2"
                  marker-end="url(#rv-arrow)"
                />
                <text class="rv-edge-label" [attr.x]="edge.labelX" [attr.y]="edge.labelY">
                  {{ edge.label }}
                </text>
              </g>
            }

            @for (box of artifactBoxes(); track box.stepId) {
              <g
                class="rv-artifact-box"
                [class.rv-artifact-box-highlighted]="isArtifactHighlighted(box)"
                [attr.data-color]="box.color"
                [attr.transform]="'translate(' + box.x + ',' + box.y + ')'"
                (click)="onArtifactClick(box, $event)"
              >
                <rect
                  class="rv-artifact-rect"
                  [attr.width]="artifactBoxWidth"
                  [attr.height]="artifactBoxHeight"
                  rx="6"
                />
                <text class="rv-artifact-label" x="10" y="18">
                  {{ box.label }}
                </text>
                <text class="rv-artifact-sublabel" x="10" y="34">
                  {{ box.subLabel }}
                </text>
              </g>
            }
          </svg>

          <div class="rv-legend">
            <p class="rv-legend-line">
              solid = request / taken · dashed = response / not executed · thick = critical path · amber = decision
            </p>
            <p class="rv-legend-line">
              ↔ = collapsed artifact (click to expand) · gray = platform · purple = agent · teal = channel
            </p>
          </div>

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
      /* T05 restyle (\`manual-loops/admin-console/console-redesign-trace.md\`):
       * node/pill fill+border per DESIGN-run-view.md's color table
       * (gray=platform, amber=decision, purple=agent, teal=channel), now
       * mapped to the trace redesign's \`--rd-*\` tokens
       * (services/admin-console/src/styles.scss) instead of the console's
       * legacy \`--bg3\`/\`--border2\`/\`--yellow\`/\`--purple\`/\`--cyan\`
       * globals every other restyled trace view already moved off of
       * (\`trace-waterfall.component.ts\`, \`causal-graph.component.ts\`,
       * \`step-log.component.ts\`) — same "resolve colors from tokens at
       * runtime via CSS custom properties" approach this file already used,
       * just re-pointed at the new token namespace, not a rewrite of the
       * mechanism. "channel = teal" reuses \`--rd-green\` (no separate
       * \`--rd-cyan\` token exists) — the SAME choice the waterfall legend
       * already made for its "channel" business-fn group
       * (\`--rd-group-channel: var(--rd-green)\`, styles.scss), so a channel
       * step now reads the same hue across trace views instead of
       * introducing a third teal token nobody else uses. \`--rd-purple-dim\`/
       * \`--rd-orange\`/\`--rd-orange-dim\` are new tokens this task adds to
       * styles.scss (documented there) since the \`--rd-*\` palette had no
       * purple tint or brand-orange transcription yet. */
      --rv-gray-fill: var(--rd-panel);
      --rv-gray-border: var(--rd-line-3);
      --rv-amber-fill: var(--rd-yellow-dim);
      --rv-amber-border: var(--rd-yellow);
      --rv-purple-fill: var(--rd-purple-dim);
      --rv-purple-border: var(--rd-purple);
      --rv-teal-fill: var(--rd-green-dim);
      --rv-teal-border: var(--rd-green);
      --rv-edge-stroke: var(--rd-text-3);
      --rv-critical-stroke: var(--rd-purple);
      /* BUG 2 fix (unchanged behavior, restyled token): cast-chip highlight
       * accent — \`--rd-orange\` transcribes the same fixed brand orange
       * (\`--accent-yz\`) into the \`--rd-*\` namespace, distinct from every
       * node color (gray/amber/purple/teal) AND from the trace-selection
       * accent below, so a cast-highlighted node/artifact box stays
       * unambiguous on both themes and next to a cross-view selection. */
      --rv-highlight: var(--rd-orange);
      /* T05: cross-view selection ring (node click -> shared
       * TraceSelectionService, trace-hosted mode only) — \`--rd-accent\`, the
       * SAME accent color the waterfall/causal-graph/step-log selection
       * highlight already uses (their \`--rd-accent\`/\`--rd-accent-soft\`
       * outline), so a selected run-view node reads as "the same kind of
       * selection" as the other three views instead of a fourth new color. */
      --rv-trace-selected: var(--rd-accent);
    }
    .rv {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .rv-status {
      font-size: var(--rd-text-size-base, 13px);
      color: var(--rd-text-3, #7a7a7a);
    }
    .rv-status-error {
      color: var(--rd-red, #f5455c);
    }
    .rv-degraded-banner {
      margin: 0;
      padding: var(--rd-space-4, 8px) var(--rd-space-6, 12px);
      border-radius: var(--rd-radius-5, 6px);
      background: var(--rd-yellow-dim, #fff3cd);
      color: var(--rd-yellow, #7a5900);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .rv-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-7, 8px);
      padding: var(--rd-space-5, 10px) var(--rd-space-7, 14px);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .rv-chip {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .rv-chip-label {
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-xs, 11px);
    }
    .rv-chip-value {
      font-weight: 500;
      color: var(--rd-text-1, #ededed);
    }
    .rv-mono {
      font-family: var(--rd-font-mono, monospace);
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
      border-radius: var(--rd-radius-full, 999px);
      border: 1px solid var(--rd-line-3, #2e2e2e);
      background: var(--rd-panel, #0f0f0f);
      color: var(--rd-text-1, #ededed);
      cursor: pointer;
      font-size: var(--rd-text-size-xs, 11px);
    }
    .rv-cast-chip--selected {
      outline: 2px solid var(--rd-accent, #1a66ff);
    }
    /* Cast-chip kind border — same "channel reuses --rd-green" choice as
     * the node color table above (:host comment). */
    .rv-cast-chip[data-color="platform"] {
      border-color: var(--rd-line-3, #2e2e2e);
    }
    .rv-cast-chip[data-color="agent"] {
      border-color: var(--rd-purple, #bf7af0);
    }
    .rv-cast-chip[data-color="channel"] {
      border-color: var(--rd-green, #50e3a4);
    }
    .rv-svg {
      display: block;
      max-width: 100%;
      min-height: 320px;
      background: var(--rd-panel, #0f0f0f);
      border-radius: var(--rd-radius-7, 8px);
    }
    /* Arrow marker head — same fill as the default edge stroke; dashed
     * (not-executed/response) and thick (critical-path) edges recolor it
     * via the [data-kind]/[class] selectors below (mockup: one \`arr4\`
     * marker, edges vary stroke color/width/dash only). */
    .rv-arrow-head {
      fill: var(--rv-edge-stroke);
    }
    .rv-edge line {
      stroke: var(--rv-edge-stroke);
      stroke-width: 1.5;
    }
    /* not-executed / response edges — dashed (mockup: \`stroke-dasharray:
     * 5 4\`). */
    .rv-edge-dashed line {
      stroke-dasharray: 5 4;
    }
    /* critical-path / taken / bypass edges — thick, critical path also
     * recolors to the agent/accent token (mockup: \`#7F77DD\`, width 2.5). */
    .rv-edge-thick line {
      stroke-width: 2.5;
    }
    .rv-edge[data-kind="join-in"].rv-edge-thick line {
      stroke: var(--rv-critical-stroke);
    }
    .rv-edge[data-kind="join-in"].rv-edge-thick .rv-arrow-head {
      fill: var(--rv-critical-stroke);
    }
    .rv-edge-label {
      font-size: 10px;
      fill: var(--rv-edge-stroke);
      text-anchor: middle;
    }
    /* Slice 3: two-column header text ("workflow run" / "artifacts") atop
     * the spine and artifact columns respectively. */
    .rv-column-header {
      font-size: 11px;
      fill: var(--rd-text-3, #7a7a7a);
      text-anchor: middle;
    }
    /* Artifact request/response edge pair — same solid/dashed convention
     * as \`.rv-edge\`/\`.rv-edge-dashed\` (deliberately its OWN class, not
     * \`.rv-edge\`, so it stays out of \`.rv-edge\` step-count assertions —
     * these are the derived artifact-lane overlay, not domain edges). */
    .rv-artifact-edge line {
      stroke: var(--rv-edge-stroke);
      stroke-width: 1.5;
    }
    .rv-artifact-edge-dashed line {
      stroke-dasharray: 5 4;
    }
    /* Artifact box — same node-rect look/color table as a spine action box
     * (gray=connector, purple=agent, teal=channel), clickable to open the
     * same T05 popup as the underlying step. Own class (not \`.rv-node\`)
     * so it stays out of \`.rv-node\` step-count assertions. */
    .rv-artifact-box {
      cursor: pointer;
    }
    .rv-artifact-rect,
    .rv-artifact-box[data-color="platform"] .rv-artifact-rect {
      fill: var(--rv-gray-fill);
      stroke: var(--rv-gray-border);
      stroke-width: 1.5;
    }
    .rv-artifact-box[data-color="agent"] .rv-artifact-rect {
      fill: var(--rv-purple-fill);
      stroke: var(--rv-purple-border);
    }
    .rv-artifact-box[data-color="channel"] .rv-artifact-rect {
      fill: var(--rv-teal-fill);
      stroke: var(--rv-teal-border);
    }
    .rv-artifact-label {
      font-size: 11px;
      font-weight: 600;
      fill: var(--rd-text-1, #ededed);
    }
    .rv-artifact-sublabel {
      font-size: 10px;
      fill: var(--rd-text-3, #7a7a7a);
    }
    .rv-node {
      cursor: pointer;
    }
    /* platform = gray — DESIGN-run-view.md's color table (T04's own CSS
     * colors; the domain only assigns the semantic StepColor). */
    .rv-node-rect,
    .rv-node[data-color="platform"] .rv-node-rect {
      fill: var(--rv-gray-fill);
      stroke: var(--rv-gray-border);
      stroke-width: 1.5;
    }
    /* decision = amber */
    .rv-node[data-color="decision"] .rv-node-rect {
      fill: var(--rv-amber-fill);
      stroke: var(--rv-amber-border);
    }
    /* agent = purple */
    .rv-node[data-color="agent"] .rv-node-rect {
      fill: var(--rv-purple-fill);
      stroke: var(--rv-purple-border);
    }
    /* channel = teal */
    .rv-node[data-color="channel"] .rv-node-rect {
      fill: var(--rv-teal-fill);
      stroke: var(--rv-teal-border);
    }
    .rv-node-dashed .rv-node-rect {
      stroke-dasharray: 4 3;
    }
    /* T05 status coloring: real ActionStatus values only ("ok" | "failed" |
     * "not_executed", run-view.model.ts — there is no "running" state on a
     * loaded run's step, SPEC.md "Out of scope": loaded traces only). A
     * FAILED step's border recolors to \`--rd-red\` regardless of its own
     * kind color (gray/amber/purple/teal) — failure takes visual
     * precedence, same "override the kind border for a status that matters
     * more" precedent \`.rv-node-highlighted\`/\`.rv-node-trace-selected\`
     * below already establish. "ok"/"not_executed" keep their plain
     * kind-color border (not_executed is already distinguished by the
     * dashed rule above) — only the badge glyph (\`.rv-node-badge\` below)
     * carries their color. */
    .rv-node[data-status="failed"] .rv-node-rect {
      stroke: var(--rd-red, #f5455c);
      stroke-width: 2;
    }
    /* BUG 2 fix: the old rule only bumped \`stroke-width\` — imperceptible
     * on a node that is already bordered. Recolor to the dedicated
     * highlight accent + a soft glow so the selected step is unmistakable
     * regardless of its own gray/amber/purple/teal border. */
    .rv-node-highlighted .rv-node-rect {
      stroke: var(--rv-highlight);
      stroke-width: 3;
      filter: drop-shadow(0 0 3px rgba(253, 100, 33, 0.6));
    }
    /* T05: cross-view selection ring (node click -> shared
     * TraceSelectionService, trace-hosted mode only — SPEC.md "selected
     * node highlighted from the service signal"). Own selector, not
     * \`.rv-node-highlighted\` (that ring is the UNRELATED cast-chip
     * instance highlight — the two can be visually distinguished on the
     * few runs where both happen to apply, since they use different
     * accent tokens). */
    .rv-node-trace-selected .rv-node-rect {
      stroke: var(--rv-trace-selected);
      stroke-width: 3;
      filter: drop-shadow(0 0 3px var(--rd-accent-soft, rgba(26, 102, 255, 0.4)));
    }
    /* Same treatment for the paired right-column artifact box (BUG 2:
     * "also highlight the matching spine artifact box"). Own selector
     * (not reusing \`.rv-node-highlighted\`) since artifact boxes render
     * as a separate \`.rv-artifact-box\` element, not a \`.rv-node\`. */
    .rv-artifact-box-highlighted .rv-artifact-rect {
      stroke: var(--rv-highlight);
      stroke-width: 3;
      filter: drop-shadow(0 0 3px rgba(253, 100, 33, 0.6));
    }
    /* Optional dim: once a selection is active, fade every non-highlighted
     * node so the highlighted one(s) pop — subtle, not applied to edges or
     * artifact boxes (those already have their own highlight/no-highlight
     * treatment). */
    .rv-has-selection .rv-node:not(.rv-node-highlighted) {
      opacity: 0.45;
    }
    .rv-node-label {
      font-size: 11px;
      font-weight: 600;
      fill: var(--rd-text-1, #ededed);
    }
    .rv-node-status {
      font-size: 10px;
      fill: var(--rd-text-3, #7a7a7a);
    }
    /* T05 status badge glyph (formatNodeStatusBadge) — colored per the
     * SAME real-status attribute selector the border recoloring above uses
     * ([data-status], bound from the node's own ActionStatus), so the
     * badge and the border never disagree about a step's outcome. */
    .rv-node-badge {
      font-size: 11px;
      font-weight: 700;
    }
    .rv-node[data-status="ok"] .rv-node-badge {
      fill: var(--rd-green, #50e3a4);
    }
    .rv-node[data-status="failed"] .rv-node-badge {
      fill: var(--rd-red, #f5455c);
    }
    .rv-node[data-status="not_executed"] .rv-node-badge {
      fill: var(--rd-text-3, #7a7a7a);
    }
    .rv-fork-chip {
      font-size: 11px;
      fill: var(--rv-edge-stroke);
    }
    /* Fork/join pills (mockup: small rounded pill, not a full two-line
     * box — SPEC.md run-view visual rewrite slice 2, "Fork & join as
     * pills"). Always platform-gray regardless of \`data-color\` (both
     * kinds carry \`color: "platform"\` from the domain already). */
    .rv-node-pill-rect {
      fill: var(--rv-gray-fill);
      stroke: var(--rv-gray-border);
      stroke-width: 1.5;
    }
    .rv-node-pill-label {
      font-size: 12px;
      font-weight: 500;
      text-anchor: middle;
      fill: var(--rd-text-1, #ededed);
    }
    .rv-legend {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 0 4px;
    }
    .rv-legend-line {
      margin: 0;
      font-size: 11px;
      color: var(--rd-text-3, #7a7a7a);
    }
  `,
})
export class RunViewComponent {
  private readonly runViewService = inject(RunViewService);
  private readonly workflowApi = inject(WorkflowApiService);

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
  readonly pillWidth = PILL_WIDTH;
  readonly pillHeight = PILL_HEIGHT;
  isPillNode = isPillNode;
  formatPillLabel = formatPillLabel;
  pillOffsetX = pillOffsetX;
  formatNodeStatusBadge = formatNodeStatusBadge;

  /** Shared cross-view selection (T05 of
   * `manual-loops/admin-console/console-redesign-trace.md`) — OPTIONAL:
   * `RunViewComponent` is hosted in TWO contexts. In the trace screen's
   * "run" tab, `TraceDetailComponent` component-provides
   * `TraceSelectionService` (same provider scope
   * `TraceWaterfallComponent`/`CausalGraphComponent`/`StepLogComponent`
   * already use) and this component participates in the shared selection.
   * At the STANDALONE `/processes/runs/:workflowId/:runId` route
   * (`RunViewPageComponent`), no such provider exists at all. `{ optional:
   * true }` is the only way one component correctly serves both: in
   * standalone mode `this.selection` is `null` and the pre-existing local
   * popup flow (`selectedNodeSignal`/`anchorRectSignal`, unchanged below)
   * keeps working; in trace-hosted mode it is the real instance and node
   * clicks route through it instead (`onNodeClick` below) — per decision
   * 2's "selection state lives ONLY in TraceSelectionService", this
   * component never grows a SECOND local selection signal for the
   * trace-hosted case, it delegates. */
  private readonly selection = inject(TraceSelectionService, {
    optional: true,
  });

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
      const finishWithFallback = (run: IRunResponse): void => {
        // No definition resolved for this entry (T06 finding fix / run-view
        // visual rewrite slice 1's Change A) — fall back to the events-only
        // spine rather than 404/guess. Merge with an empty action list:
        // `mergeRun` detects the empty definition and falls back to its
        // events-only spine (executed steps only, flat, no plan-vs-executed
        // dashed overlay — see merge-run.ts's `buildStepsFromEvents`), and
        // the header falls back to the raw id via `workflowName()`.
        const merged = mergeRun(
          run.events,
          run.spans,
          { actions: [] },
          resolveEntryChannel(run.cast)
        );
        const layout = layoutRun(merged);
        this.state.set({ kind: "loaded", run, layout });
      };

      this.runViewService.getRun(workflowId, runId).subscribe({
        next: (run) => {
          if (definitionId) {
            // Executions-list entry: it already knows the DEFINITION id, so
            // fetch it directly — unchanged from the T06 fix.
            this.runViewService.getDefinition(definitionId).subscribe({
              next: (definition) => {
                this.definitionSignal.set(definition);
                const merged = mergeRun(
                  run.events,
                  run.spans,
                  definition,
                  resolveEntryChannel(run.cast)
                );
                const layout = layoutRun(merged);
                this.state.set({ kind: "loaded", run, layout });
              },
              error: () => this.state.set({ kind: "error" }),
            });
            return;
          }

          // Trace-tab entry (run-view visual rewrite slice 1, Change A): no
          // definitionId input, only the TEMPORAL `workflowId`
          // (`{tenantId}:{name}:{nanoid}`). Resolve the definition
          // CLIENT-SIDE by matching its `name` (the id's 2nd colon segment)
          // against `WorkflowApiService.list()` — there is no by-name
          // endpoint. Names are not guaranteed unique per tenant, so only a
          // SINGLE match is trusted; zero or multiple matches fall back to
          // the events-only spine rather than guessing which definition
          // produced this run.
          const nameSegment = workflowId.split(":")[1];
          this.workflowApi.list().subscribe({
            next: (definitions) => {
              const matches = definitions.filter(
                (def) => def.name === nameSegment
              );
              if (matches.length === 1) {
                const matched = matches[0]!;
                this.definitionSignal.set(matched);
                const merged = mergeRun(
                  run.events,
                  run.spans,
                  matched,
                  resolveEntryChannel(run.cast)
                );
                const layout = layoutRun(merged);
                this.state.set({ kind: "loaded", run, layout });
                return;
              }
              // Zero matches (unknown/renamed workflow) or ambiguous
              // (duplicate names across tenants) — do not guess.
              finishWithFallback(run);
            },
            error: () => finishWithFallback(run),
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
    computeViewBox(
      this.positionedNodes(),
      this.forkChips(),
      this.artifactBoxes()
    )
  );

  /** Change B (run-view visual rewrite slice 1): intrinsic pixel width of
   * the flow's content, bound to the svg's own `width` alongside
   * `preserveAspectRatio="xMinYMin meet"` so a narrow tree renders at its
   * natural size (never upscaled to fill the container) and only shrinks
   * via CSS `max-width: 100%` when the container is narrower. */
  readonly contentWidth = computed(() =>
    computeContentWidth(
      this.positionedNodes(),
      this.forkChips(),
      this.artifactBoxes()
    )
  );

  /** Slice 3: the right-hand "artefactos" column — paired boxes for every
   * connector/agent/channel action node, derived from the already-computed
   * spine positions + the run's `cast` (render-layer overlay, domain step
   * tree untouched). */
  readonly artifactBoxes = computed(() =>
    computeArtifactBoxes(
      this.positionedNodes(),
      this.run().cast,
      this.forkChips()
    )
  );

  readonly artifactEdges = computed(() =>
    computeArtifactEdges(this.positionedNodes(), this.artifactBoxes())
  );

  private readonly artifactColumnX = computed(() => {
    const boxes = this.artifactBoxes();
    return boxes.length > 0
      ? boxes[0]!.x
      : // No artifact boxes this run — still resolve a column x so the
        // "artifacts" header position stays deterministic (it is hidden
        // by the template's `@if` in that case anyway).
        NODE_WIDTH;
  });

  readonly columnHeaders = computed(() =>
    computeColumnHeaders(this.positionedNodes(), this.artifactColumnX())
  );

  readonly artifactBoxWidth = ARTIFACT_BOX_WIDTH;
  readonly artifactBoxHeight = ARTIFACT_BOX_HEIGHT;

  readonly notExecutedCount = computed(
    () => this.layout().nodes.filter((n) => n.dashed).length
  );

  readonly statusChip = computed(() =>
    formatRunStatusChip(this.run().summary, this.notExecutedCount())
  );

  /** DESIGN.md header: "entry/channel" — the run's channel-kind cast
   * entry (the workflow's channel trigger/send actor), when present. */
  readonly entryChannel = computed(() => resolveEntryChannel(this.run().cast));

  resolveCastColor = resolveCastColor;
  nodeSubLabel = nodeSubLabel;

  /** T05 inspector run-mode content (decision 3: "step result in run
   * view") — resolves the trace screen's shared selection back onto this
   * run's OWN `ILayoutNode`, real fields only (`resolve-selected-step-
   * result.ts`). `TraceDetailComponent` reads this via a
   * `viewChild(RunViewComponent)` signal query rather than a second
   * selection signal — this is DERIVED READ DATA about the already-loaded
   * run, not selection state itself, so exposing it here does not violate
   * decision 2. `null` outside trace-hosted mode (`selection` absent), or
   * when nothing / an event outside this run is selected. */
  readonly selectedStepResult = computed(() => {
    if (!this.selection) {
      return null;
    }
    const s = this.state();
    if (s.kind !== "loaded") {
      return null;
    }
    return resolveSelectedStepResult(
      this.positionedNodes(),
      s.run.events,
      this.selection.selectedEventId()
    );
  });

  /** T06 inspector deep-links content: the same event -> node resolution as
   * `selectedStepResult` above, one step further — the matched node's
   * "Open <entity>" deep link (`resolve-selected-step-deep-link.ts`), NOT a
   * builder link (see that module's header: no trace-event/run-step ->
   * builder-canvas-node id bridge exists — T01 finding 4). `null` outside
   * trace-hosted mode, when nothing is selected, or when the matched
   * step/node resolves to neither a connector nor an agent. */
  readonly selectedStepDeepLink = computed(() => {
    if (!this.selection) {
      return null;
    }
    const s = this.state();
    if (s.kind !== "loaded") {
      return null;
    }
    return resolveSelectedStepDeepLink(
      this.positionedNodes(),
      s.run.events,
      this.selection.selectedEventId()
    );
  });

  isHighlighted(node: ILayoutNode): boolean {
    const selected = this.selected();
    return selected !== null && node.instanceId === selected;
  }

  /** Which node (if any) matches the shared trace-screen selection — drives
   * the `.rv-node-trace-selected` highlight ring. DISTINCT from
   * `isHighlighted()` above (that one is the cast-chip instance highlight,
   * an unrelated concept). Always `false` in standalone mode (`selection`
   * absent) — no cross-view highlight exists without the service. */
  isTraceSelected(node: ILayoutNode): boolean {
    if (!this.selection) {
      return false;
    }
    const selectedId = this.selection.selectedEventId();
    if (!selectedId) {
      return false;
    }
    const s = this.state();
    if (s.kind !== "loaded") {
      return false;
    }
    const pair = resolveStepEvents(node, s.run.events);
    return (
      pair.started?.eventId === selectedId ||
      pair.completed?.eventId === selectedId
    );
  }

  /** BUG 2 fix: the right-column artifact box paired with a selected cast
   * chip's step must ALSO light up (DESIGN.md: "Click = highlight that
   * artifact's steps in the flow" — the artifact box is one of those
   * steps). Compares against `IArtifactBox.instanceId` (the resolved cast
   * entry id, which also covers `channelSend` boxes whose underlying
   * layout node carries no `instanceId` of its own). */
  isArtifactHighlighted(box: IArtifactBox): boolean {
    const selected = this.selected();
    return selected !== null && box.instanceId === selected;
  }

  /** Cast chip click toggles highlight of that instance's steps
   * (DESIGN.md: "Click = highlight that artifact's steps in the flow").
   * Clicking the already-selected chip clears the highlight. */
  toggleHighlight(entry: IRunCastEntry): void {
    this.selected.set(this.selected() === entry.id ? null : entry.id);
  }

  /** Emits the clicked node (unchanged output contract T04 shipped)
   * regardless of hosting mode. TRACE-HOSTED mode (`selection` present,
   * T05 of `manual-loops/admin-console/console-redesign-trace.md`): routes
   * the click through the shared `TraceSelectionService` instead of
   * opening the local popup — decision 2 governs the trace screen: "the
   * node-click popup flow is REPLACED by inspector selection". STANDALONE
   * mode (`selection` absent, `RunViewPageComponent` at
   * `/processes/runs/:workflowId/:runId`): unchanged T05 popup flow, out
   * of this loop's redesign scope per the task instructions. */
  onNodeClick(node: ILayoutNode, event: MouseEvent): void {
    this.nodeSelected.emit(node);
    if (this.selection) {
      this.selectInTraceScreen(node);
      return;
    }
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
  }

  /** Trace-hosted node click (T05): resolves the node's OWN started/
   * completed event via `resolveStepEvents` — the SAME mapping
   * `run-view-popup.component.ts` uses, no second heuristic — preferring
   * the COMPLETED event as "the corresponding event" (the step's own
   * outcome) and falling back to STARTED for a step that has no completed
   * event yet. A step with NEITHER (e.g. a not-executed definition-only
   * step, or a join pill, which carries no event of its own per
   * `resolveStepEvents`' header) is a documented no-op — SPEC.md T05: "if
   * a step has NO mapped event, click is a no-op with console.debug,
   * nothing invented". */
  private selectInTraceScreen(node: ILayoutNode): void {
    const selection = this.selection;
    if (!selection) {
      return;
    }
    const s = this.state();
    if (s.kind !== "loaded") {
      return;
    }
    const pair = resolveStepEvents(node, s.run.events);
    const eventId = pair.completed?.eventId ?? pair.started?.eventId ?? null;
    if (!eventId) {
      console.debug(
        "[RunViewComponent] node click has no mapped event — no-op (trace-hosted mode)",
        { nodeId: node.id, kind: node.kind, stepName: node.stepName }
      );
      return;
    }
    console.debug(
      "[RunViewComponent] node clicked, selecting event via shared TraceSelectionService",
      { nodeId: node.id, eventId, stepName: node.stepName }
    );
    selection.select(eventId, "run");
  }

  closePopup(): void {
    this.selectedNodeSignal.set(null);
    this.anchorRectSignal.set(null);
  }

  /** Artifact box click opens the SAME T05 popup as clicking its paired
   * spine step (SPEC.md: "Do NOT build a new data path") — resolves the
   * underlying `ILayoutNode` via `IArtifactBox.stepId` and delegates to
   * `onNodeClick`, anchored to the artifact box's OWN screen rect (not the
   * spine step's, since that is where the user actually clicked). */
  onArtifactClick(box: IArtifactBox, event: MouseEvent): void {
    const node = this.positionsById().get(box.stepId);
    if (!node) {
      return;
    }
    this.onNodeClick(node, event);
  }
}
