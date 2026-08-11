import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  type OnDestroy,
  type OnInit,
  signal,
  viewChild,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ActivatedRoute, Router } from "@angular/router";
import {
  type FCanvasChangeEvent,
  FCanvasComponent,
  type FCreateConnectionEvent,
  type FCreateNodeEvent,
  FFlowModule,
  type FReassignConnectionEvent,
} from "@foblex/flow";
import { WorkflowRunActionsService } from "../detail/workflow-run-actions.service";
import { deserializeFlow } from "../domain/flow-deserializer";
import { serializeFlow } from "../domain/flow-serializer";
import {
  type INodeStatsBranchRow,
  mapNodeStatsOwnRunsByName,
  mapNodeStatsToBranchRows,
  mapNodeStatsToViewModels,
} from "../domain/map-node-stats-to-view-models";
import type { ValidationError } from "../domain/validation/validation.types";
import { validateWorkflow } from "../domain/validation/workflow.validator";
import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowFlow,
  type IWorkflowNode,
} from "../domain/workflow-node.types";
import { createNodeFromDefault } from "../domain/workflow-node-defaults";
import { WorkflowApiService } from "../services/workflow-api.service";
import type {
  IVariableEntry,
  IVariableGroup,
} from "./components/template-autocomplete/template-autocomplete.component";
import { VariablesReferenceComponent } from "./components/variables-reference/variables-reference.component";
import { WorkflowNodeCardComponent } from "./components/workflow-node/workflow-node-card.component";
import type { IWorkflowNodeStats } from "./components/workflow-node/workflow-node-stats.types";
import { WorkflowNodeConfigComponent } from "./components/workflow-node-config/workflow-node-config.component";
import { WorkflowPaletteComponent } from "./components/workflow-palette/workflow-palette.component";
import { WorkflowTestPanelComponent } from "./components/workflow-test-panel/workflow-test-panel.component";
import {
  type IWorkflowValidationDialogData,
  WorkflowValidationDialogComponent,
} from "./components/workflow-validation-dialog/workflow-validation-dialog.component";
import { resolveEdgeLabel } from "./resolve-edge-label";
import { resolveEdgeVisualState } from "./resolve-edge-visual-state";

const CONNECTOR_OUTPUT_SUFFIX = "-out";
const CONNECTOR_INPUT_SUFFIX = "-in";

/**
 * Maps a node output connector id (`{nodeKey}-out`) to the workflow node key.
 */
function connectorOutputToNodeKey(connectorId: string): string {
  return connectorId.endsWith(CONNECTOR_OUTPUT_SUFFIX)
    ? connectorId.slice(0, -CONNECTOR_OUTPUT_SUFFIX.length)
    : connectorId;
}

/**
 * Maps a node input connector id (`{nodeKey}-in`) to the workflow node key.
 */
function connectorInputToNodeKey(connectorId: string): string {
  return connectorId.endsWith(CONNECTOR_INPUT_SUFFIX)
    ? connectorId.slice(0, -CONNECTOR_INPUT_SUFFIX.length)
    : connectorId;
}

/**
 * Keeps a single incoming edge per target and at most one outgoing edge per
 * non-branch source, matching the canvas rules used on create/reassign.
 */
function pruneConflictingConnections(
  all: Record<string, IWorkflowConnection>,
  winner: IWorkflowConnection,
  winnerKey: string,
  nodes: Record<string, IWorkflowNode>
): Record<string, IWorkflowConnection> {
  const sourceAllowsMany =
    nodes[winner.source]?.type === EWorkflowNodeType.BRANCH ||
    nodes[winner.source]?.type === EWorkflowNodeType.CONDITIONAL;

  const next: Record<string, IWorkflowConnection> = {};
  for (const [k, c] of Object.entries(all)) {
    if (k === winnerKey) {
      continue;
    }
    if (c.target === winner.target) {
      continue;
    }
    if (!sourceAllowsMany && c.source === winner.source) {
      continue;
    }
    next[k] = c;
  }
  next[winnerKey] = winner;
  return next;
}

@Component({
  selector: "app-workflow-builder",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FFlowModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatSnackBarModule,
    WorkflowNodeCardComponent,
    WorkflowPaletteComponent,
    WorkflowNodeConfigComponent,
    WorkflowTestPanelComponent,
    VariablesReferenceComponent,
  ],
  template: `
    <div class="builder-shell">
      <div class="builder-body">
        <!-- Canvas -->
        <div class="builder-canvas-wrap">
          <app-variables-reference [groups]="variableGroups()" />

          <f-flow
            fDraggable
            (fLoaded)="onCanvasLoaded()"
            (fCreateNode)="onCreateNode($event)"
            (fCreateConnection)="onCreateConnection($event)"
            (fReassignConnection)="onReassignConnection($event)"
            (click)="onCanvasSurfaceClick()"
          >
            <!-- Dot-grid canvas field, SPEC T04, ported from
                 builder-v2-reference/canvas-layout.css: a 1px dot every
                 24px using the dim --rd-line token. The f-circle-pattern
                 radius input doubles as both the pattern cell size
                 (spacing) and the base dot radius, scaled by zoom - see
                 @foblex/flow's FCirclePatternComponent. -->
            <f-background>
              <f-circle-pattern color="var(--rd-line)" [radius]="24" />
            </f-background>

            <f-canvas fZoom (fCanvasChange)="onCanvasChange($event)">
              <f-connection-for-create />

              @for (conn of connections(); track conn.key) {
                <!-- Edge visual state, SPEC T04, classified purely off the
                     connection's own real label metadata via
                     resolveEdgeVisualState() - never node type or
                     position. Matches builder-v2-reference/canvas-layout.css:
                     the conditional's literal default path renders dim,
                     solid and static (wf-edge--default); every other edge
                     - plain linear, matched condition, matched branch -
                     renders accent, dashed and animated. f-connection
                     mechanics (fType, fBehavior, fReassignableStart,
                     connection ids) are untouched - style only. -->
                <f-connection
                  [fConnectionId]="conn.key"
                  [fOutputId]="conn.source + '-out'"
                  [fInputId]="conn.target + '-in'"
                  [fReassignableStart]="true"
                  fType="bezier"
                  fBehavior="floating"
                  [class.wf-edge--default]="resolveEdgeVisualState(conn) === 'default'"
                >
                  <!-- Edge label rendered only from real IWorkflowConnection.label
                       metadata, SPEC T04, via the resolveEdgeLabel() pure
                       function. Design mockup follow-up: the deserializer
                       derives this label for conditional/branch fan-out
                       edges from the branch's own metadata (the path/branch
                       name, the condition text, or the literal default for
                       the default path - see flow-deserializer.ts) - never
                       fabricated, and still absent for plain linear edges
                       and for empty-path direct branch->converge edges,
                       where no such metadata exists. Uses @foblex/flow's
                       own supported connection-content mechanism
                       (fConnectionContent), positioned at the path
                       midpoint. -->
                  @if (resolveEdgeLabel(conn); as label) {
                    <div
                      fConnectionContent
                      [position]="0.5"
                      class="wf-edge-label"
                      [class.wf-edge-label--default]="resolveEdgeVisualState(conn) === 'default'"
                    >
                      {{ label }}
                    </div>
                  }
                </f-connection>
              }

              @for (node of nodes(); track node.key) {
                <app-workflow-node-card
                  fNode
                  fDragHandle
                  [fNodePosition]="node.position"
                  [node]="node"
                  [hasError]="errorNodeKeys().has(node.key)"
                  [isSelected]="node.key === selectedNodeKey()"
                  [stats]="statsFor(node)"
                  (click)="onNodeSurfaceClick($event, node.key)"
                />
              }
            </f-canvas>
          </f-flow>

          <!-- Floating chrome (SPEC T08, T01 finding 8): ported from
               builder-v2-reference/canvas-layout.html's floating topbar
               row, replacing the previous solid full-width bar. Each
               cluster below is its own translucent pill (chrome-pill /
               chrome-identity / chrome-segmented / chrome-actions) with
               independent pointer-events:auto, matching .builder-topbar in
               canvas-layout.css — the row itself stays pointer-events:none
               (.floating-chrome) so only the pills, not the gaps between
               them, intercept clicks/drags meant for the canvas
               underneath. -->
          <div class="floating-chrome floating-top">
            <div class="chrome-pill chrome-identity">
              <button
                class="chrome-icon-btn"
                type="button"
                (click)="goBack()"
                aria-label="Back to workflows"
              >
                <mat-icon>arrow_back</mat-icon>
              </button>
              <span class="chrome-breadcrumb">workflows /</span>
              <input
                class="builder-title-input"
                [value]="flow().name"
                placeholder="Workflow name"
                (input)="onNameInput($event)"
                (blur)="onNameBlur($event)"
                (keydown.enter)="$event.target.blur()"
              />
            </div>
            <!-- Saved-state pill (SPEC T08): the reference's
                 saved-indicator pill reads "saved · Ns" (seconds since the
                 last successful save), not just "Saved". See
                 saveStateLabel() below: the "Ns" part is derived purely
                 from the existing saving signal plus a local lastSavedAt
                 timestamp, ticked once a second by chromeClockTick — no
                 new fetch, no new capability. -->
            <div
              class="chrome-pill chrome-save-state"
              [class.is-saving]="saving()"
              data-testid="builder-save-state"
            >
              <mat-icon>{{ saving() ? "sync" : "check_circle" }}</mat-icon>
              {{ saveStateLabel() }}
            </div>

            <!-- Segmented control (T02, polished T08): replaces the detail
                 wrapper's sub-tabs row for this route — mock's "Editor /
                 Runs / Settings" navigation, targeting the same child
                 routes the wrapper's sub-tabs used (:id/builder,
                 :id/executions, :id/settings). Only rendered once a
                 persisted workflow id is known (unsaved /workflows/new has
                 nothing to navigate to yet).
                 T08 / T01 finding 8 follow-up: the mock's Runs segment
                 shows a live run-count badge next to the label, sourced
                 from the design canvas's static mock data. No aggregate
                 "total runs for this definition" count exists anywhere the
                 builder can read today (T07's node-stats join is per-node;
                 workflows.component.ts's topByExecutionCountLast7d only
                 covers the top 5 workflows over 7 days, not this arbitrary
                 workflow's all-time count) — DATA-GAP, not fabricated
                 here; the segment stays "Runs" with no number, same
                 standing precedent as the T06/T07 per-node stats gap. -->
            @if (workflowId(); as wfId) {
              <div
                class="chrome-pill chrome-segmented"
                role="tablist"
                data-testid="builder-segmented-control"
              >
                <button
                  type="button"
                  class="segment active"
                  role="tab"
                  aria-selected="true"
                  disabled
                >
                  Editor
                </button>
                <button
                  type="button"
                  class="segment"
                  role="tab"
                  aria-selected="false"
                  (click)="goToTab(wfId, 'executions')"
                >
                  Runs
                </button>
                <button
                  type="button"
                  class="segment"
                  role="tab"
                  aria-selected="false"
                  (click)="goToTab(wfId, 'settings')"
                >
                  Settings
                </button>
              </div>
            }

            <span class="chrome-spacer"></span>

            <!-- Validity pill (SPEC T08 — mock's "valid · N nodes"): T03
                 deliberately withheld the "valid" prefix because, at the
                 time, validateWorkflow() only ran from saveWorkflow(), and
                 showing "valid" before any save would have claimed an
                 unverified state. T08 closes that gap the right way — by
                 running the SAME existing pure validateWorkflow() function
                 live off the current flow() signal (see isWorkflowValid
                 below) instead of only at save time — so "valid" / "N
                 issues" now reflects a real, continuously up-to-date
                 check, never a fabricated claim. No new validation logic,
                 no new capability: same validator, called more often. -->
            <span
              class="chrome-pill chrome-node-count"
              [class.is-invalid]="!isWorkflowValid()"
              data-testid="builder-node-count-pill"
            >
              <mat-icon>{{
                isWorkflowValid() ? "verified" : "error_outline"
              }}</mat-icon>
              {{ nodeCountLabel() }}
            </span>

            <div class="chrome-pill chrome-actions">
              <!-- Run now / Pause (T02): relocated here from the detail
                   wrapper's header, reusing the EXACT wiring
                   (WorkflowRunActionsService — same dialog, same API
                   calls) so behavior stays identical on every tab. Only
                   shown once a persisted workflow id is known. -->
              @if (workflowId(); as wfId) {
                <button
                  mat-flat-button
                  type="button"
                  (click)="runNow(wfId)"
                >
                  <mat-icon>play_circle</mat-icon>
                  Run now
                </button>
                <button
                  mat-flat-button
                  type="button"
                  (click)="pauseWorkflow(wfId)"
                >
                  <mat-icon>pause_circle</mat-icon>
                  Pause
                </button>
              }
              <button
                mat-flat-button
                type="button"
                (click)="toggleTestPanel()"
                [class.active]="testPanelOpen()"
              >
                <mat-icon>play_arrow</mat-icon>
                Run test
              </button>
              <!-- No Publish button (SPEC T08 / T01 finding 9,
                   NEW-CAPABILITY): the mock's primary action publishes the
                   workflow to an ACTIVE state via a publish endpoint that
                   does not exist in workflow-api.service.ts today (the
                   live API only has create/update/run-now/pause). Per the
                   polish loop's standing decision 3 (no capability without
                   a signed-off API), this stays UNBUILT — Save keeps doing
                   the real, existing persistence action instead of a
                   button that would look like Publish but silently just
                   save. Human sign-off needed before a Publish flow is
                   built; default is NOT BUILT. -->
              <button
                mat-flat-button
                type="button"
                (click)="saveWorkflow()"
                [disabled]="saving()"
              >
                <mat-icon>save</mat-icon>
                Save
              </button>
            </div>
          </div>

          <!-- Floating chrome: zoom controls, wired to @foblex/flow's
               FCanvasComponent zoom API (getScale/setScale/fitToScreen). -->
          <div class="floating-chrome floating-zoom">
            <button
              type="button"
              class="zoom-btn"
              (click)="zoomOut()"
              aria-label="Zoom out"
            >
              −
            </button>
            <span class="zoom-readout">{{ zoomPercent() }}%</span>
            <button
              type="button"
              class="zoom-btn"
              (click)="zoomIn()"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              class="zoom-btn zoom-fit"
              (click)="fitCanvas()"
              aria-label="Fit to screen"
              title="Fit to screen"
            >
              <mat-icon>fit_screen</mat-icon>
            </button>
          </div>

          <!-- Floating bottom-center: palette dock (SPEC T03, T01 finding
               10) — replaces the old full-height left sidebar palette. A
               sibling of f-flow, positioned by the component's own host
               styles; SAME create wiring (fExternalItem/fData) as before. -->
          <app-workflow-palette />

          <!-- Floating inspector (SPEC T05 — T01 finding 2: replaces the old
               300px sidebar; embeds the EXISTING WorkflowNodeConfigComponent
               form logic unchanged, only the container/positioning changes.
               Sits as a sibling of <f-flow>, not inside it, so clicks inside
               the panel never bubble into the canvas click-to-deselect
               handler below — no pointer-events blocking needed elsewhere
               on the canvas. -->
          @if (selectedNode(); as sel) {
            <div class="floating-inspector" data-testid="floating-inspector">
              <app-workflow-node-config
                [node]="sel"
                [triggerAccountIds]="triggerAccountIds()"
                [workflowNodes]="nodes()"
                [variableGroups]="variableGroups()"
                [connections]="connections()"
                [nodeStatsBranchRows]="nodeStatsBranchRows()"
                [nodeStatsOwnRunsByName]="nodeStatsOwnRunsByName()"
                [nodeStatsFetchState]="nodeStatsFetchState()"
                [nodeStatsByName]="nodeStatsByName()"
                (close)="onInspectorCloseButton()"
                (remove)="removeNode($event)"
                (configChange)="onNodeConfigChange($event)"
                (nameChange)="onNodeNameChange($event)"
                (viewInRuns)="onViewInRuns($event)"
              />
            </div>
          }
        </div>

        <!-- Test Panel (when no node selected and test panel is open) -->
        @if (!selectedNode() && testPanelOpen()) {
          <app-workflow-test-panel
            [workflowId]="flow().key"
            [workflowActions]="serializedActions()"
            (close)="testPanelOpen.set(false)"
          />
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      box-sizing: border-box;
      /*
       * f-flow / f-canvas require a definite height; percentage height from
       * main.workspace often collapses to 0. The builder route is
       * full-bleed (shell.component.ts's subNavHidden flag zeroes the
       * shell-main padding), so the only chrome left above this component
       * is the two-row app header — its height is the shared
       * --rd-topbar-h token (styles.scss), kept in sync with
       * layout/header/header.component.ts's fixed row heights.
       */
      height: calc(100dvh - var(--rd-topbar-h, 75px));
      min-height: 320px;
    }
    .builder-shell {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: var(--rd-bg);
    }
    .builder-body {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .builder-canvas-wrap {
      flex: 1;
      min-width: 0;
      min-height: 0;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    app-variables-reference {
      /* The floating top chrome (absolute, top --rd-space-8, 50px pill row)
         overlays the top of the canvas wrap; without this clearance the
         collapsed panel renders clipped BEHIND the floating pills. 50px is
         the chrome pill height (36px controls + vertical padding/border —
         see .chrome-pill / .chrome-icon-btn below). */
      margin-top: calc(var(--rd-space-8) + 50px + var(--rd-space-4));
    }
    f-flow {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Floating chrome overlaying the canvas — SPEC decision 3 amendment. */
    .floating-chrome {
      position: absolute;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      pointer-events: none;
    }
    .floating-chrome.floating-top {
      top: var(--rd-space-8);
      left: var(--rd-space-8);
      right: var(--rd-space-8);
      flex-wrap: wrap;
    }
    .floating-chrome.floating-zoom {
      /* SPEC T08 — border-radius:10px in canvas-layout.css's
         .builder-zoom, matching every other floating pill; was
         --rd-radius-7 (8px), one step tighter than the reference. */
      bottom: var(--rd-space-8);
      left: var(--rd-space-8);
      pointer-events: auto;
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-9);
      box-shadow: var(--rd-shadow-md);
      overflow: hidden;
      gap: 0;
    }
    /* Pill surface (SPEC T08), ported verbatim from
       builder-v2-reference/canvas-layout.css's .builder-topbar__*-pill /
       .builder-view-tabs / .builder-validity-badge / .builder-btn-*:
       border-radius:10px, box-shadow:0 8px 24px rgba(0,0,0,.25),
       padding ~7px 12px. --rd-radius-9 (10px) and --rd-shadow-md (the
       exact same shadow value) already exist as tokens; --rd-space-3-5
       (7px) is the closest existing token to the reference's 7px
       vertical pill padding. */
    .chrome-pill {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-9);
      padding: var(--rd-space-3-5) var(--rd-space-6);
      box-shadow: var(--rd-shadow-md);
      pointer-events: auto;
    }
    .chrome-identity {
      padding: var(--rd-space-2) var(--rd-space-4);
    }
    .chrome-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: var(--rd-radius-5);
      background: transparent;
      color: var(--rd-text-2);
      cursor: pointer;
    }
    .chrome-icon-btn:hover {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }
    .chrome-icon-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .chrome-breadcrumb {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
      white-space: nowrap;
    }
    .builder-title-input {
      font-size: var(--rd-text-size-lg);
      font-weight: 600;
      border: 1px solid transparent;
      border-radius: var(--rd-radius-4);
      background: transparent;
      color: var(--rd-text-1);
      padding: 1px 6px;
      min-width: 120px;
      max-width: 260px;
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s, background 0.15s;
    }
    .builder-title-input:hover {
      border-color: var(--rd-line-3);
    }
    .builder-title-input:focus {
      border-color: var(--rd-accent);
      background: var(--rd-bg);
    }
    .chrome-save-state {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-green);
      gap: var(--rd-space-2);
    }
    .chrome-save-state mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--rd-green);
    }
    .chrome-save-state.is-saving,
    .chrome-save-state.is-saving mat-icon {
      color: var(--rd-text-3);
    }
    .chrome-spacer {
      flex: 1;
      pointer-events: none;
    }
    /* Validity pill (SPEC T08 — was the T03 node-count-only pill; see the
       template comment above for why "valid" is now a live, real check
       instead of a withheld claim). Green/verified when
       validateWorkflow() passes, matching the reference's
       .builder-validity-badge; degrades to a warning tone (never a
       fabricated pass) when it does not. */
    .chrome-node-count {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-green);
    }
    .chrome-node-count mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--rd-green);
    }
    .chrome-node-count.is-invalid,
    .chrome-node-count.is-invalid mat-icon {
      color: var(--rd-yellow, var(--rd-text-2));
    }
    /* Segmented control (T02, polished T08) — Editor / Runs / Settings,
       replacing the detail wrapper's sub-tabs row while the builder is
       full-bleed. */
    .chrome-segmented {
      padding: 2px;
      gap: 2px;
    }
    .segment {
      border: none;
      background: transparent;
      color: var(--rd-text-2);
      font-size: var(--rd-text-size-xs);
      font-family: inherit;
      padding: var(--rd-space-2) var(--rd-space-5);
      border-radius: var(--rd-radius-5);
      cursor: pointer;
    }
    .segment:hover:not(:disabled) {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }
    .segment.active {
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
      cursor: default;
    }
    .chrome-actions {
      gap: var(--rd-space-3);
    }
    .zoom-btn {
      width: 30px;
      height: 30px;
      border: none;
      border-right: 1px solid var(--rd-line-2);
      background: transparent;
      color: var(--rd-text-2);
      cursor: pointer;
      font-size: 15px;
      font-family: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .zoom-btn:last-child {
      border-right: none;
    }
    .zoom-btn:hover {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }
    .zoom-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .zoom-readout {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-2);
      padding: 0 var(--rd-space-4);
      border-right: 1px solid var(--rd-line-2);
      line-height: 30px;
      min-width: 40px;
      text-align: center;
    }

    /* Floating inspector (SPEC T05) — token-styled floating panel over the
       canvas, right side, per the design's Builder section. A sibling of
       <f-flow>, so it never intercepts the canvas click-to-deselect
       listener and never blocks canvas interactions outside itself. */
    .floating-inspector {
      position: absolute;
      top: calc(var(--rd-space-8) * 3 + 12px);
      right: var(--rd-space-8);
      bottom: var(--rd-space-8);
      width: 320px;
      max-width: calc(100% - var(--rd-space-8) * 2);
      z-index: 5;
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-7);
      box-shadow: var(--rd-shadow-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Connection styling, SPEC T04, ported from
       builder-v2-reference/canvas-layout.css and tokens.css. Two visual
       states, classified purely by resolveEdgeVisualState() off the
       connection's own real label metadata - never node type. Foblex sets
       fill:none on the path but no stroke; f-connection mechanics (fType,
       fBehavior, fReassignableStart, reassignable ends, connection ids)
       are untouched - style only.

       Active/matched state (default look): stroke, width and dash exactly
       match the reference's accent dashed marching-ants edge. */
    :host ::ng-deep .f-connection-path {
      stroke: var(--rd-accent);
      stroke-width: 1.5px;
      stroke-linecap: butt;
      stroke-dasharray: 5 5;
      animation: wf-dashmove 1s linear infinite;
      transition: stroke 0.15s ease, stroke-width 0.15s ease;
    }
    /* Default/untaken conditional path (the literal "default" branch) -
       ported verbatim: dim line3 stroke, solid, no animation. */
    :host ::ng-deep .f-connection.wf-edge--default .f-connection-path {
      stroke: var(--rd-line-3);
      stroke-dasharray: none;
      animation: none;
    }
    :host ::ng-deep .f-connection:hover .f-connection-path {
      stroke: var(--rd-link);
    }
    :host ::ng-deep .f-connection.wf-edge--default:hover .f-connection-path {
      stroke: var(--rd-text-2);
    }
    :host ::ng-deep .f-connection.f-selected .f-connection-path {
      stroke: var(--rd-link);
      stroke-width: 2.5px;
    }
    :host ::ng-deep .f-connection-selection {
      stroke: transparent;
      stroke-width: 10px;
    }
    /* Endpoint caps (SPEC T04, T01 finding 6 - "denser/larger markers than
       the mock"). Foblex always renders a start+end drag handle per
       connection (fReassignableStart keeps that mechanic exactly as-is,
       same r=8 hit target); restyled here as invisible at rest - the mock
       has no extra circles along its edges beyond the node ports - and
       only fades in as a small ringed dot on hover/selection, keeping the
       reassign affordance discoverable without cluttering the resting
       canvas. */
    :host ::ng-deep .f-connection-drag-handle {
      r: 3px;
      fill: var(--rd-bg);
      stroke: var(--rd-accent);
      stroke-width: 1.5px;
      opacity: 0;
      transition: opacity 0.15s ease, r 0.15s ease;
    }
    :host ::ng-deep .f-connection.wf-edge--default .f-connection-drag-handle {
      stroke: var(--rd-line-3);
    }
    :host ::ng-deep .f-connection:hover .f-connection-drag-handle,
    :host ::ng-deep .f-connection.f-selected .f-connection-drag-handle {
      r: 5px;
      opacity: 1;
    }
    :host ::ng-deep .f-connection-for-create .f-connection-path {
      stroke: var(--rd-accent);
      stroke-width: 1.5px;
      stroke-dasharray: 5 5;
      animation: wf-dashmove 1s linear infinite;
    }
    :host ::ng-deep .f-connection-for-create .f-connection-drag-handle {
      r: 5px;
      fill: var(--rd-accent);
      stroke: none;
      opacity: 1;
    }

    /* Marching-ants animation for active/matched edges, SPEC T04, ported
       verbatim from builder-v2-reference/tokens.css keyframes dashmove
       (renamed to wf-dashmove to stay component-scoped). */
    @keyframes wf-dashmove {
      to {
        stroke-dashoffset: -20;
      }
    }

    /* Edge label chip, SPEC T04 - rendered via fConnectionContent, only
       when resolveEdgeLabel() resolves real IWorkflowConnection.label
       metadata to a non-empty string (T01 finding 2). Two styles per the
       reference: the matched-condition/branch label uses the stronger
       line-3 border and t2 text; the default-path label uses the dimmer
       line-2 border and t3 text (wf-edge-label--default). */
    .wf-edge-label {
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-5);
      padding: 1px 7px;
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-2);
      white-space: nowrap;
      pointer-events: none;
    }
    .wf-edge-label--default {
      color: var(--rd-text-3);
      border-color: var(--rd-line-2);
    }
    button.active {
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
    }
  `,
})
export class WorkflowBuilderComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(WorkflowApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly runActions = inject(WorkflowRunActionsService);
  private readonly canvas = viewChild(FCanvasComponent);

  readonly flow = signal<IWorkflowFlow>({
    key: "",
    name: "New Workflow",
    application: "default",
    nodes: {},
    connections: {},
  });

  /**
   * Resolved `:id` for the workflow being edited (T02) — mirrors the
   * `WorkflowDetailComponent.id` resolution below, so the floating
   * chrome's segmented control and Run now/Pause buttons only render once
   * a persisted workflow is known (nothing to navigate to / act on from
   * an unsaved `/workflows/new` canvas).
   */
  readonly workflowId = signal<string | null>(null);

  readonly selectedNodeKey = signal<string | null>(null);
  readonly testPanelOpen = signal(false);
  readonly saving = signal(false);
  /** Current canvas zoom, mirrored from FCanvasComponent's scale for the floating zoom readout. */
  readonly zoomPercent = signal(100);

  /**
   * SPEC T08 — timestamp (ms) of the last successful save, feeding the
   * floating chrome's "saved · Ns" pill (reference:
   * .builder-topbar__saved-indicator in canvas-layout.css). Set once on
   * load for an already-persisted workflow (it was saved as of the load)
   * and again after every successful performSave(). `null` before any
   * save has ever happened (fresh /workflows/new canvas), matching the
   * existing "Unsaved" case.
   */
  readonly lastSavedAt = signal<number | null>(null);
  /**
   * SPEC T08 — a 1s clock tick, read only by savedSecondsAgo() below, so
   * the "saved · Ns" pill counts up live without polling any API. Started
   * in ngOnInit, cleared in ngOnDestroy — the only side effect this task
   * introduces, and it is purely a local UI clock, not a new data source.
   */
  private readonly chromeClockTick = signal(0);
  private chromeClockIntervalId: ReturnType<typeof setInterval> | undefined;
  readonly validationErrors = signal<ValidationError[]>([]);
  readonly errorNodeKeys = computed(
    () =>
      new Set(
        this.validationErrors()
          .map((e) => e.nodeKey)
          .filter((k): k is string => typeof k === "string")
      )
  );

  /**
   * T07 of console-redesign-builder-v2.md: per-node stats fetch state,
   * driving the node card footer's degraded rendering.
   * - `"idle"` — no persisted workflow id (new/unsaved canvas): nothing to
   *   fetch, footer stays hidden immediately (never a permanent loading
   *   skeleton for a workflow that could never have runs).
   * - `"loading"` — the fetch is in flight; footer renders its
   *   skeleton/neutral state.
   * - `"error"` — the fetch failed; logged once via `console.warn`, footer
   *   degrades to hidden, the canvas itself keeps working.
   * - `"ready"` — `nodeStatsByName` holds the real, joined aggregate (or is
   *   legitimately empty for a workflow with zero runs in the window).
   */
  readonly nodeStatsFetchState = signal<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  /** Per-node view models keyed by `action.name` (T06 findings' join-crux
   * verdict — see `map-node-stats-to-view-models.ts`), populated once per
   * builder load by `ngOnInit`. */
  readonly nodeStatsByName = signal<
    Readonly<Record<string, IWorkflowNodeStats>>
  >({});
  /**
   * UNMERGED per-`(action_name, branch)` rows from the SAME `/node-stats`
   * fetch above (SPEC console-redesign-builder-v2 IF-editor task) — exposed
   * to the conditional branch config panel for per-branch run evidence
   * ("matched 11/23 · 48%"), without touching `nodeStatsByName`'s merged
   * node-card behavior at all. See `map-node-stats-to-view-models.ts`
   * `mapNodeStatsToBranchRows()`.
   */
  readonly nodeStatsBranchRows = signal<readonly INodeStatsBranchRow[]>([]);
  /**
   * Each action's own unbranched run total, keyed by action_name (SPEC
   * console-redesign-builder-v2 IF-editor task attempt 2, dual-review
   * objection 1 fix). Passed to the conditional branch config panel as the
   * per-branch evidence DENOMINATOR — the conditional node's own row,
   * rename-proof since it is keyed only by action_name, not by any
   * branch's current label. See map-node-stats-to-view-models.ts
   * mapNodeStatsOwnRunsByName().
   */
  readonly nodeStatsOwnRunsByName = signal<Readonly<Record<string, number>>>(
    {}
  );

  /**
   * Floating chrome save-state indicator (SPEC T08 — reference's
   * "saved · Ns" pill, not just "Saved"). Reuses only state the builder
   * already tracks (`saving` + `lastSavedAt`, set at load time for an
   * already-persisted workflow and again on every successful save) —
   * `chromeClockTick` is read here purely to force this computed to
   * re-run every second while a save timestamp exists, so "Ns" counts up
   * live.
   */
  readonly saveStateLabel = computed<string>(() => {
    if (this.saving()) {
      return "Saving…";
    }
    const savedAt = this.lastSavedAt();
    if (savedAt === null) {
      return "Unsaved";
    }
    this.chromeClockTick(); // re-run this computed every tick (see effect below)
    const seconds = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
    return `saved · ${seconds}s`;
  });

  readonly nodes = computed(() => Object.values(this.flow().nodes));

  /**
   * Floating chrome validity pill (SPEC T08 — mock's "valid · N nodes";
   * T01 finding 10 for the plain node count). Runs the SAME existing pure
   * validateWorkflow() validator live off the current flow() signal, so
   * "valid"/"N issues" is always a real, up-to-date check — never a
   * fabricated claim (see the T08 template comment above the validity
   * pill for the full rationale of why this replaces T03's
   * save-gated-only version).
   */
  readonly isWorkflowValid = computed<boolean>(
    () => validateWorkflow(this.flow()).valid
  );

  readonly nodeCountLabel = computed<string>(() => {
    const count = this.nodes().length;
    return this.isWorkflowValid() ? `valid · ${count} nodes` : `${count} nodes`;
  });

  readonly connections = computed(() => Object.values(this.flow().connections));

  /**
   * Edge label / edge visual-state resolvers, SPEC T04. Bound to
   * class fields (not called as `this.resolveEdgeLabel(...)` wrappers) so
   * the pure functions stay unit-testable in isolation while the template
   * calls them directly off the component instance.
   */
  protected readonly resolveEdgeLabel = resolveEdgeLabel;
  protected readonly resolveEdgeVisualState = resolveEdgeVisualState;

  readonly selectedNode = computed<IWorkflowNode | null>(() => {
    const key = this.selectedNodeKey();
    return key ? (this.flow().nodes[key] ?? null) : null;
  });

  /** Serialized actions used by the test panel to extract request variables. */
  readonly serializedActions = computed(
    () => serializeFlow(this.flow()).actions
  );

  /**
   * Variable groups derived from the current workflow nodes, consumed by
   * the Variables Reference panel and forwarded to the node config panel
   * for the conditional-branch variable dropdown.
   */
  readonly variableGroups = computed<IVariableGroup[]>(() => {
    const nodes = this.nodes();
    const groups: IVariableGroup[] = [];

    // Request variables — extracted from existing template usage
    const requestVars: IVariableEntry[] = [];
    const requestSeen = new Set<string>();
    for (const node of nodes) {
      const json = JSON.stringify(node.configuration);
      const regex = /\{\{request\.([^}]+)\}\}/g;
      let match;
      while ((match = regex.exec(json)) !== null) {
        if (!requestSeen.has(match[1])) {
          requestSeen.add(match[1]);
          requestVars.push({
            path: `request.${match[1]}`,
            label: match[1],
            description: `Input variable: ${match[1]}`,
            example: `{{request.${match[1]}}}`,
          });
        }
      }
    }
    // Always include common request vars even if not yet used
    for (const fallback of [
      {
        path: "request.from",
        label: "from",
        description: "Sender identifier (phone/JID)",
      },
      {
        path: "request.text",
        label: "text",
        description: "Inbound message text",
      },
      {
        path: "request.conversationId",
        label: "conversationId",
        description: "Current conversation ID",
      },
      {
        path: "request.channel",
        label: "channel",
        description: "Channel type (telegram, http…)",
      },
    ]) {
      if (!requestSeen.has(fallback.label)) {
        requestVars.push({
          ...fallback,
          example: `{{${fallback.path}}}`,
        });
      }
    }
    groups.push({
      namespace: "Request",
      icon: "\uD83D\uDCE5",
      variables: requestVars,
    });

    // Results from previous steps
    const resultVars: IVariableEntry[] = [];
    for (const node of nodes) {
      if (!node.name) {
        continue;
      }
      resultVars.push({
        path: `results["${node.name}"].data`,
        label: `${node.name} data`,
        description: `Full output from ${node.name}`,
        example: `{{results["${node.name}"].data}}`,
      });
      resultVars.push({
        path: `results["${node.name}"].data.reply`,
        label: `${node.name} reply`,
        description: `Reply text from ${node.name}`,
        example: `{{results["${node.name}"].data.reply}}`,
      });
    }
    if (resultVars.length > 0) {
      groups.push({
        namespace: "Results",
        icon: "\uD83D\uDCCA",
        variables: resultVars,
      });
    }

    // Built-in variables
    groups.push({
      namespace: "Built-in",
      icon: "\u2699\uFE0F",
      variables: [
        {
          path: "workflow.tenant",
          label: "tenant",
          description: "Current tenant ID",
          example: "{{workflow.tenant}}",
        },
        {
          path: "workflow.name",
          label: "name",
          description: "Workflow name",
          example: "{{workflow.name}}",
        },
        {
          path: "variables.previous",
          label: "previous",
          description: "Previous step result",
          example: "{{variables.previous}}",
        },
      ],
    });

    return groups;
  });

  /**
   * Account IDs declared on the inbound trigger (Channel In). Used by
   * the config panel to constrain outbound `channelSend` to accounts
   * the workflow is actually listening on.
   */
  readonly triggerAccountIds = computed<string[]>(() => {
    const inbound = Object.values(this.flow().nodes).find(
      (n) =>
        n.type === EWorkflowNodeType.CHANNEL &&
        n.configuration["direction"] === "inbound"
    );
    if (!inbound) {
      return [];
    }
    const ids = inbound.configuration["accountIds"];
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  });

  /**
   * Footer stats view model for a given node (T07). Never blocks canvas
   * render — reads purely from `nodeStatsFetchState`/`nodeStatsByName`,
   * both populated asynchronously by the ONE fetch `ngOnInit` triggers.
   * - fetch not started ("idle", e.g. an unsaved `/workflows/new` canvas
   *   with no id to fetch stats for) or failed ("error", already logged at
   *   the fetch site) -> hidden.
   * - fetch in flight ("loading") -> the skeleton/neutral row.
   * - fetch done ("ready") -> the real joined view model for this node's
   *   `name`, or hidden when there is no matching row (a node that never
   *   ran, or the legitimate zero-runs-workflow empty case, which yields an
   *   empty `nodeStatsByName` map for every node).
   */
  statsFor(node: IWorkflowNode): IWorkflowNodeStats {
    const fetchState = this.nodeStatsFetchState();
    if (fetchState === "loading") {
      return { state: "loading", primaryLabel: "" };
    }
    if (fetchState !== "ready") {
      // "idle" | "error"
      return { state: "hidden", primaryLabel: "" };
    }
    return (
      this.nodeStatsByName()[node.name] ?? { state: "hidden", primaryLabel: "" }
    );
  }

  ngOnInit(): void {
    // SPEC T08 — starts the 1s local clock that ticks the floating
    // chrome's "saved · Ns" pill (chromeClockTick / saveStateLabel
    // above). No new data source: this only forces the existing
    // computed to re-evaluate against Date.now() once a second.
    this.chromeClockIntervalId = setInterval(() => {
      this.chromeClockTick.update((n) => n + 1);
    }, 1000);

    // Phase 3 nested this component under /workflows/:id/builder, so
    // the :id param now lives on the parent route. Read self first for
    // back-compat (e.g. /workflows/:id/edit redirects), then fall back
    // to the parent route.
    const id =
      this.route.snapshot.paramMap.get("id") ??
      this.route.parent?.snapshot.paramMap.get("id") ??
      null;
    this.workflowId.set(id);
    console.debug(
      "[WorkflowBuilderComponent] resolved workflow id for floating chrome",
      {
        id,
      }
    );
    if (id) {
      this.api.get(id).subscribe({
        next: (dto) => {
          const { nodes, connections } = deserializeFlow(dto);
          this.flow.set({
            key: dto.id,
            name: dto.name,
            application: dto.application,
            nodes,
            connections,
          });
          // SPEC T08 — an already-persisted workflow was saved as of this
          // successful load; seeds the "saved · Ns" pill instead of
          // leaving it in the "Unsaved" state for a workflow that
          // demonstrably has been saved before.
          this.lastSavedAt.set(Date.now());
          // Verbose logging per SPEC line 59: edge labels are only ever
          // rendered from real IWorkflowConnection.label metadata (T04).
          // The deserializer now derives this for conditional/branch
          // fan-out edges (path name, condition text, or "default") — see
          // flow-deserializer.ts — so this count is 0 only for flows with no
          // branch/conditional nodes, or for their empty-path/linear edges.
          const labeledCount = Object.values(connections).filter(
            (c) => !!c.label
          ).length;
          console.debug(
            "[WorkflowBuilderComponent] resolved edge labels from connection metadata",
            {
              workflowId: dto.id,
              totalConnections: Object.keys(connections).length,
              labeledCount,
            }
          );
        },
      });

      // T07: one per-node stats fetch per builder load, cached in
      // `nodeStatsByName`, never blocking the canvas render above (this is
      // a wholly separate subscription against the canvas-driving `flow`
      // signal).
      this.nodeStatsFetchState.set("loading");
      this.api.getNodeStatsForDefinition(id).subscribe({
        next: (rows) => {
          const byName = mapNodeStatsToViewModels(rows);
          this.nodeStatsByName.set(byName);
          const branchRows = mapNodeStatsToBranchRows(rows);
          this.nodeStatsBranchRows.set(branchRows);
          const ownRunsByName = mapNodeStatsOwnRunsByName(rows);
          this.nodeStatsOwnRunsByName.set(ownRunsByName);
          this.nodeStatsFetchState.set("ready");
          console.debug("[WorkflowBuilderComponent] node stats loaded (T07)", {
            workflowId: id,
            rowCount: rows.length,
            nodeCount: Object.keys(byName).length,
          });
          console.debug(
            "[WorkflowBuilderComponent] per-branch node stats rows exposed to config panel (IF-editor task)",
            { workflowId: id, branchRowCount: branchRows.length }
          );
          console.debug(
            "[WorkflowBuilderComponent] per-node own-run totals exposed to config panel (IF-editor task attempt 2, rename-staleness fix)",
            {
              workflowId: id,
              ownRunNodeCount: Object.keys(ownRunsByName).length,
            }
          );
        },
        error: (error) => {
          this.nodeStatsFetchState.set("error");
          console.warn(
            "[WorkflowBuilderComponent] node stats fetch failed — footer degrades to hidden (T07)",
            { workflowId: id, error }
          );
        },
      });
    } else {
      this.nodeStatsFetchState.set("idle");
    }
  }

  /**
   * SPEC T08 — stops the "saved · Ns" clock started in ngOnInit. Nothing
   * else in this component holds a subscription/interval that needs
   * manual teardown; the api.get()/getNodeStatsForDefinition() calls are
   * one-shot HTTP observables that already complete on their own.
   */
  ngOnDestroy(): void {
    if (this.chromeClockIntervalId !== undefined) {
      clearInterval(this.chromeClockIntervalId);
      this.chromeClockIntervalId = undefined;
    }
  }

  onCanvasLoaded(): void {
    const c = this.canvas();
    if (c) {
      c.resetScaleAndCenter(false);
      this.zoomPercent.set(Math.round(c.getScale() * 100));
      console.debug("[WorkflowBuilderComponent] canvas loaded", {
        scale: c.getScale(),
      });
    }
  }

  /** Mirrors FCanvasComponent's live scale into the floating zoom readout. */
  onCanvasChange(event: FCanvasChangeEvent): void {
    this.zoomPercent.set(Math.round(event.scale * 100));
  }

  fitCanvas(): void {
    const c = this.canvas();
    if (c) {
      c.fitToScreen();
      this.zoomPercent.set(Math.round(c.getScale() * 100));
      console.debug("[WorkflowBuilderComponent] fit to screen", {
        scale: c.getScale(),
      });
    }
  }

  /** Zoom in one step via FCanvasComponent's setScale, clamped to a sane max. */
  zoomIn(): void {
    const c = this.canvas();
    if (!c) {
      return;
    }
    const next = Math.min(2, c.getScale() + 0.1);
    c.setScale(next);
    this.zoomPercent.set(Math.round(next * 100));
    console.debug("[WorkflowBuilderComponent] zoom in", { scale: next });
  }

  /** Zoom out one step via FCanvasComponent's setScale, clamped to a sane min. */
  zoomOut(): void {
    const c = this.canvas();
    if (!c) {
      return;
    }
    const next = Math.max(0.2, c.getScale() - 0.1);
    c.setScale(next);
    this.zoomPercent.set(Math.round(next * 100));
    console.debug("[WorkflowBuilderComponent] zoom out", { scale: next });
  }

  onCreateNode(event: FCreateNodeEvent): void {
    const type = event.data as EWorkflowNodeType;
    if (!type) {
      return;
    }

    const node = createNodeFromDefault(type, event.rect);

    this.flow.update((f) => ({
      ...f,
      nodes: { ...f.nodes, [node.key]: node },
    }));
  }

  onCreateConnection(event: FCreateConnectionEvent): void {
    if (!event.fInputId) {
      return;
    }

    const sourceNode = connectorOutputToNodeKey(event.fOutputId);
    const targetNode = connectorInputToNodeKey(event.fInputId);

    const conn: IWorkflowConnection = {
      key: `conn-${Date.now()}`,
      source: sourceNode,
      target: targetNode,
      type: EWorkflowConnectionType.DEFAULT,
    };

    this.flow.update((f) => {
      const merged = { ...f.connections, [conn.key]: conn };
      const connections = pruneConflictingConnections(
        merged,
        conn,
        conn.key,
        f.nodes
      );
      return { ...f, connections };
    });
  }

  /**
   * Persists drag-to-reconnect after Foblex emits the final endpoint ids.
   *
   * @param event - Completed reassignment from `f-flow[fDraggable]`.
   */
  onReassignConnection(event: FReassignConnectionEvent): void {
    let nextSourceKey: string | undefined;
    let nextTargetKey: string | undefined;

    if (event.endpoint === "source") {
      if (event.nextSourceId === undefined) {
        return;
      }
      nextSourceKey = connectorOutputToNodeKey(event.nextSourceId);
    } else {
      if (event.nextTargetId === undefined) {
        return;
      }
      nextTargetKey = connectorInputToNodeKey(event.nextTargetId);
    }

    this.flow.update((f) => {
      const existing = f.connections[event.connectionId];
      if (!existing) {
        return f;
      }

      const updated: IWorkflowConnection = {
        ...existing,
        source: nextSourceKey ?? existing.source,
        target: nextTargetKey ?? existing.target,
      };

      const merged = { ...f.connections, [event.connectionId]: updated };
      const connections = pruneConflictingConnections(
        merged,
        updated,
        event.connectionId,
        f.nodes
      );

      return { ...f, connections };
    });
  }

  selectNode(key: string): void {
    console.debug("[WorkflowBuilderComponent] inspector opened", {
      nodeKey: key,
      previousKey: this.selectedNodeKey(),
    });
    this.selectedNodeKey.set(key);
  }

  deselectNode(): void {
    if (this.selectedNodeKey() === null) {
      return;
    }
    console.debug("[WorkflowBuilderComponent] inspector closed", {
      previousKey: this.selectedNodeKey(),
    });
    this.selectedNodeKey.set(null);
  }

  /**
   * Node click within the canvas (SPEC T05): stops propagation so the
   * bubbled click doesn't also hit `onCanvasSurfaceClick` and immediately
   * deselect the node it just selected.
   */
  onNodeSurfaceClick(event: MouseEvent, key: string): void {
    event.stopPropagation();
    this.selectNode(key);
  }

  /**
   * Empty-canvas click (SPEC T05): deselects the current node, closing the
   * floating inspector. Node clicks stop propagation before reaching here
   * (see `onNodeSurfaceClick`), and the floating chrome / inspector panel
   * are DOM siblings of `<f-flow>`, so their clicks never bubble into this
   * handler either — only genuine empty-canvas clicks land here.
   */
  onCanvasSurfaceClick(): void {
    if (this.selectedNodeKey() === null) {
      return;
    }
    console.debug(
      "[WorkflowBuilderComponent] canvas background clicked — dismissing inspector",
      { previousKey: this.selectedNodeKey() }
    );
    this.deselectNode();
  }

  /**
   * Explicit close (×) button inside the inspector panel (SPEC T05).
   * Logged separately from the canvas-click and Escape dismiss paths so
   * the dismissal reason is traceable in verbose logs.
   */
  onInspectorCloseButton(): void {
    console.debug("[WorkflowBuilderComponent] inspector close button clicked", {
      nodeKey: this.selectedNodeKey(),
    });
    this.deselectNode();
  }

  /**
   * Keyboard dismissal (SPEC T05): Esc closes the floating inspector from
   * anywhere in the document, matching the design's floating-panel UX.
   */
  @HostListener("document:keydown.escape")
  onEscapeKey(): void {
    if (this.selectedNodeKey() === null) {
      return;
    }
    console.debug(
      "[WorkflowBuilderComponent] Escape pressed — dismissing inspector",
      { previousKey: this.selectedNodeKey() }
    );
    this.deselectNode();
  }

  protected toggleTestPanel(): void {
    this.testPanelOpen.update((open) => !open);
  }

  removeNode(key: string): void {
    this.flow.update((f) => {
      const nodes = { ...f.nodes };
      delete nodes[key];

      const connections: Record<string, IWorkflowConnection> = {};
      for (const [k, c] of Object.entries(f.connections)) {
        if (c.source !== key && c.target !== key) {
          connections[k] = c;
        }
      }

      return { ...f, nodes, connections };
    });
    this.deselectNode();
  }

  onNodeConfigChange(event: {
    key: string;
    field: string;
    value: unknown;
  }): void {
    this.flow.update((f) => {
      const node = f.nodes[event.key];
      if (!node) {
        return f;
      }
      return {
        ...f,
        nodes: {
          ...f.nodes,
          [event.key]: {
            ...node,
            configuration: {
              ...node.configuration,
              [event.field]: event.value,
            },
          },
        },
      };
    });
  }

  onNodeNameChange(event: { key: string; name: string }): void {
    this.flow.update((f) => {
      const node = f.nodes[event.key];
      if (!node) {
        return f;
      }
      return {
        ...f,
        nodes: {
          ...f.nodes,
          [event.key]: { ...node, name: event.name },
        },
      };
    });
  }

  saveWorkflow(): void {
    const result = validateWorkflow(this.flow());
    if (!result.valid) {
      this.validationErrors.set(result.errors);
      this.openValidationDialog(result.errors, result.warnings);
      return;
    }
    this.validationErrors.set([]);

    if (result.warnings.length > 0) {
      // Warnings never block the save, but the user must acknowledge
      // them ("Save anyway") before we proceed.
      const ref = this.dialog.open(WorkflowValidationDialogComponent, {
        data: { errors: [], warnings: result.warnings },
        autoFocus: false,
        restoreFocus: true,
      });
      ref.afterClosed().subscribe((saveAnyway) => {
        if (saveAnyway === true) {
          this.performSave();
        }
      });
      return;
    }

    this.performSave();
  }

  private performSave(): void {
    this.saving.set(true);
    const serialized = serializeFlow(this.flow());

    const payload = {
      name: serialized.name,
      application: serialized.application,
      actions: serialized.actions,
      trigger: serialized.trigger,
    };

    const id = this.flow().key;
    const request$ = id
      ? this.api.update(id, payload)
      : this.api.create(payload);

    request$.subscribe({
      next: (saved) => {
        this.saving.set(false);
        // SPEC T08 — resets the "saved · Ns" pill's clock to this real
        // successful save.
        this.lastSavedAt.set(Date.now());
        if (!id) {
          this.flow.update((f) => ({ ...f, key: saved.id }));
          // After first save we route into the new detail mini-app's
          // Builder sub-tab. The legacy `:id/edit` URL still redirects
          // but going direct avoids a redirect flash.
          this.router.navigate(["/workflows", saved.id, "builder"], {
            replaceUrl: true,
          });
        }
        this.snackBar.open("Workflow saved", "OK", {
          duration: 3000,
        });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open("Failed to save workflow", "OK", {
          duration: 5000,
        });
      },
    });
  }

  private openValidationDialog(
    errors: ValidationError[],
    warnings: ValidationError[] = []
  ): void {
    const data: IWorkflowValidationDialogData = { errors, warnings };
    this.dialog.open(WorkflowValidationDialogComponent, {
      data,
      autoFocus: false,
      restoreFocus: true,
    });
  }

  onNameInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.flow.update((f) => ({ ...f, name: value }));
  }

  onNameBlur(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (!value) {
      this.flow.update((f) => ({ ...f, name: "New Workflow" }));
      (event.target as HTMLInputElement).value = "New Workflow";
    }
  }

  goBack(): void {
    console.debug("[WorkflowBuilderComponent] back to workflows list", {
      key: this.flow().key,
    });
    this.router.navigate(["/workflows"]);
  }

  /**
   * Segmented control navigation (T02) — routes to the same child paths
   * the detail wrapper's sub-tabs used (`:id/executions`, `:id/settings`).
   * "Editor" has no target: it is this route, rendered as the disabled
   * active segment.
   */
  protected goToTab(id: string, tab: "executions" | "settings"): void {
    console.debug("[WorkflowBuilderComponent] segmented control navigation", {
      id,
      tab,
    });
    void this.router.navigate(["/workflows", id, tab]);
  }

  /**
   * Inspector "View in Runs" deep-link (shape-scoped inspector
   * correction): reuses `goToTab`'s SAME `/workflows/:id/executions`
   * navigation, adding `?node=<actionName>` so the executions/run-detail
   * feature can highlight the step matching this shape once a run's step
   * list renders (see `workflow-executions.component.ts` and
   * `workflow-run-detail.component.ts`). No new view — same target route
   * as the "Runs" segmented-control tab.
   */
  protected onViewInRuns(actionName: string): void {
    console.debug("[WorkflowBuilderComponent] view in runs deep-link", {
      id: this.flow().key,
      actionName,
    });
    void this.router.navigate(["/workflows", this.flow().key, "executions"], {
      queryParams: { node: actionName },
    });
  }

  /**
   * Run now (T02) — relocated into the floating chrome, delegating to
   * `WorkflowRunActionsService` so it fires the EXACT same dialog + API
   * call as `WorkflowDetailComponent.runNow` on the other tabs.
   */
  protected runNow(id: string): void {
    console.debug(
      "[WorkflowBuilderComponent] run now clicked (floating chrome)",
      {
        id,
      }
    );
    this.runActions.runNow(id);
  }

  /**
   * Pause (T02) — relocated into the floating chrome, delegating to
   * `WorkflowRunActionsService` so it stays byte-identical to
   * `WorkflowDetailComponent.pause` (currently a no-op, API pending).
   */
  protected pauseWorkflow(id: string): void {
    console.debug(
      "[WorkflowBuilderComponent] pause clicked (floating chrome)",
      {
        id,
      }
    );
    this.runActions.pause(id);
  }
}
