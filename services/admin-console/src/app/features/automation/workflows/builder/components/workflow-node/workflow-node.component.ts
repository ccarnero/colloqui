import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { FFlowModule } from "@foblex/flow";
import {
  EWorkflowNodeType,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";

@Component({
  selector: "app-workflow-node",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FFlowModule],
  template: `
      <div
        class="wf-builder-node"
        [class.is-channel]="node().type === channelType"
        [class.is-branch]="node().type === branchType"
        [class.is-conditional]="node().type === conditionalType"
        [class.has-error]="hasError()"
        [class.is-selected]="isSelected()"
      >
      <div
        class="wf-node-input"
        fNodeInput
        [fInputId]="node().key + '-in'"
        fInputConnectableSide="left"
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
      ></div>
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
    /* Node-type accent stripe — mirrors the design's KIND_STRIPE mapping
       (channel: green, branch: purple, conditional: yellow); port/type
       color mapping for the remaining node kinds is T04's scope. */
    .wf-builder-node.is-channel {
      border-color: var(--rd-green);
    }
    .wf-builder-node.is-branch {
      border-color: var(--rd-purple);
    }
    .wf-builder-node.is-conditional {
      border-color: var(--rd-yellow);
    }
    .wf-builder-node.is-selected {
      border-color: var(--rd-accent);
      box-shadow: 0 0 0 2px var(--rd-accent-soft);
    }
    .wf-builder-node.has-error {
      border-color: var(--rd-red);
      box-shadow: 0 0 0 2px var(--rd-red-dim);
    }
    .wf-builder-node.has-error:hover {
      border-color: var(--rd-red);
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
    .wf-node-input,
    .wf-node-output {
      position: absolute;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--rd-line-3);
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
    .wf-node-input:hover,
    .wf-node-output:hover {
      background: var(--rd-accent);
    }
  `,
})
export class WorkflowNodeComponent {
  readonly node = input.required<IWorkflowNode>();
  readonly hasError = input<boolean>(false);
  /** Highlights this card when it's the currently-selected node in the builder's config panel. */
  readonly isSelected = input<boolean>(false);
  readonly selected = output<string>();

  readonly channelType = EWorkflowNodeType.CHANNEL;
  readonly branchType = EWorkflowNodeType.BRANCH;
  readonly conditionalType = EWorkflowNodeType.CONDITIONAL;

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
