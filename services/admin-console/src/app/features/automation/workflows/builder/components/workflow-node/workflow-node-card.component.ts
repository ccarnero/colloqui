import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { FFlowModule } from "@foblex/flow";
import {
  EWorkflowNodeType,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";
import { isKnownNodeTypeColor, nodeTypeColorToken } from "./node-type-color";
import { nodeTypeTintToken } from "./node-type-tint";
import { summarizeNodeConfig } from "./summarize-node-config";
import { PLACEHOLDER_NODE_CARD_STATS } from "./workflow-node-card-stats.placeholder";
import type { IWorkflowNodeStats } from "./workflow-node-stats.types";

// Fresh node card component (SPEC T03 of console-redesign-builder-v2.md).
// Ported outward from design/builder-v2-reference/node-card.html +
// node-card.css (the ONE template the design mock uses for every node
// "kind", visuals driven entirely by data - see that file's header comment
// and NOTES.md "Key finding") - NOT an edit of the previous
// workflow-node.component.ts (the rejected v1 attempt, commit 0a91f13d),
// which this task deletes.
//
// Mounted as the Foblex node template by workflow-builder.component.ts:
// fNode / fDragHandle / fNodePosition stay on the host binding site,
// fNodeInput / fNodeOutput (incl. fOutputMultiple for branch/conditional)
// keep their EXACT ids and sides below - dragging, connecting and
// reassigning are unchanged (@foblex/flow still owns graph mechanics, per
// the SPEC's "Strategy" section).
//
// Layout stays vertical (PRESERVE item 1): ports sit on the top/bottom
// edges, not the mock's left/right (the mock is a left-to-right graph;
// the binding contract's PRESERVE section explicitly keeps vertical flow
// and only asks this task to port the mock's visual language onto it).
@Component({
  selector: "app-workflow-node-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, FFlowModule],
  template: `
    <div
      class="wf-node-card"
      [class.is-selected]="isSelected()"
      [class.has-error]="hasError()"
      [style.border-color]="borderColor()"
      [style.box-shadow]="cardShadow()"
    >
      <span
        class="wf-node-card__port wf-node-card__port--top"
        fNodeInput
        [fInputId]="node().key + '-in'"
        fInputConnectableSide="top"
        [style.border-color]="accentColor()"
      ></span>

      <div class="wf-node-card__header">
        <span
          class="wf-node-card__icon-chip"
          [style.background]="tintColor()"
        >
          <mat-icon
            class="wf-node-card__icon"
            [style.color]="accentColor()"
          >{{ node().icon }}</mat-icon>
        </span>
        <span class="wf-node-card__title">{{ node().name }}</span>
        @if (typeBadgeLabel(); as badge) {
          <span
            class="wf-node-card__badge"
            data-testid="wf-node-card-badge"
            [style.color]="accentColor()"
            [style.border-color]="accentColor()"
          >{{ badge }}</span>
        }
      </div>

      @if (configSummary(); as summary) {
        <div class="wf-node-card__summary" data-testid="wf-node-card-summary">
          {{ summary }}
        </div>
      }

      <div class="wf-node-card__stats" data-testid="wf-node-card-stats">
        <span>{{ stats().primaryLabel }}</span>
        @if (stats().secondaryLabel; as secondary) {
          <span>{{ secondary }}</span>
        }
        @if (statusLabel(); as status) {
          <span
            class="wf-node-card__status"
            [class.is-ok]="stats().status === 'ok'"
            [class.is-warning]="stats().status === 'warning'"
            [class.is-error]="stats().status === 'error'"
            data-testid="wf-node-card-status"
          >● {{ status }}</span>
        }
      </div>

      <span
        class="wf-node-card__port wf-node-card__port--bottom"
        fNodeOutput
        [fOutputId]="node().key + '-out'"
        fOutputConnectableSide="bottom"
        [fOutputMultiple]="isMultiOutput()"
        [style.border-color]="accentColor()"
      ></span>
    </div>
  `,
  styles: `
    /*
     * Ported from design/builder-v2-reference/node-card.css (mechanical
     * transcription of the design mock's inline node-card styles, itself
     * ported from Rediseno Terminal.dc.html lines 378-392). Class names
     * below are BEM hooks invented for Angular delivery - the mock has no
     * classes at all (NOTES.md "Key finding"); every value (widths, radii,
     * paddings, font sizes) is copied from that transcription, resolved
     * onto the --rd-* token layer landed by T02, not re-eyeballed.
     *
     * Layout deviation from the reference (PRESERVE item 1, binding
     * contract): ports render on the top/bottom edges instead of
     * left/right, since this builder is a vertical top-to-bottom graph,
     * not the mock's left-to-right one. Every other value below (card
     * proportions, chip geometry, type ramp, spacing) is unchanged from
     * the reference.
     *
     * Border/shadow are neutral by default (line-3 / shadow-xs) and only
     * become type-tinted through the port dots, icon chip and badge below
     * (node-card.css's per-kind rules) - the card border itself does NOT
     * carry the type color; only selection (accent) or error (red)
     * override the neutral border. This corrects the previous
     * (v1/rejected) component, which incorrectly tinted the whole card
     * border by node type.
     */
    :host {
      position: absolute;
    }
    .wf-node-card {
      position: relative;
      width: 236px;
      background: var(--rd-bg);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-10);
      cursor: grab;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .wf-node-card:hover {
      border-color: var(--rd-text-3);
    }
    .wf-node-card.is-selected {
      border-color: var(--rd-accent);
    }
    .wf-node-card.has-error {
      border-color: var(--rd-red);
    }

    /* Header row: icon chip + title + optional type badge. */
    .wf-node-card__header {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4-5);
      padding: var(--rd-space-5-5) var(--rd-space-7) var(--rd-space-4);
    }
    .wf-node-card__icon-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: var(--rd-radius-6);
      flex-shrink: 0;
    }
    .wf-node-card__icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .wf-node-card__title {
      flex: 1;
      min-width: 0;
      font-size: var(--rd-text-size-base);
      font-weight: var(--rd-font-weight-semibold);
      color: var(--rd-text-1);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Type badge (mock's bn.tag chip): TRIGGER for the inbound-channel
       trigger node, else the short type label, colored via the EXISTING
       nodeTypeColorToken mapping (decision 4, AMENDED, reused unchanged). */
    .wf-node-card__badge {
      flex-shrink: 0;
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-3xs);
      letter-spacing: var(--rd-tracking-2);
      border: 1px solid;
      border-radius: var(--rd-radius-4);
      padding: 1px var(--rd-space-3);
      opacity: 0.9;
    }

    /* One-line mono config summary - derived purely from EXISTING node
       configuration fields via summarize-node-config.ts (reused, shipped
       in the polish loop). Hidden entirely when empty. */
    .wf-node-card__summary {
      padding: 0 var(--rd-space-7) var(--rd-space-4-5);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-10-5);
      color: var(--rd-text-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Stats footer row (SPEC T03: STATIC PLACEHOLDER content behind the
       stats input's default value - see
       workflow-node-card-stats.placeholder.ts. T07 passes real data. */
    .wf-node-card__stats {
      display: flex;
      align-items: center;
      gap: var(--rd-space-7);
      padding: var(--rd-space-3-5) var(--rd-space-7);
      border-top: 1px solid var(--rd-line-2);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs);
      color: var(--rd-text-3);
    }
    .wf-node-card__status {
      margin-left: auto;
      color: var(--rd-text-3);
    }
    .wf-node-card__status.is-ok {
      color: var(--rd-green);
    }
    .wf-node-card__status.is-warning {
      color: var(--rd-yellow);
    }
    .wf-node-card__status.is-error {
      color: var(--rd-red);
    }

    /* Connector ports - mock's small ringed dots (node-card.css's
       .node-card__port), tinted per node type via accentColor(). Moved to
       the top/bottom edges (PRESERVE item 1) instead of the mock's
       left/right; same 10px/2px-border geometry. */
    .wf-node-card__port {
      position: absolute;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--rd-bg);
      border-width: 2px;
      border-style: solid;
      left: 50%;
      transform: translateX(-50%);
      cursor: crosshair;
      z-index: 1;
    }
    .wf-node-card__port--top {
      top: -6px;
    }
    .wf-node-card__port--bottom {
      bottom: -6px;
    }
  `,
})
export class WorkflowNodeCardComponent {
  readonly node = input.required<IWorkflowNode>();
  readonly hasError = input<boolean>(false);
  // Highlights this card when it's the currently-selected node in the
  // builder's config panel.
  readonly isSelected = input<boolean>(false);

  // Footer stats (SPEC T03). Defaults to the named STATIC PLACEHOLDER
  // constant (see workflow-node-card-stats.placeholder.ts) so the row's
  // structure always renders, matching the mock (T01 finding 1); T07
  // replaces this at the call site with real per-node data once a genuine
  // aggregate exists.
  readonly stats = input<IWorkflowNodeStats>(PLACEHOLDER_NODE_CARD_STATS);

  readonly channelType = EWorkflowNodeType.CHANNEL;
  readonly branchType = EWorkflowNodeType.BRANCH;
  readonly conditionalType = EWorkflowNodeType.CONDITIONAL;

  // Whether the output port fans out to more than one connection (mirrors
  // the previous component's inline fOutputMultiple expression, extracted
  // into a computed so it is unit-testable directly - @foblex/flow's own
  // "f-node-output-multiple" host class binding forgets to invoke the
  // "multiple" signal (binds to the signal function reference itself,
  // which is always truthy), so asserting on that CSS class in a spec is
  // not meaningful; assert on this computed instead.
  readonly isMultiOutput = computed(
    () =>
      this.node().type === this.branchType ||
      this.node().type === this.conditionalType
  );

  // Port dots / icon-chip glyph / badge color by node type (SPEC decision
  // 4, AMENDED, reused unchanged - see node-type-color.ts). The card
  // border itself is NOT driven by this; see borderColor() below.
  readonly accentColor = computed(() => nodeTypeColorToken(this.node().type));

  // Leading icon-chip background - the mock's KIND_TINT table (SPEC T03),
  // see node-type-tint.ts.
  readonly tintColor = computed(() => nodeTypeTintToken(this.node().type));

  // Card border color: error state takes priority, then selection, then
  // the neutral resting color (mock's default line-3 border) - the type
  // color never drives the border itself (node-card.css: only the
  // selected/channel/conditional/agent rules touch port/chip/badge, not
  // the card's own border).
  readonly borderColor = computed(() => {
    if (this.hasError()) {
      return "var(--rd-red)";
    }
    if (this.isSelected()) {
      return "var(--rd-accent)";
    }
    return "var(--rd-line-3)";
  });

  // Card box-shadow (node-card.css): resting/selected/error, ported
  // verbatim onto --rd-shadow-xs / --rd-shadow-lg (both exact matches for
  // the reference's literal rgba shadow values, see styles.scss).
  readonly cardShadow = computed(() => {
    if (this.hasError()) {
      return "0 0 0 2px var(--rd-red-dim)";
    }
    if (this.isSelected()) {
      return "0 0 0 3px var(--rd-accent-soft), var(--rd-shadow-lg)";
    }
    return "var(--rd-shadow-xs)";
  });

  constructor() {
    // Verbose logging per SPEC line 150 ("nothing fails silently"): log
    // when a node type falls back to the neutral accent color instead of
    // a dedicated KIND_STRIPE entry.
    effect(() => {
      const type = this.node().type;
      if (!isKnownNodeTypeColor(type)) {
        console.debug(
          "[WorkflowNodeCardComponent] node type has no dedicated accent color, using neutral fallback",
          { nodeKey: this.node().key, type }
        );
      }
    });

    // Verbose logging: trace the derived config summary so an empty
    // (hidden) summary line is traceable back to "no meaningful config
    // yet" rather than a silent rendering bug.
    effect(() => {
      const summary = this.configSummary();
      console.debug("[WorkflowNodeCardComponent] config summary derived", {
        nodeKey: this.node().key,
        type: this.node().type,
        summary: summary || "(empty - hidden)",
      });
    });
  }

  // A node is "the trigger" when it's the inbound-channel entry point of
  // the flow (mirrors WorkflowBuilderComponent.triggerAccountIds's own
  // CHANNEL + direction==="inbound" check - same signal, no new state).
  readonly isTriggerNode = computed(
    () =>
      this.node().type === this.channelType &&
      this.node().configuration["direction"] === "inbound"
  );

  // Node-card type badge text (mock's bn.tag): TRIGGER for the trigger
  // node, "IF" for conditional, "AGENT" for agent-call, else undefined
  // (hidden - SPEC T03 anatomy is explicitly "TRIGGER / IF / AGENT /
  // none", not a badge for every node kind; the mock's own Send Reply /
  // Fallback Message channel-action nodes render no tag chip at all -
  // node-card.html variant D, "no tag chip rendered: bn.tag is null").
  readonly typeBadgeLabel = computed<string | undefined>(() => {
    if (this.isTriggerNode()) {
      return "TRIGGER";
    }
    if (this.node().type === this.conditionalType) {
      return "IF";
    }
    if (this.node().type === EWorkflowNodeType.AGENT_CALL) {
      return "AGENT";
    }
    return undefined;
  });

  // One-line mono config summary - derived purely from this node's
  // EXISTING configuration fields via the pure summarizeNodeConfig
  // function (reused unchanged, shipped in the polish loop); empty string
  // when there is nothing meaningful yet.
  readonly configSummary = computed(() => summarizeNodeConfig(this.node()));

  // Status label rendered next to the dot glyph ("ok" / "warning" /
  // "error"), or undefined when the current stats() value carries none
  // (defensive - the placeholder default above always sets "ok").
  readonly statusLabel = computed(() => this.stats().status);
}
