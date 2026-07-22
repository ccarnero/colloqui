import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { FFlowModule } from "@foblex/flow";
import {
  EWorkflowNodeType,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";
import { isKnownNodeTypeColor, nodeTypeColorToken } from "./node-type-color";
import type { IWorkflowNodeStats } from "./workflow-node-stats.types";

@Component({
  selector: "app-workflow-node",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FFlowModule],
  template: `
      <div
        class="wf-builder-node"
        [class.has-error]="hasError()"
        [class.is-selected]="isSelected()"
        [style.border-color]="borderColor()"
      >
      <div
        class="wf-node-input"
        fNodeInput
        [fInputId]="node().key + '-in'"
        fInputConnectableSide="left"
        [style.background]="accentColor()"
      ></div>

      <div class="wf-node-content">
        <div class="wf-node-icon-wrap">
          <mat-icon>{{ node().icon }}</mat-icon>
        </div>
        <div class="wf-node-info">
          <div class="wf-node-name">{{ node().name }}</div>
          <div class="wf-node-type">{{ typeLabel() }}</div>
        </div>
      </div>

      <div
        class="wf-node-output"
        fNodeOutput
        [fOutputId]="node().key + '-out'"
        fOutputConnectableSide="right"
        [fOutputMultiple]="node().type === branchType || node().type === conditionalType"
        [style.background]="accentColor()"
      ></div>

      @if (stats(); as s) {
        <div class="wf-node-stats" data-testid="wf-node-stats">
          @if (s.status) {
            <span
              class="wf-node-stats-dot"
              [class.is-ok]="s.status === 'ok'"
              [class.is-warning]="s.status === 'warning'"
              [class.is-error]="s.status === 'error'"
            ></span>
          }
          <span class="wf-node-stats-primary">{{ s.primaryLabel }}</span>
          @if (s.secondaryLabel) {
            <span class="wf-node-stats-secondary">{{ s.secondaryLabel }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
    }
    .wf-builder-node {
      min-width: 180px;
      background: var(--rd-panel);
      border: 1.5px solid var(--rd-line-3);
      border-radius: var(--rd-radius-7);
      padding: 0;
      cursor: grab;
      transition: border-color 0.15s, box-shadow 0.15s;
      position: relative;
    }
    .wf-builder-node:hover {
      border-color: var(--rd-accent);
      box-shadow: 0 0 0 2px var(--rd-accent-soft);
    }
    /* Node-type border/accent color is driven by [style.border-color]
       bound to borderColor(), see node-type-color.ts for the mapping
       table (SPEC decision 4, AMENDED). The is-selected/has-error classes
       below only add the box-shadow; border color priority is resolved
       in TS. */
    .wf-builder-node.is-selected {
      box-shadow: 0 0 0 2px var(--rd-accent-soft);
    }
    .wf-builder-node.has-error {
      box-shadow: 0 0 0 2px var(--rd-red-dim);
    }
    .wf-builder-node.has-error:hover {
      box-shadow: 0 0 0 3px var(--rd-red-dim);
    }
    .wf-node-content {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
    }
    .wf-node-icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--rd-radius-6);
      background: var(--rd-hover);
      flex-shrink: 0;
    }
    .wf-node-icon-wrap mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--rd-accent);
    }
    .wf-node-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .wf-node-name {
      font-size: var(--rd-text-size-base);
      font-weight: 600;
      color: var(--rd-text-1);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wf-node-type {
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
    }
    /* Port dot fill color is bound to accentColor() via [style.background]
       (SPEC decision 4, AMENDED); the base rule below only sets
       shape/position, the type color always wins. */
    .wf-node-input,
    .wf-node-output {
      position: absolute;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--rd-panel);
      top: 50%;
      transform: translateY(-50%);
      z-index: 1;
      cursor: crosshair;
    }
    .wf-node-input {
      left: -6px;
    }
    .wf-node-output {
      right: -6px;
    }
    /* Per-node mini-stats badge (SPEC decision 5). Hidden by default -
       no caller passes stats yet (T01 finding 6: per-node run/error
       aggregates are NO-DATA today); this only styles the rendering path
       for when that data exists. */
    .wf-node-stats {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px 10px;
      border-top: 1px solid var(--rd-line-2);
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
    }
    .wf-node-stats-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--rd-text-3);
      flex-shrink: 0;
    }
    .wf-node-stats-dot.is-ok {
      background: var(--rd-green);
    }
    .wf-node-stats-dot.is-warning {
      background: var(--rd-yellow);
    }
    .wf-node-stats-dot.is-error {
      background: var(--rd-red);
    }
    .wf-node-stats-primary {
      color: var(--rd-text-2);
    }
    .wf-node-stats-secondary {
      color: var(--rd-text-3);
    }
  `,
})
export class WorkflowNodeComponent {
  readonly node = input.required<IWorkflowNode>();
  readonly hasError = input<boolean>(false);
  /** Highlights this card when it's the currently-selected node in the builder's config panel. */
  readonly isSelected = input<boolean>(false);
  readonly selected = output<string>();

  /**
   * Per-node mini-stats badge (SPEC decision 5). Optional and strictly
   * typed via IWorkflowNodeStats - the badge only renders when a caller
   * passes it. T01 finding 6 confirmed there is no per-node run/error
   * aggregate today, so no caller in this codebase passes stats yet; the
   * rendering path is shipped ready for when that data exists.
   */
  readonly stats = input<IWorkflowNodeStats | undefined>(undefined);

  readonly channelType = EWorkflowNodeType.CHANNEL;
  readonly branchType = EWorkflowNodeType.BRANCH;
  readonly conditionalType = EWorkflowNodeType.CONDITIONAL;

  /**
   * Port/accent color token by node type (SPEC decision 4, AMENDED) - see
   * node-type-color.ts for the mapping table and its citations.
   */
  readonly accentColor = computed(() => nodeTypeColorToken(this.node().type));

  /**
   * Node border color: error state takes priority, then selection, then
   * the type-driven accent color. Replaces the T03 is-channel/is-branch/
   * is-conditional hard-coded classes with the single EWorkflowNodeType
   * mapping from decision 4.
   */
  readonly borderColor = computed(() => {
    if (this.hasError()) {
      return "var(--rd-red)";
    }
    if (this.isSelected()) {
      return "var(--rd-accent)";
    }
    return this.accentColor();
  });

  constructor() {
    // Verbose logging per SPEC line 59: log when a node type falls back to
    // the neutral accent color instead of a dedicated KIND_STRIPE entry.
    effect(() => {
      const type = this.node().type;
      if (!isKnownNodeTypeColor(type)) {
        console.debug(
          "[WorkflowNodeComponent] node type has no dedicated accent color, using neutral fallback",
          { nodeKey: this.node().key, type }
        );
      }
    });
  }

  typeLabel(): string {
    const labels: Record<string, string> = {
      channel: "Channel",
      jsFunction: "JS Function",
      endpointCall: "HTTP Connector",
      serviceCall: "Service Call",
      serviceBusCall: "Publish Event",
      agentCall: "Agent",
      branch: "Parallel Branch",
      conditional: "Conditional",
    };
    const label = labels[this.node().type] ?? this.node().type;
    if (this.node().type === this.channelType) {
      const channel = this.channelSubtitle();
      if (channel) {
        return `${label} · ${channel}`;
      }
    }
    return label;
  }

  /**
   * Concrete channel type shown alongside the generic "Channel" label.
   * Outbound channelSend nodes store a single channel string; inbound
   * trigger nodes store a list of listened channels.
   */
  private channelSubtitle(): string | null {
    const configuration = this.node().configuration;
    const outbound = configuration?.["channel"];
    if (typeof outbound === "string" && outbound) {
      return outbound;
    }
    const inbound = configuration?.["channels"];
    if (Array.isArray(inbound) && inbound.length > 0) {
      return inbound.filter((c) => typeof c === "string" && c).join(", ");
    }
    return null;
  }
}
