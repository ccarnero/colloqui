import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { FFlowModule } from "@foblex/flow";
import { EWorkflowNodeType } from "../../../domain/workflow-node.types";
import {
  DEFAULT_NODE_MAP,
  type INodeDefault,
} from "../../../domain/workflow-node-defaults";

interface IPaletteGroup {
  label: string;
  items: Array<{ type: EWorkflowNodeType; defaults: INodeDefault }>;
}

@Component({
  selector: "app-workflow-palette",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FFlowModule],
  template: `
    @for (group of groups; track group.label) {
      <div class="palette-group">
        <div class="palette-group-label">{{ group.label }}</div>
        @for (item of group.items; track item.type) {
          <div
            class="palette-item"
            fExternalItem
            [fData]="item.type"
          >
            <mat-icon>{{ item.defaults.icon }}</mat-icon>
            <span>{{ item.defaults.name }}</span>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 220px;
      background: var(--bg-sidebar, var(--bg2));
      border-right: 1px solid var(--border);
      padding: 16px 12px;
      overflow-y: auto;
      flex-shrink: 0;
      /*
       * Prevent text selection while dragging palette items onto the
       * canvas — without this, repeated drags accumulate selection
       * highlights that block subsequent drags until the user clicks
       * outside the builder.
       */
      user-select: none;
      -webkit-user-select: none;
    }
    .palette-group {
      margin-bottom: 16px;
    }
    .palette-group-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text3);
      padding: 0 8px 6px;
    }
    .palette-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: var(--radius, 6px);
      cursor: grab;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.1s;
    }
    .palette-item:hover {
      background: var(--hover-accent, var(--bg3));
    }
    .palette-item mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--accent);
    }
  `,
})
export class WorkflowPaletteComponent {
  readonly groups: IPaletteGroup[];

  constructor() {
    const groupMap = new Map<string, IPaletteGroup>();

    for (const [type, defaults] of Object.entries(DEFAULT_NODE_MAP)) {
      let group = groupMap.get(defaults.group);
      if (!group) {
        group = { label: defaults.group, items: [] };
        groupMap.set(defaults.group, group);
      }
      group.items.push({
        type: type as EWorkflowNodeType,
        defaults,
      });
    }

    this.groups = [...groupMap.values()];
  }
}
