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
import { nodeTypeShortLabel } from "./node-type-short-label";
import { summarizeNodeConfig } from "./summarize-node-config";
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
        fInputConnectableSide="top"
        [style.background]="accentColor()"
      ></div>

      <div class="wf-node-content">
        <div
          class="wf-node-icon-wrap"
          [style.background]="iconChipBackground()"
        >
          <mat-icon [style.color]="accentColor()">{{ node().icon }}</mat-icon>
        </div>
        <div class="wf-node-name">{{ node().name }}</div>
        <span
          class="wf-node-type-badge"
          data-testid="wf-node-type-badge"
          [style.color]="accentColor()"
          [style.border-color]="accentColor()"
        >{{ typeBadgeLabel() }}</span>
      </div>

      @if (configSummary(); as summary) {
        <div class="wf-node-summary" data-testid="wf-node-summary">
          {{ summary }}
        </div>
      }

      <div
        class="wf-node-output"
        fNodeOutput
        [fOutputId]="node().key + '-out'"
        fOutputConnectableSide="bottom"
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
      /* Background is bound to iconChipBackground() (a tinted accentColor())
         per design mockup 11-builder.png, which colors the leading icon chip
         by node type (green for the trigger, purple for agent nodes, etc.) —
         this rule only sets shape/fallback. */
      background: var(--rd-hover);
      flex-shrink: 0;
    }
    .wf-node-icon-wrap mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      /* Color is bound to accentColor() via [style.color] above; this is
         only the fallback for the (unreachable in practice) unbound case. */
      color: var(--rd-accent);
    }
    .wf-node-name {
      flex: 1;
      min-width: 0;
      font-size: var(--rd-text-size-base);
      font-weight: 600;
      color: var(--rd-text-1);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Type badge (SPEC T03) — "TRIGGER" for the inbound-channel trigger
       node, else the short type label (node-type-short-label.ts), colored
       via the EXISTING nodeTypeColorToken mapping (decision 4, AMENDED). */
    .wf-node-type-badge {
      flex-shrink: 0;
      font-family: var(--rd-font-mono);
      font-size: 9px;
      letter-spacing: 0.5px;
      border: 1px solid;
      border-radius: var(--rd-radius-5);
      padding: 1px 6px;
      opacity: 0.9;
    }
    /* One-line mono config summary (SPEC T03) — derived purely from
       existing per-type configuration fields, see summarize-node-config.ts.
       Hidden entirely when empty (nothing meaningful to show yet). */
    .wf-node-summary {
      padding: 0 16px 9px;
      font-family: var(--rd-font-mono);
      font-size: 10.5px;
      color: var(--rd-text-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Port dot fill color is bound to accentColor() via [style.background]
       (SPEC decision 4, AMENDED); the base rule below only sets
       shape/position, the type color always wins. Layout is vertical
       (top -> bottom), so ports sit on the top/bottom edges rather than
       left/right — see fInputConnectableSide/fOutputConnectableSide above. */
    .wf-node-input,
    .wf-node-output {
      position: absolute;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--rd-panel);
      left: 50%;
      transform: translateX(-50%);
      z-index: 1;
      cursor: crosshair;
    }
    .wf-node-input {
      top: -6px;
    }
    .wf-node-output {
      bottom: -6px;
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
   * Leading icon-chip background (design mockup 11-builder.png): a tinted
   * version of the SAME accentColor() token used by the border/ports/badge
   * (decision 4, AMENDED) — no new color mapping, just `color-mix` applied
   * to the existing per-type token so the chip reads as "this node's color,
   * softened" rather than a flat neutral square.
   */
  readonly iconChipBackground = computed(
    () => `color-mix(in srgb, ${this.accentColor()} 18%, transparent)`
  );

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

    // Verbose logging per SPEC T03: trace the derived config summary so an
    // empty (hidden) summary line is traceable back to "no meaningful
    // config yet" rather than a silent rendering bug.
    effect(() => {
      const summary = this.configSummary();
      console.debug("[WorkflowNodeComponent] config summary derived", {
        nodeKey: this.node().key,
        type: this.node().type,
        summary: summary || "(empty — hidden)",
      });
    });
  }

  /**
   * A node is "the trigger" when it's the inbound-channel entry point of
   * the flow (mirrors `WorkflowBuilderComponent.triggerAccountIds`' own
   * CHANNEL + direction==="inbound" check — same signal, no new state).
   */
  readonly isTriggerNode = computed(
    () =>
      this.node().type === this.channelType &&
      this.node().configuration["direction"] === "inbound"
  );

  /**
   * Node-card type badge text (SPEC T03, mock's `bn.tag`): "TRIGGER" for
   * the trigger node, else the short type label shared with the palette
   * dock (node-type-short-label.ts). Colored via `accentColor()`
   * (EXISTING nodeTypeColorToken mapping, decision 4 AMENDED).
   */
  readonly typeBadgeLabel = computed(() =>
    this.isTriggerNode() ? "TRIGGER" : nodeTypeShortLabel(this.node().type)
  );

  /**
   * One-line mono config summary (SPEC T03) — derived purely from this
   * node's EXISTING configuration fields via the pure `summarizeNodeConfig`
   * function; empty string when there is nothing meaningful yet.
   */
  readonly configSummary = computed(() => summarizeNodeConfig(this.node()));
}
