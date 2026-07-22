import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
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
import { deserializeFlow } from "../domain/flow-deserializer";
import { serializeFlow } from "../domain/flow-serializer";
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
import { WorkflowNodeComponent } from "./components/workflow-node/workflow-node.component";
import { WorkflowNodeConfigComponent } from "./components/workflow-node-config/workflow-node-config.component";
import { WorkflowPaletteComponent } from "./components/workflow-palette/workflow-palette.component";
import { WorkflowTestPanelComponent } from "./components/workflow-test-panel/workflow-test-panel.component";
import {
  type IWorkflowValidationDialogData,
  WorkflowValidationDialogComponent,
} from "./components/workflow-validation-dialog/workflow-validation-dialog.component";

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
    WorkflowNodeComponent,
    WorkflowPaletteComponent,
    WorkflowNodeConfigComponent,
    WorkflowTestPanelComponent,
    VariablesReferenceComponent,
  ],
  template: `
    <div class="builder-shell">
      <div class="builder-body">
        <!-- Palette -->
        <app-workflow-palette />

        <!-- Canvas -->
        <div class="builder-canvas-wrap">
          <app-variables-reference [groups]="variableGroups()" />

          <f-flow
            fDraggable
            (fLoaded)="onCanvasLoaded()"
            (fCreateNode)="onCreateNode($event)"
            (fCreateConnection)="onCreateConnection($event)"
            (fReassignConnection)="onReassignConnection($event)"
          >
            <f-background>
              <f-circle-pattern color="var(--rd-line)" [radius]="1" />
            </f-background>

            <f-canvas fZoom (fCanvasChange)="onCanvasChange($event)">
              <f-connection-for-create />

              @for (conn of connections(); track conn.key) {
                <f-connection
                  [fConnectionId]="conn.key"
                  [fOutputId]="conn.source + '-out'"
                  [fInputId]="conn.target + '-in'"
                  [fReassignableStart]="true"
                  fType="bezier"
                  fBehavior="floating"
                >
                  <!-- Edge label rendered only from real IWorkflowConnection.label
                       metadata (SPEC T04 — T01 finding 2: this field exists but
                       is never populated by the current serializer/deserializer;
                       nothing is invented when it is absent). Uses @foblex/flow's
                       own supported connection-content mechanism (fConnectionContent),
                       positioned at the path midpoint. -->
                  @if (conn.label) {
                    <div fConnectionContent [position]="0.5" class="wf-edge-label">
                      {{ conn.label }}
                    </div>
                  }
                </f-connection>
              }

              @for (node of nodes(); track node.key) {
                <app-workflow-node
                  fNode
                  fDragHandle
                  [fNodePosition]="node.position"
                  [node]="node"
                  [hasError]="errorNodeKeys().has(node.key)"
                  [isSelected]="node.key === selectedNodeKey()"
                  (click)="selectNode(node.key)"
                />
              }
            </f-canvas>
          </f-flow>

          <!-- Floating chrome: back / name / save state (SPEC decision 3
               amendment — overlays the canvas, the app header/tabs stay
               visible above the shell). -->
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
            <div
              class="chrome-pill chrome-save-state"
              [class.is-saving]="saving()"
              data-testid="builder-save-state"
            >
              <mat-icon>{{ saving() ? "sync" : "check_circle" }}</mat-icon>
              {{ saveStateLabel() }}
            </div>

            <span class="chrome-spacer"></span>

            <div class="chrome-pill chrome-actions">
              <button
                mat-flat-button
                type="button"
                (click)="toggleTestPanel()"
                [class.active]="testPanelOpen()"
              >
                <mat-icon>play_arrow</mat-icon>
                Run Test
              </button>
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
        </div>

        <!-- Config Panel -->
        @if (selectedNode()) {
          <app-workflow-node-config
            [node]="selectedNode()"
            [triggerAccountIds]="triggerAccountIds()"
            [workflowNodes]="nodes()"
            [variableGroups]="variableGroups()"
            (close)="deselectNode()"
            (remove)="removeNode($event)"
            (configChange)="onNodeConfigChange($event)"
            (nameChange)="onNodeNameChange($event)"
          />
        }

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
       * is the 52px app header — see layout/header/header.component.ts's
       * .topbar height.
       */
      height: calc(100dvh - 52px);
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
      bottom: var(--rd-space-8);
      left: var(--rd-space-8);
      pointer-events: auto;
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-7);
      box-shadow: var(--rd-shadow-md);
      overflow: hidden;
      gap: 0;
    }
    .chrome-pill {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-7);
      padding: var(--rd-space-3) var(--rd-space-6);
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

    /* Foblex connection rendering (library sets fill:none but no stroke) */
    :host ::ng-deep .f-connection-path {
      stroke: var(--rd-accent);
      stroke-width: 2px;
      transition: stroke 0.15s ease;
    }
    :host ::ng-deep .f-connection.f-selected .f-connection-path {
      stroke: var(--rd-link);
      stroke-width: 3px;
    }
    :host ::ng-deep .f-connection-selection {
      stroke: transparent;
      stroke-width: 10px;
    }
    :host ::ng-deep .f-connection-drag-handle {
      fill: var(--rd-accent);
    }
    :host ::ng-deep .f-connection-for-create .f-connection-path {
      stroke: var(--rd-accent);
      stroke-width: 2px;
      stroke-dasharray: 6 3;
    }
    :host ::ng-deep .f-connection-for-create .f-connection-drag-handle {
      fill: var(--rd-accent);
    }
    /* Edge label (SPEC T04) - rendered via fConnectionContent, only when
       IWorkflowConnection.label is set (T01 finding 2). */
    .wf-edge-label {
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-5);
      padding: 2px 8px;
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-2);
      white-space: nowrap;
      pointer-events: none;
    }
    button.active {
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
    }
  `,
})
export class WorkflowBuilderComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(WorkflowApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly canvas = viewChild(FCanvasComponent);

  readonly flow = signal<IWorkflowFlow>({
    key: "",
    name: "New Workflow",
    application: "default",
    nodes: {},
    connections: {},
  });

  readonly selectedNodeKey = signal<string | null>(null);
  readonly testPanelOpen = signal(false);
  readonly saving = signal(false);
  /** Current canvas zoom, mirrored from FCanvasComponent's scale for the floating zoom readout. */
  readonly zoomPercent = signal(100);
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
   * Floating chrome save-state indicator. Reuses only state the builder
   * already tracks (`saving` + whether the flow has been assigned a
   * persisted `key` by a prior save) — no new dirty-diffing state is
   * introduced, per the SPEC's re-skin-only constraint.
   */
  readonly saveStateLabel = computed<string>(() => {
    if (this.saving()) {
      return "Saving…";
    }
    return this.flow().key ? "Saved" : "Unsaved";
  });

  readonly nodes = computed(() => Object.values(this.flow().nodes));

  readonly connections = computed(() => Object.values(this.flow().connections));

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
        description: "Channel type (whatsapp, telegram…)",
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

  ngOnInit(): void {
    // Phase 3 nested this component under /workflows/:id/builder, so
    // the :id param now lives on the parent route. Read self first for
    // back-compat (e.g. /workflows/:id/edit redirects), then fall back
    // to the parent route.
    const id =
      this.route.snapshot.paramMap.get("id") ??
      this.route.parent?.snapshot.paramMap.get("id") ??
      null;
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
          // Verbose logging per SPEC line 59: edge labels are only ever
          // rendered from real IWorkflowConnection.label metadata (T04,
          // T01 finding 2 — this field exists but is never populated by
          // today's serializer/deserializer, so this count is commonly 0).
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
    this.selectedNodeKey.set(key);
  }

  deselectNode(): void {
    this.selectedNodeKey.set(null);
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
}
