import { DecimalPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";
import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import { TraceSelectionService } from "../trace-selection.service";
import type { BusinessFnGroup } from "./business-fn-group";
import {
  computeBottleneck,
  computeWaterfallRows,
  type IWaterfallRow,
} from "./waterfall-geometry";
import {
  computeTimeAxisTicks,
  type ITimeAxisTick,
} from "./waterfall-time-axis";

const GROUP_LABEL: Record<BusinessFnGroup, string> = {
  channel: "Channel",
  platform: "Platform",
  agent: "Agent",
  other: "Other",
};

// Business-fn group swatch colors — matches the design mock's legend
// (Rediseño Terminal.dc.html, waterfall legend, ~line 761-764). Values are
// the --rd-group-* tokens defined in styles.scss, which reference the
// existing --rd-green/--rd-accent/--rd-purple/--rd-text-3 palette tokens.
const GROUP_COLOR: Record<BusinessFnGroup, string> = {
  channel: "var(--rd-group-channel)",
  platform: "var(--rd-group-platform)",
  agent: "var(--rd-group-agent)",
  other: "var(--rd-group-other)",
};

const LEGEND_GROUPS: readonly BusinessFnGroup[] = [
  "channel",
  "platform",
  "agent",
  "other",
];

/**
 * Causal waterfall view for a correlation's tracked-event chain: events
 * ordered on a time axis, indented by `causation_depth`, spans rendered as
 * duration bars and point events as rotated-square diamonds, colored by
 * `business_fn` group (SPEC.md `manual-loops/trace-console.md` T05).
 *
 * Data-agnostic: the chain is provided by the parent (T07 wires the fetch).
 *
 * Row click → `TraceSelectionService.select(eventId, "waterfall")` (T03 of
 * `manual-loops/admin-console/console-redesign-trace.md`, per the design
 * mock's clickable waterfall rows — `Rediseño Terminal.dc.html` line 747).
 * `TraceSelectionService` is component-provided at the ancestor
 * `TraceDetailComponent` (its own header comment explains the provider
 * scope); `inject()` here walks the standard hierarchical injector up to
 * that provider — no local/view-local selection signal exists on this
 * component (the Constraints' "selection ONLY via TraceSelectionService"
 * rule forbids one). The selected row's highlight is driven purely by the
 * service's `selectedEventId`/`sourceView` signals, read directly in the
 * template.
 *
 * T07 (`manual-loops/admin-console/console-redesign-polish.md`, T01 finding
 * 11) adds the time-axis ruler row (`.wf-ruler`) above the grid, matching
 * the mock's ms-tick header (`Rediseño Terminal.dc.html` lines 734-744) —
 * pure geometry off the SAME `chain().summary.total_ms` the rows already
 * position their bars against (`waterfall-time-axis.ts`), aligned to the
 * grid via the SAME 260px label-column width as `.wf-row`.
 */
@Component({
  selector: "app-trace-waterfall",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="wf">
      <header class="wf-chips">
        <span class="wf-chip">
          <span class="wf-chip-label">correlation</span>
          <span class="wf-chip-value wf-mono">{{ chain().correlation_id }}</span>
        </span>
        <span class="wf-chip">
          <span class="wf-chip-label">total duration</span>
          <span class="wf-chip-value">{{ chain().summary.total_ms }} ms</span>
        </span>
        @if (bottleneck(); as b) {
          <span class="wf-chip wf-chip-bottleneck">
            <span class="wf-chip-label">bottleneck</span>
            <span class="wf-chip-value"
              >{{ b.label }} · {{ b.durationMs }} ms ({{
                b.percentOfTotal | number: "1.0-1"
              }}%)</span
            >
          </span>
        } @else {
          <span class="wf-chip">
            <span class="wf-chip-label">bottleneck</span>
            <span class="wf-chip-value">none</span>
          </span>
        }
      </header>

      <div class="wf-ruler" role="presentation" aria-hidden="true">
        <span class="wf-ruler-spacer"></span>
        <div class="wf-ruler-track">
          @for (tick of timeAxisTicks(); track tick.percent) {
            <span class="wf-ruler-tick" [style.left.%]="tick.percent">{{
              tick.ms | number: "1.0-0"
            }}ms</span>
          }
        </div>
        <span class="wf-ruler-spacer"></span>
      </div>

      <div class="wf-grid" role="table" aria-label="Waterfall trace">
        @for (row of rows(); track row.eventId) {
          <div
            class="wf-row"
            role="row"
            tabindex="0"
            [class.wf-row-selected]="isSelected(row)"
            (click)="onRowClick(row)"
            (keydown.enter)="onRowClick(row)"
          >
            <div
              class="wf-row-label"
              [style.paddingLeft.px]="row.depth * 16"
            >
              <span class="wf-event-name">{{ row.label }}</span>
              <span class="wf-event-service">{{ row.service }}</span>
            </div>
            <div class="wf-track">
              @if (row.isPoint) {
                <svg
                  class="wf-point"
                  [style.left.%]="row.startPercent"
                  viewBox="0 0 10 10"
                >
                  <rect
                    x="1"
                    y="1"
                    width="8"
                    height="8"
                    transform="rotate(45 5 5)"
                    [attr.fill]="colorFor(row)"
                  />
                </svg>
              } @else {
                <svg
                  class="wf-bar"
                  [style.left.%]="row.startPercent"
                  [style.width.%]="barWidth(row)"
                  viewBox="0 0 100 10"
                  preserveAspectRatio="none"
                >
                  <rect
                    x="0"
                    y="1"
                    width="100"
                    height="8"
                    rx="2"
                    [attr.fill]="colorFor(row)"
                  />
                </svg>
              }
            </div>
          </div>
        }
      </div>

      <footer class="wf-legend">
        @for (g of legendGroups; track g) {
          <span class="wf-legend-item">
            <span class="wf-legend-swatch" [style.background]="colorOf(g)"></span>
            {{ labelOf(g) }}
          </span>
        }
      </footer>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .wf {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .wf-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-7, 8px);
      padding: var(--rd-space-5, 10px) var(--rd-space-7, 14px);
      font-size: var(--rd-text-size-sm, 12px);
    }
    .wf-chip {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .wf-chip-label {
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-2xs, 11px);
    }
    .wf-chip-value {
      font-weight: 500;
      color: var(--rd-text-1, #ededed);
    }
    .wf-chip-bottleneck .wf-chip-value {
      color: var(--rd-red, #b3261e);
    }
    .wf-mono {
      font-family: var(--rd-font-mono, monospace);
    }
    .wf-ruler {
      display: grid;
      grid-template-columns: 260px 1fr;
      align-items: center;
      gap: 8px;
    }
    .wf-ruler-track {
      position: relative;
      height: 14px;
    }
    .wf-ruler-tick {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      font-family: var(--rd-font-mono, monospace);
      font-size: var(--rd-text-size-2xs, 9px);
      color: var(--rd-text-3, #7a7a7a);
      white-space: nowrap;
    }
    .wf-ruler-tick:first-child {
      transform: translateX(0);
    }
    .wf-ruler-tick:last-child {
      transform: translateX(-100%);
    }
    .wf-grid {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .wf-row {
      display: grid;
      grid-template-columns: 260px 1fr;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      border-radius: var(--rd-radius-5, 6px);
      padding: 0 4px;
      margin: 0 -4px;
      cursor: pointer;
    }
    .wf-row:hover {
      background: var(--rd-panel, #141414);
    }
    .wf-row-selected {
      background: var(--rd-accent-soft, rgba(26, 102, 255, 0.12));
      outline: 1px solid var(--rd-accent, #1a66ff);
      outline-offset: -1px;
    }
    .wf-row-label {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .wf-event-name {
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 500;
      color: var(--rd-text-1, #ededed);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wf-event-service {
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3, #7a7a7a);
    }
    .wf-track {
      position: relative;
      height: 16px;
      background: var(--rd-line-2, #161616);
      border-radius: var(--rd-radius-3, 4px);
    }
    .wf-bar {
      position: absolute;
      top: 0;
      height: 16px;
      min-width: 2px;
    }
    .wf-point {
      position: absolute;
      top: 3px;
      width: 10px;
      height: 10px;
      transform: translateX(-5px);
    }
    .wf-legend {
      display: flex;
      gap: var(--rd-space-8, 16px);
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-3, #7a7a7a);
    }
    .wf-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .wf-legend-swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
  `,
})
export class TraceWaterfallComponent {
  readonly chain = input.required<ITrackingChainResponse>();

  /** Shared cross-view selection (T02/T03) — walks up to the
   * `TraceDetailComponent`-provided instance; NOT `providedIn: "root"` (see
   * `TraceSelectionService`'s header comment). No view-local selection
   * signal is declared here (Constraints: view-local selected state is
   * automatic rejection). */
  private readonly selection = inject(TraceSelectionService);

  readonly legendGroups = LEGEND_GROUPS;

  readonly rows = computed(() => computeWaterfallRows(this.chain()));
  readonly bottleneck = computed(() => computeBottleneck(this.chain()));

  /** T07: time-axis ruler ticks, pure geometry off the chain's total_ms
   * (`waterfall-time-axis.ts`) — see this component's header comment. */
  readonly timeAxisTicks = computed<readonly ITimeAxisTick[]>(() =>
    computeTimeAxisTicks(this.chain().summary.total_ms)
  );

  colorFor(row: IWaterfallRow): string {
    return GROUP_COLOR[row.group];
  }

  colorOf(group: BusinessFnGroup): string {
    return GROUP_COLOR[group];
  }

  labelOf(group: BusinessFnGroup): string {
    return GROUP_LABEL[group];
  }

  /** Bar width in percent, clamped to a visible minimum. */
  barWidth(row: IWaterfallRow): number {
    return Math.max(row.widthPercent, 0.5);
  }

  /** Selected-row highlight — reads the shared service's signals directly,
   * no local state. */
  isSelected(row: IWaterfallRow): boolean {
    return this.selection.selectedEventId() === row.eventId;
  }

  /** Row click (and Enter, for keyboard access) → shared selection (T03,
   * per the design mock's clickable waterfall rows). Verbose logging: every
   * new selection-triggering path logs the row it selected. */
  onRowClick(row: IWaterfallRow): void {
    console.debug("[TraceWaterfallComponent] row clicked, selecting event", {
      eventId: row.eventId,
      label: row.label,
      correlationId: this.chain().correlation_id,
    });
    this.selection.select(row.eventId, "waterfall");
  }
}
