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
        [fOutputMultiple]="node().type === branchType"
      ></div>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
    }
    .wf-builder-node {
      min-width: 180px;
      background: var(--bg-card, var(--bg3));
      border: 1.5px solid var(--border2);
      border-radius: var(--radius2, 8px);
      padding: 0;
      cursor: grab;
      transition: border-color 0.15s, box-shadow 0.15s;
      position: relative;
    }
    .wf-builder-node:hover {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-dim);
    }
    .wf-builder-node.is-channel {
      border-color: var(--green);
    }
    .wf-builder-node.is-branch {
      border-color: var(--purple);
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
      border-radius: 6px;
      background: var(--bg2);
      flex-shrink: 0;
    }
    .wf-node-icon-wrap mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--accent);
    }
    .wf-node-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .wf-node-name {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wf-node-type {
      font-size: 11px;
      color: var(--text3);
    }
    .wf-node-input,
    .wf-node-output {
      position: absolute;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--border2);
      border: 2px solid var(--bg-card, var(--bg3));
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
      background: var(--accent);
    }
  `,
})
export class WorkflowNodeComponent {
  readonly node = input.required<IWorkflowNode>();
  readonly selected = output<string>();

  readonly channelType = EWorkflowNodeType.CHANNEL;
  readonly branchType = EWorkflowNodeType.BRANCH;

  typeLabel(): string {
    const labels: Record<string, string> = {
      channel: "Channel",
      jsFunction: "JS Function",
      endpointCall: "HTTP Connector",
      serviceCall: "Service Call",
      serviceBusCall: "Publish Event",
      branch: "Parallel Branch",
    };
    return labels[this.node().type] ?? this.node().type;
  }
}
