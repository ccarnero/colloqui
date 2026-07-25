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
import { nodeTypeTintToken } from "../workflow-node/node-type-tint";

interface IDockChip {
  type: EWorkflowNodeType;
  defaults: INodeDefault;
  shortLabel: string;
  color: string;
  tint: string;
}

interface IPaletteGroup {
  name: string;
  chips: IDockChip[];
}

/**
 * Palette groups, derived from `DEFAULT_NODE_MAP`'s own `group` field (SPEC
 * T05 of console-redesign-builder-v2.md — "Grouping per DEFAULT_NODE_MAP's
 * group field"), preserving the map's declaration order within and across
 * groups. This intentionally REPLACES the previous (T04-era, v1/rejected)
 * dock divider table that hand-matched the mock's bottom-center dock pixel
 * layout — the binding contract's PRESERVE item 2 override says the mock's
 * *visual language* (chip/label/section styling) is ported onto the
 * left-rail *layout*, not its literal grouping, so the rail groups by the
 * real domain taxonomy (Channels / Logic / Integrations / AI / Flow
 * Control) instead of the mock's one-off `dockItems` array.
 */
function buildPaletteGroups(): IPaletteGroup[] {
  const groups: IPaletteGroup[] = [];
  const groupIndexByName = new Map<string, number>();

  for (const [type, defaults] of Object.entries(DEFAULT_NODE_MAP)) {
    const nodeType = type as EWorkflowNodeType;
    const chip: IDockChip = {
      type: nodeType,
      defaults,
      shortLabel: nodeTypeShortLabel(nodeType),
      color: nodeTypeColorToken(nodeType),
      tint: nodeTypeTintToken(nodeType),
    };

    const existingIndex = groupIndexByName.get(defaults.group);
    if (existingIndex === undefined) {
      groupIndexByName.set(defaults.group, groups.length);
      groups.push({ name: defaults.group, chips: [chip] });
    } else {
      groups[existingIndex]?.chips.push(chip);
    }
  }

  return groups;
}

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
      @for (group of groups; track group.name; let isFirst = $first) {
        @if (!isFirst) {
          <span class="wf-dock-divider"></span>
        }
        <div
          class="wf-dock-group"
          [attr.aria-label]="group.name"
          data-testid="workflow-palette-group"
          [attr.data-group]="group.name"
        >
          <span class="wf-dock-group-label">{{ group.name }}</span>
          @for (chip of group.chips; track chip.type) {
            <div
              class="wf-dock-item"
              fExternalItem
              [fData]="chip.type"
              [attr.title]="chip.defaults.name"
              [attr.aria-label]="chip.defaults.name"
              data-testid="workflow-palette-chip"
            >
              <span class="wf-dock-item-tile" [style.background]="chip.tint">
                <mat-icon [style.color]="chip.color">{{
                  chip.defaults.icon
                }}</mat-icon>
              </span>
              <span class="wf-dock-label">{{ chip.shortLabel }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    /*
     * Floating LEFT vertical rail (design mockup 11-builder.png moved this
     * from a bottom-center horizontal dock to a left rail; same visual
     * language as the agent configure screen's collapsed icon rail —
     * icon + tiny label stacked in a floating pill container, see
     * agent-editor-nav.component.ts's ".palette"/".palette-item"). Vertically
     * centered on the canvas's left edge so it never collides with the
     * floating-top chrome or the bottom-left zoom cluster. Positioned
     * absolutely by the host, a sibling of <f-flow> inside
     * .builder-canvas-wrap (already position:relative).
     */
    :host {
      position: absolute;
      left: var(--rd-space-8);
      top: 50%;
      transform: translateY(-50%);
      z-index: 5;
      pointer-events: none;
      max-height: calc(100% - var(--rd-space-8) * 4);
    }
    .wf-dock {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      background: var(--rd-panel);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-8);
      padding: var(--rd-space-3);
      box-shadow: var(--rd-shadow-lg);
      pointer-events: auto;
      max-height: 100%;
      overflow-y: auto;
      /*
       * Prevent text selection while dragging chips onto the canvas —
       * without this, repeated drags accumulate selection highlights that
       * block subsequent drags until the user clicks outside the builder.
       */
      user-select: none;
      -webkit-user-select: none;
    }
    /* Section (group) wrapper — one per DEFAULT_NODE_MAP group, SPEC T05. */
    .wf-dock-group {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
    }
    /* Uppercase mono section label (reference's "chip/label/section
       styling" — the mock's dock chips already use uppercase mono item
       labels; this extends the same type ramp to the group header so the
       rail communicates DEFAULT_NODE_MAP's grouping, which the mock's
       bottom dock never needed to since it hand-authored its own flat
       9-item list). */
    .wf-dock-group-label {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      letter-spacing: var(--rd-tracking-2);
      color: var(--rd-text-3);
      text-transform: uppercase;
      padding: var(--rd-space-1) var(--rd-space-3);
      opacity: 0.8;
    }
    .wf-dock-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--rd-space-1);
      padding: var(--rd-space-3) var(--rd-space-4);
      border-radius: var(--rd-radius-6);
      cursor: grab;
    }
    .wf-dock-item:hover {
      background: var(--rd-hover);
    }
    .wf-dock-item:active {
      background: var(--rd-hover);
      cursor: grabbing;
    }
    /* Icon tile: filled, type-tinted square behind the glyph — mirrors the
       node card's icon-chip treatment (node-type-tint.ts / node-card.css
       KIND_TINT) so the rail and the cards on canvas read as the same
       visual system. */
    .wf-dock-item-tile {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: var(--rd-radius-6);
      flex-shrink: 0;
    }
    .wf-dock-item-tile mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .wf-dock-label {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-8-5);
      letter-spacing: var(--rd-tracking-1);
      color: var(--rd-text-3);
    }
    /* Divider between chip groups — horizontal now that the dock is a
       vertical rail (was a vertical bar between horizontally-laid-out
       chips). */
    .wf-dock-divider {
      height: 1px;
      width: 100%;
      background: var(--rd-line-2);
      margin: var(--rd-space-2) 0;
    }
  `,
})
export class WorkflowPaletteComponent {
  /**
   * Palette groups, one per `DEFAULT_NODE_MAP` `group` value (SPEC T05) —
   * SAME node types and SAME create wiring as before (`fExternalItem`/
   * `[fData]`, consumed by `f-flow[fDraggable]`'s `fCreateNode` in
   * `WorkflowBuilderComponent`). Only the container markup/styling and the
   * grouping source changed for T05.
   */
  readonly groups: IPaletteGroup[];

  constructor() {
    this.groups = buildPaletteGroups();

    // Verbose logging per SPEC constraints: trace rail composition once
    // per mount so a missing/reordered chip or group is traceable in logs.
    console.debug("[WorkflowPaletteComponent] rail groups built", {
      groupCount: this.groups.length,
      groups: this.groups.map((g) => ({
        name: g.name,
        types: g.chips.map((c) => c.type),
      })),
    });
  }
}
