import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  type OnInit,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBarModule, MatSnackBar } from "@angular/material/snack-bar";
import {
  FFlowModule,
  FCanvasComponent,
  type FCreateNodeEvent,
  type FCreateConnectionEvent,
  type FReassignConnectionEvent,
} from "@foblex/flow";

import {
  type IWorkflowFlow,
  type IWorkflowNode,
  type IWorkflowConnection,
  EWorkflowConnectionType,
  EWorkflowNodeType,
} from "../domain/workflow-node.types";
import { createNodeFromDefault } from "../domain/workflow-node-defaults";
import { serializeFlow } from "../domain/flow-serializer";
import { WorkflowApiService } from "../services/workflow-api.service";

import { WorkflowNodeComponent } from "./components/workflow-node/workflow-node.component";
import { WorkflowPaletteComponent } from "./components/workflow-palette/workflow-palette.component";
import { WorkflowNodeConfigComponent } from "./components/workflow-node-config/workflow-node-config.component";

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
  nodes: Record<string, IWorkflowNode>,
): Record<string, IWorkflowConnection> {
  const sourceAllowsMany =
    nodes[winner.source]?.type === EWorkflowNodeType.BRANCH;

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
    MatIconModule,
    MatSnackBarModule,
    WorkflowNodeComponent,
    WorkflowPaletteComponent,
    WorkflowNodeConfigComponent,
  ],
  template: `
    <div class="builder-shell">
      <!-- Toolbar -->
      <div class="builder-toolbar">
        <button mat-icon-button type="button" (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <input
          class="builder-title-input"
          [value]="flow().name"
          placeholder="Workflow name"
          (input)="onNameInput($event)"
          (blur)="onNameBlur($event)"
          (keydown.enter)="$event.target.blur()"
        />
        <span class="builder-spacer"></span>
        <button
          mat-icon-button
          type="button"
          (click)="fitCanvas()"
          title="Fit to screen"
        >
          <mat-icon>fit_screen</mat-icon>
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

      <div class="builder-body">
        <!-- Palette -->
        <app-workflow-palette />

        <!-- Canvas -->
        <div class="builder-canvas-wrap">
          <f-flow
            fDraggable
            (fLoaded)="onCanvasLoaded()"
            (fCreateNode)="onCreateNode($event)"
            (fCreateConnection)="onCreateConnection($event)"
            (fReassignConnection)="onReassignConnection($event)"
          >
            <f-background />

            <f-canvas fZoom>
              <f-connection-for-create />

              @for (conn of connections(); track conn.key) {
                <f-connection
                  [fConnectionId]="conn.key"
                  [fOutputId]="conn.source + '-out'"
                  [fInputId]="conn.target + '-in'"
                  [fReassignableStart]="true"
                  fType="bezier"
                  fBehavior="floating"
                />
              }

              @for (node of nodes(); track node.key) {
                <app-workflow-node
                  fNode
                  fDragHandle
                  [fNodePosition]="node.position"
                  [node]="node"
                  (click)="selectNode(node.key)"
                />
              }
            </f-canvas>
          </f-flow>
        </div>

        <!-- Config Panel -->
        @if (selectedNode()) {
          <app-workflow-node-config
            [node]="selectedNode()"
            (close)="deselectNode()"
            (remove)="removeNode($event)"
            (configChange)="onNodeConfigChange($event)"
            (nameChange)="onNodeNameChange($event)"
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
       * main.workspace often collapses to 0. Tie height to the viewport minus
       * shell header and main padding so the graph is always visible.
       */
      height: calc(100dvh - 8rem);
      min-height: 320px;
    }
    .builder-shell {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: var(--bg);
    }
    .builder-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-surface, var(--bg2));
      flex-shrink: 0;
    }
    .builder-title-input {
      font-size: 16px;
      font-weight: 600;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      padding: 2px 6px;
      min-width: 120px;
      max-width: 320px;
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s, background 0.15s;
    }
    .builder-title-input:hover {
      border-color: var(--border);
    }
    .builder-title-input:focus {
      border-color: var(--accent);
      background: var(--bg);
    }
    .builder-spacer {
      flex: 1;
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

    /* Foblex connection rendering (library sets fill:none but no stroke) */
    :host ::ng-deep .f-connection-path {
      stroke: var(--accent, #6366f1);
      stroke-width: 2px;
      transition: stroke 0.15s ease;
    }
    :host ::ng-deep .f-connection.f-selected .f-connection-path {
      stroke: var(--accent-hover, #818cf8);
      stroke-width: 3px;
    }
    :host ::ng-deep .f-connection-selection {
      stroke: transparent;
      stroke-width: 10px;
    }
    :host ::ng-deep .f-connection-drag-handle {
      fill: var(--accent, #6366f1);
    }
    :host ::ng-deep .f-connection-for-create .f-connection-path {
      stroke: var(--accent, #6366f1);
      stroke-width: 2px;
      stroke-dasharray: 6 3;
    }
    :host ::ng-deep .f-connection-for-create
      .f-connection-drag-handle {
      fill: var(--accent, #6366f1);
    }
  `,
})
export class WorkflowBuilderComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(WorkflowApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly canvas = viewChild(FCanvasComponent);

  readonly flow = signal<IWorkflowFlow>({
    key: "",
    name: "New Workflow",
    application: "default",
    nodes: {},
    connections: {},
  });

  readonly selectedNodeKey = signal<string | null>(null);
  readonly saving = signal(false);

  readonly nodes = computed(() =>
    Object.values(this.flow().nodes),
  );

  readonly connections = computed(() =>
    Object.values(this.flow().connections),
  );

  readonly selectedNode = computed<IWorkflowNode | null>(() => {
    const key = this.selectedNodeKey();
    return key ? (this.flow().nodes[key] ?? null) : null;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get("id");
    if (id) {
      this.api.get(id).subscribe({
        next: (dto) => {
          const { nodes, connections } =
            this.deserializeFlow(dto);
          this.flow.set({
            key: dto.id,
            name: dto.name,
            application: dto.application,
            nodes,
            connections,
          });
        },
      });
    }
  }

  onCanvasLoaded(): void {
    const c = this.canvas();
    if (c) {
      c.resetScaleAndCenter(false);
    }
  }

  fitCanvas(): void {
    const c = this.canvas();
    if (c) {
      c.fitToScreen();
    }
  }

  onCreateNode(event: FCreateNodeEvent): void {
    const type = event.data as EWorkflowNodeType;
    if (!type) return;

    const node = createNodeFromDefault(type, event.rect);

    this.flow.update((f) => ({
      ...f,
      nodes: { ...f.nodes, [node.key]: node },
    }));
  }

  onCreateConnection(event: FCreateConnectionEvent): void {
    if (!event.fInputId) return;

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
        f.nodes,
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
        f.nodes,
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
      if (!node) return f;
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
      if (!node) return f;
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
      next: (result) => {
        this.saving.set(false);
        if (!id) {
          this.flow.update((f) => ({ ...f, key: result.id }));
          this.router.navigate(
            ["/workflows", result.id, "edit"],
            { replaceUrl: true },
          );
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

  onNameInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.flow.update((f) => ({ ...f, name: value }));
  }

  onNameBlur(event: Event): void {
    const value =
      (event.target as HTMLInputElement).value.trim();
    if (!value) {
      this.flow.update((f) => ({ ...f, name: "New Workflow" }));
      (event.target as HTMLInputElement).value = "New Workflow";
    }
  }

  goBack(): void {
    this.router.navigate(["/workflows"]);
  }

  /**
   * Reconstructs the visual flow graph from a saved definition.
   * Handles linear actions and recursively expands branch paths
   * into child nodes with fan-out connections.
   */
  private deserializeFlow(dto: {
    actions: unknown[];
    trigger: unknown | null;
  }): {
    nodes: Record<string, IWorkflowNode>;
    connections: Record<string, IWorkflowConnection>;
  } {
    const nodes: Record<string, IWorkflowNode> = {};
    const connections: Record<string, IWorkflowConnection> = {};
    const trunk: string[] = [];
    let connSeq = 0;

    const X_START = 50;
    const X_GAP = 280;
    const Y_BASE = 100;
    const Y_BRANCH_GAP = 140;
    let col = 0;

    const link = (src: string, tgt: string): void => {
      const key = `conn-r-${connSeq++}`;
      connections[key] = {
        key,
        source: src,
        target: tgt,
        type: EWorkflowConnectionType.DEFAULT,
      };
    };

    if (dto.trigger) {
      const tn = createNodeFromDefault(
        EWorkflowNodeType.CHANNEL,
        { x: X_START, y: Y_BASE },
      );
      const raw = dto.trigger as Record<string, unknown>;
      const cfg = raw["config"];
      if (cfg && typeof cfg === "object") {
        tn.configuration = {
          ...tn.configuration,
          ...(cfg as Record<string, unknown>),
        };
      }
      tn.configuration["direction"] = "inbound";
      tn.configuration["mode"] =
        (raw["mode"] as string) ?? "shared";
      nodes[tn.key] = tn;
      trunk.push(tn.key);
      col++;
    }

    if (Array.isArray(dto.actions)) {
      for (const raw of dto.actions) {
        const a = raw as Record<string, unknown>;
        const activity = a["activity"] as string;
        const type = this.activityToNodeType(activity);
        if (!type) continue;

        const node = createNodeFromDefault(type, {
          x: X_START + col * X_GAP,
          y: Y_BASE,
        });
        node.name = (a["name"] as string) ?? node.name;
        nodes[node.key] = node;
        trunk.push(node.key);
        col++;

        if (activity === "branch") {
          const paths = this.extractBranchPaths(a);
          node.configuration["branches"] =
            paths.map(([name]) => name);
          const mid = (paths.length - 1) / 2;

          for (let pi = 0; pi < paths.length; pi++) {
            const pathY =
              Y_BASE + (pi - mid) * Y_BRANCH_GAP;
            const keys = this.deserializeChain(
              paths[pi][1],
              nodes,
              link,
              X_START + col * X_GAP,
              pathY,
              X_GAP,
              Y_BRANCH_GAP,
            );
            if (keys.length === 0) continue;
            link(node.key, keys[0]);
          }
        } else if (
          a["args"] &&
          typeof a["args"] === "object"
        ) {
          node.configuration = {
            ...node.configuration,
            ...(a["args"] as Record<string, unknown>),
          };
        }

        if (activity === "channelSend") {
          node.configuration["direction"] = "outbound";
          const args = a["args"] as
            | Record<string, unknown>
            | undefined;
          if (args) {
            node.configuration["messageType"] =
              args["type"] ?? "text";
          }
          const to =
            node.configuration["to"] as string | undefined;
          node.configuration["recipientMode"] =
            to === "{{request.from}}" ? "sender" : "custom";
        }
      }
    }

    for (let i = 0; i < trunk.length - 1; i++) {
      link(trunk[i], trunk[i + 1]);
    }

    return { nodes, connections };
  }

  /** Extracts dynamic branch path keys from a branch action. */
  private extractBranchPaths(
    action: Record<string, unknown>,
  ): Array<[string, unknown[]]> {
    const skip = new Set(["activity", "name", "args"]);
    const paths: Array<[string, unknown[]]> = [];
    for (const [k, v] of Object.entries(action)) {
      if (!skip.has(k) && Array.isArray(v)) {
        paths.push([k, v]);
      }
    }
    return paths;
  }

  /**
   * Deserializes a chain of actions into nodes, handling nested branches
   * recursively. Internal sequential links (and branch -> path links) are
   * created here, so callers only need to link the previous node to the
   * first key returned. Runs in O(N) over the total action tree.
   */
  private deserializeChain(
    actions: unknown[],
    nodes: Record<string, IWorkflowNode>,
    link: (src: string, tgt: string) => void,
    startX: number,
    y: number,
    xGap: number,
    yBranchGap: number,
  ): string[] {
    const keys: string[] = [];
    let offset = 0;
    let prevKey: string | null = null;
    for (const raw of actions) {
      const a = raw as Record<string, unknown>;
      const activity = a["activity"] as string;
      const type = this.activityToNodeType(activity);
      if (!type) continue;

      const node = createNodeFromDefault(type, {
        x: startX + offset * xGap,
        y,
      });
      node.name = (a["name"] as string) ?? node.name;
      nodes[node.key] = node;
      keys.push(node.key);
      if (prevKey !== null) {
        link(prevKey, node.key);
      }

      if (activity === "branch") {
        const paths = this.extractBranchPaths(a);
        node.configuration["branches"] = paths.map(
          ([name]) => name,
        );
        const mid = (paths.length - 1) / 2;
        const childOffset = offset + 1;

        for (let pi = 0; pi < paths.length; pi++) {
          const pathY = y + (pi - mid) * yBranchGap;
          const childKeys = this.deserializeChain(
            paths[pi][1],
            nodes,
            link,
            startX + childOffset * xGap,
            pathY,
            xGap,
            yBranchGap,
          );
          if (childKeys.length === 0) continue;
          link(node.key, childKeys[0]);
        }
      } else if (a["args"] && typeof a["args"] === "object") {
        node.configuration = {
          ...node.configuration,
          ...(a["args"] as Record<string, unknown>),
        };
      }

      if (activity === "channelSend") {
        node.configuration["direction"] = "outbound";
        const args = a["args"] as
          | Record<string, unknown>
          | undefined;
        if (args) {
          node.configuration["messageType"] =
            args["type"] ?? "text";
        }
        const to =
          node.configuration["to"] as string | undefined;
        node.configuration["recipientMode"] =
          to === "{{request.from}}" ? "sender" : "custom";
      }

      prevKey = node.key;
      offset++;
    }
    return keys;
  }

  private activityToNodeType(
    activity: string,
  ): EWorkflowNodeType | null {
    const map: Record<string, EWorkflowNodeType> = {
      jsFunction: EWorkflowNodeType.JS_FUNCTION,
      endpointCall: EWorkflowNodeType.ENDPOINT_CALL,
      serviceCall: EWorkflowNodeType.SERVICE_CALL,
      serviceBusCall: EWorkflowNodeType.SERVICE_BUS_CALL,
      agentCall: EWorkflowNodeType.AGENT_CALL,
      channelSend: EWorkflowNodeType.CHANNEL,
      branch: EWorkflowNodeType.BRANCH,
    };
    return map[activity] ?? null;
  }
}
