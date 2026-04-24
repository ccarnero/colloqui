import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type {
  IUsageBucketRow,
  UsageDirection,
} from "../../../core/models/channel-streams.model";

interface IChartSeries {
  readonly id: UsageDirection;
  readonly label: string;
  readonly color: string;
  readonly linePoints: string;
  readonly fillPoints: string;
}

interface IChartModel {
  readonly width: number;
  readonly height: number;
  readonly bucketCount: number;
  readonly maxValue: number;
  readonly series: ReadonlyArray<IChartSeries>;
}

const SERIES_COLORS: Record<UsageDirection, { readonly label: string; readonly color: string }> =
  {
    ingress: { label: "Ingress", color: "#4f7ef8" },
    egress: { label: "Egress", color: "#22c55e" },
    dlq: { label: "DLQ", color: "#ef4444" },
  };

const DIRECTION_ORDER: ReadonlyArray<UsageDirection> = ["ingress", "egress", "dlq"];

@Component({
  selector: "app-usage-chart",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="usage-chart">
      <div class="usage-chart__legend">
        @for (s of chart().series; track s.id) {
          <span class="legend-item">
            <span class="legend-dot" [style.background]="s.color"></span>
            {{ s.label }}
          </span>
        }
      </div>

      @if (chart().bucketCount > 1) {
        <svg
          class="usage-chart__svg"
          [attr.viewBox]="'0 0 ' + chart().width + ' ' + chart().height"
          preserveAspectRatio="none"
          role="img"
          aria-label="Usage over time"
        >
          <defs>
            @for (s of chart().series; track s.id) {
              <linearGradient
                [attr.id]="'uc-' + s.id"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" [attr.stop-color]="s.color" stop-opacity=".30" />
                <stop offset="100%" [attr.stop-color]="s.color" stop-opacity="0" />
              </linearGradient>
            }
          </defs>

          @for (s of chart().series; track s.id) {
            <polygon
              [attr.points]="s.fillPoints"
              [attr.fill]="'url(#uc-' + s.id + ')'"
            />
          }
          @for (s of chart().series; track s.id) {
            <polyline
              [attr.points]="s.linePoints"
              fill="none"
              [attr.stroke]="s.color"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          }
        </svg>
      } @else {
        <div class="usage-chart__empty">No usage data for the selected range.</div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .usage-chart {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .usage-chart__legend {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--text3);
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .legend-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .usage-chart__svg {
      width: 100%;
      height: 180px;
    }
    .usage-chart__empty {
      padding: 24px;
      text-align: center;
      color: var(--text3);
      background: var(--bg2);
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
  `,
})
export class UsageChartComponent {
  readonly data = input<ReadonlyArray<IUsageBucketRow>>([]);

  readonly chart = computed<IChartModel>(() => {
    const rows = this.data();
    const width = 600;
    const height = 180;
    const pad = 4;

    const byBucket = new Map<string, Map<UsageDirection, number>>();
    for (const row of rows) {
      let inner = byBucket.get(row.bucket);
      if (!inner) {
        inner = new Map<UsageDirection, number>();
        byBucket.set(row.bucket, inner);
      }
      inner.set(
        row.direction,
        (inner.get(row.direction) ?? 0) + row.events,
      );
    }

    const buckets = Array.from(byBucket.keys()).sort();
    const bucketCount = buckets.length;
    if (bucketCount < 2) {
      return {
        width,
        height,
        bucketCount,
        maxValue: 0,
        series: DIRECTION_ORDER.map((id) => ({
          id,
          label: SERIES_COLORS[id].label,
          color: SERIES_COLORS[id].color,
          linePoints: "",
          fillPoints: "",
        })),
      };
    }

    let maxValue = 0;
    const valuesByDir = new Map<UsageDirection, number[]>();
    for (const dir of DIRECTION_ORDER) {
      const values: number[] = new Array(bucketCount);
      for (let i = 0; i < bucketCount; i += 1) {
        const bucketKey = buckets[i];
        if (bucketKey === undefined) continue;
        const inner = byBucket.get(bucketKey);
        const v = inner?.get(dir) ?? 0;
        values[i] = v;
        if (v > maxValue) maxValue = v;
      }
      valuesByDir.set(dir, values);
    }

    const rangeMax = maxValue === 0 ? 1 : maxValue;
    const spanX = width - pad * 2;
    const spanY = height - pad * 2;

    const series: IChartSeries[] = DIRECTION_ORDER.map((id) => {
      const values = valuesByDir.get(id) ?? [];
      const linePoints = values
        .map((v, i) => {
          const x = pad + (i / (bucketCount - 1)) * spanX;
          const y = height - pad - (v / rangeMax) * spanY;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
      const fillPoints = linePoints
        ? `${pad.toFixed(2)},${height} ${linePoints} ${(width - pad).toFixed(2)},${height}`
        : "";
      return {
        id,
        label: SERIES_COLORS[id].label,
        color: SERIES_COLORS[id].color,
        linePoints,
        fillPoints,
      };
    });

    return { width, height, bucketCount, maxValue, series };
  });
}
