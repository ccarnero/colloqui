import { DecimalPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import type { BusinessFnGroup } from "./business-fn-group";
import {
  computeBottleneck,
  computeWaterfallRows,
  type IWaterfallRow,
} from "./waterfall-geometry";

const GROUP_LABEL: Record<BusinessFnGroup, string> = {
  channel: "Channel",
  platform: "Platform",
  agent: "Agent",
  other: "Other",
};

const GROUP_COLOR: Record<BusinessFnGroup, string> = {
  channel: "#2f9e44",
  platform: "#185fa5",
  agent: "#9c36b5",
  other: "#868e96",
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

      <div class="wf-grid" role="table" aria-label="Waterfall trace">
        @for (row of rows(); track row.eventId) {
          <div class="wf-row" role="row">
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
      border: 1px solid var(--border-subtle, #ddd);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
    }
    .wf-chip {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .wf-chip-label {
      color: var(--text3, #888);
      font-size: 11px;
    }
    .wf-chip-value {
      font-weight: 500;
    }
    .wf-chip-bottleneck .wf-chip-value {
      color: var(--red, #b3261e);
    }
    .wf-mono {
      font-family: var(--font-mono, monospace);
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
      min-height: 24px;
    }
    .wf-row-label {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .wf-event-name {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wf-event-service {
      font-size: 10px;
      color: var(--text3, #888);
    }
    .wf-track {
      position: relative;
      height: 16px;
      background: var(--bg2, #f5f5f5);
      border-radius: 4px;
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
      gap: 16px;
      font-size: 12px;
      color: var(--text3, #888);
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

  readonly legendGroups = LEGEND_GROUPS;

  readonly rows = computed(() => computeWaterfallRows(this.chain()));
  readonly bottleneck = computed(() => computeBottleneck(this.chain()));

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
}
