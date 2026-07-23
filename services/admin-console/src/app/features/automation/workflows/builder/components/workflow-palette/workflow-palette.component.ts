import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { FFlowModule } from "@foblex/flow";
import { EWorkflowNodeType } from "../../../domain/workflow-node.types";
import {
  DEFAULT_NODE_MAP,
  type INodeDefault,
} from "../../../domain/workflow-node-defaults";
import { nodeTypeColorToken } from "../workflow-node/node-type-color";
import { nodeTypeShortLabel } from "../workflow-node/node-type-short-label";

interface IDockChip {
  type: EWorkflowNodeType;
  defaults: INodeDefault;
  shortLabel: string;
  color: string;
  dividerAfter: boolean;
}

/**
 * Node types after which the mock's dock (`Rediseño Terminal.dc.html:1561-
 * 1574`, `dockItems`) renders a divider: `CHAN, JS | HTTP, MCP, SVC, EVT |
 * AGENT | PAR, IF`. Sourced verbatim from the design ground truth, not the
 * domain `group` field (which categorizes the four Integrations types
 * together under one label but the mock still separates them visually only
 * by icon, no divider — this table matches the mock pixel-for-pixel).
 */
const DOCK_DIVIDER_AFTER = new Set<EWorkflowNodeType>([
  EWorkflowNodeType.JS_FUNCTION,
  EWorkflowNodeType.SERVICE_BUS_CALL,
  EWorkflowNodeType.AGENT_CALL,
]);

@Component({
  selector: "app-workflow-palette",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FFlowModule],
  template: `
    <div
      class="wf-dock"
      role="toolbar"
      aria-label="Add workflow node"
      data-testid="workflow-palette-dock"
    >
      @for (chip of chips; track chip.type) {
        <div
          class="wf-dock-item"
          fExternalItem
          [fData]="chip.type"
          [attr.title]="chip.defaults.name"
          [attr.aria-label]="chip.defaults.name"
          data-testid="workflow-palette-chip"
        >
          <mat-icon [style.color]="chip.color">{{
            chip.defaults.icon
          }}</mat-icon>
          <span class="wf-dock-label">{{ chip.shortLabel }}</span>
        </div>
        @if (chip.dividerAfter) {
          <span class="wf-dock-divider"></span>
        }
      }
    </div>
  `,
  styles: `
    /* Floating bottom-center dock (SPEC T03) — replaces the old full-height
       left sidebar. Positioned absolutely by the host, which is placed as
       a sibling of <f-flow> inside .builder-canvas-wrap (already
       position:relative) so it floats over the canvas per the mock. */
    :host {
      position: absolute;
      bottom: var(--rd-space-8);
      left: 50%;
      transform: translateX(-50%);
      z-index: 5;
      pointer-events: none;
    }
    .wf-dock {
      display: flex;
      align-items: center;
      gap: 2px;
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-8);
      padding: var(--rd-space-3);
      box-shadow: var(--rd-shadow-lg);
      pointer-events: auto;
      /*
       * Prevent text selection while dragging chips onto the canvas —
       * without this, repeated drags accumulate selection highlights that
       * block subsequent drags until the user clicks outside the builder.
       */
      user-select: none;
      -webkit-user-select: none;
    }
    .wf-dock-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: var(--rd-space-3) var(--rd-space-4);
      border-radius: var(--rd-radius-6);
      cursor: grab;
    }
    .wf-dock-item:hover {
      background: var(--rd-hover);
    }
    .wf-dock-item mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .wf-dock-label {
      font-family: var(--rd-font-mono);
      font-size: 8.5px;
      letter-spacing: 0.3px;
      color: var(--rd-text-3);
    }
    .wf-dock-divider {
      width: 1px;
      height: 26px;
      background: var(--rd-line-2);
      margin: 0 var(--rd-space-2);
    }
  `,
})
export class WorkflowPaletteComponent {
  /**
   * Dock chips, one per palette entry — SAME node types and SAME create
   * wiring as the old sidebar (`fExternalItem`/`[fData]`, consumed by
   * `f-flow[fDraggable]`'s `fCreateNode` in `WorkflowBuilderComponent`).
   * Only the container markup/styling changed for T03.
   */
  readonly chips: IDockChip[];

  constructor() {
    this.chips = Object.entries(DEFAULT_NODE_MAP).map(([type, defaults]) => {
      const nodeType = type as EWorkflowNodeType;
      return {
        type: nodeType,
        defaults,
        shortLabel: nodeTypeShortLabel(nodeType),
        color: nodeTypeColorToken(nodeType),
        dividerAfter: DOCK_DIVIDER_AFTER.has(nodeType),
      };
    });

    // Verbose logging per SPEC constraints: trace dock composition once
    // per mount so a missing/reordered chip is traceable in logs.
    console.debug("[WorkflowPaletteComponent] dock chips built", {
      count: this.chips.length,
      types: this.chips.map((c) => c.type),
    });
  }
}
