import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

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

@Component({
  selector: "app-kpi-card",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
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
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .kpi {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kpi-label {
      font-size: 12px;
      color: var(--text2);
    }
    .kpi-value {
      font-size: 22px;
      font-weight: 500;
      color: var(--text-primary);
      line-height: 1.15;
    }
    .kpi-sub {
      font-size: 12px;
      color: var(--text3);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }
    .kpi-sub-text {
      color: var(--text3);
    }
    .trend-up-good {
      color: var(--green, #16a34a);
      font-weight: 500;
    }
    .trend-up-bad {
      color: var(--red, #ef4444);
      font-weight: 500;
    }
    .trend-down-good {
      color: var(--green, #16a34a);
      font-weight: 500;
    }
    .trend-down-bad {
      color: var(--red, #ef4444);
      font-weight: 500;
    }
    .trend-flat {
      color: var(--text3);
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

  readonly trendArrow = computed(() => {
    const t = this.trend();
    if (t === "up") return "↑";
    if (t === "down") return "↓";
    if (t === "flat") return "→";
    return "";
  });

  readonly trendClass = computed(() => {
    const t = this.trend();
    if (t === "flat" || t === undefined) return "trend-flat";
    const good = this.trendIsGood();
    if (t === "up") return good ? "trend-up-good" : "trend-up-bad";
    return good ? "trend-down-bad" : "trend-down-good";
  });
}
