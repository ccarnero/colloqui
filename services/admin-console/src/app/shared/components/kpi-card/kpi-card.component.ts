import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { SparklineComponent } from "../sparkline/sparkline.component";

/**
 * Direction of the trend arrow.
 *  - "up" / "down":   rendered with a semantic color
 *  - "flat":          neutral
 *  - undefined:       no arrow rendered
 *
 * Note that "up" is not always good (e.g. failure rate going up is bad).
 * Pass `trendIsGood` to flip the color semantic per metric.
 */
export type KpiTrendDirection = "up" | "down" | "flat";

/**
 * MetricCard — redesign metric-strip cell (label / big value / delta),
 * see `Rediseño Terminal.dc.html` lines 102-123 (Dashboard KPI row) and
 * 174-195 (Analytics KPI row). Selector/inputs kept as `app-kpi-card` /
 * `KpiCardComponent` for backward compatibility with existing screens.
 */
@Component({
  selector: "app-kpi-card",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SparklineComponent],
  template: `
    <div class="kpi">
      <div class="kpi-label">{{ label() }}</div>
      <div class="kpi-value">{{ value() }}</div>
      @if (sub() || trend() !== undefined) {
        <div class="kpi-sub">
          @if (trend() !== undefined) {
            <span [class]="trendClass()">{{ trendArrow() }} {{ trendLabel() }}</span>
          }
          @if (sub()) {
            <span class="kpi-sub-text">{{ sub() }}</span>
          }
        </div>
      }
      @if (hasSparkline()) {
        <div class="kpi-spark">
          <app-sparkline [data]="sparklineData()!" [color]="sparklineColor()" />
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .kpi {
      background: var(--rd-panel);
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-7, 8px);
      padding: var(--rd-space-8, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-2, 4px);
    }
    .kpi-label {
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-2);
    }
    .kpi-value {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-7xl, 28px);
      font-weight: 500;
      color: var(--rd-text-1);
      line-height: 1.15;
      letter-spacing: -0.5px;
    }
    .kpi-sub {
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-3);
      display: flex;
      align-items: center;
      gap: var(--rd-space-4, 8px);
      margin-top: var(--rd-space-1, 2px);
    }
    .kpi-sub-text {
      color: var(--rd-text-3);
    }
    .kpi-spark {
      margin-top: var(--rd-space-2, 4px);
    }
    .trend-up-good {
      color: var(--rd-green);
      font-weight: 500;
    }
    .trend-up-bad {
      color: var(--rd-red);
      font-weight: 500;
    }
    .trend-down-good {
      color: var(--rd-green);
      font-weight: 500;
    }
    .trend-down-bad {
      color: var(--rd-red);
      font-weight: 500;
    }
    .trend-flat {
      color: var(--rd-text-3);
    }
  `,
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly sub = input<string | undefined>(undefined);
  readonly trend = input<KpiTrendDirection | undefined>(undefined);
  readonly trendLabel = input<string>("");
  /** When true (default), "up" is good and "down" is bad. Flip for failure rates etc. */
  readonly trendIsGood = input<boolean>(true);

  /** Optional inline trend sparkline (redesign: metric card w/ chart slot). */
  readonly sparklineData = input<number[] | undefined>(undefined);
  readonly sparklineColor = input<string>("var(--rd-accent)");

  readonly trendArrow = computed(() => {
    const t = this.trend();
    if (t === "up") {
      return "↑";
    }
    if (t === "down") {
      return "↓";
    }
    if (t === "flat") {
      return "→";
    }
    return "";
  });

  readonly trendClass = computed(() => {
    const t = this.trend();
    if (t === "flat" || t === undefined) {
      return "trend-flat";
    }
    const good = this.trendIsGood();
    if (t === "up") {
      return good ? "trend-up-good" : "trend-up-bad";
    }
    return good ? "trend-down-bad" : "trend-down-good";
  });

  readonly hasSparkline = computed(() => {
    const data = this.sparklineData();
    if (data !== undefined && data.length === 0) {
      // Verbose logging: an explicit empty sparkline must not fail silently.
      console.debug(
        "[KpiCardComponent] sparklineData provided but empty, skipping sparkline render",
        { label: this.label() }
      );
    }
    return data !== undefined && data.length > 0;
  });
}
