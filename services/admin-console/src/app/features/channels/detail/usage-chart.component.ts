import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type {
  IUsageBucketRow,
  UsageBucket,
  UsageDirection,
} from "../../../core/models/channel-streams.model";

interface IChartSeries {
  readonly id: UsageDirection;
  readonly label: string;
  readonly color: string;
  readonly linePoints: string;
  readonly fillPoints: string;
  readonly pointCx: number;
  readonly pointCy: number;
  readonly pointHasValue: boolean;
}

interface IChartModel {
  readonly width: number;
  readonly height: number;
  readonly bucketCount: number;
  readonly maxValue: number;
  readonly hasData: boolean;
  readonly series: ReadonlyArray<IChartSeries>;
}

export interface IUsageChartRange {
  readonly from: string;
  readonly to: string;
  readonly bucket: UsageBucket;
}

const SERIES_COLORS: Record<UsageDirection, { readonly label: string; readonly color: string }> =
  {
    ingress: { label: "Ingress", color: "#4f7ef8" },
    egress: { label: "Egress", color: "#22c55e" },
    dlq: { label: "DLQ", color: "#ef4444" },
  };

const DIRECTION_ORDER: ReadonlyArray<UsageDirection> = ["ingress", "egress", "dlq"];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const CHART_WIDTH = 600;
const CHART_HEIGHT = 180;
const CHART_PAD = 4;

function intervalMsFor(bucket: UsageBucket): number {
  return bucket === "day" ? DAY_MS : HOUR_MS;
}

/**
 * Generates the dense list of bucket boundary keys spanning the requested
 * range, aligned to UTC interval boundaries to match TimescaleDB's
 * `time_bucket(...)` output. The bucket key is the ISO string of the
 * boundary timestamp so it can be matched 1:1 with what the backend emits
 * in `mapBucketRows`.
 */
function generateBucketGrid(range: IUsageChartRange): string[] {
  const fromMs = new Date(range.from).getTime();
  const toMs = new Date(range.to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return [];
  }
  const step = intervalMsFor(range.bucket);
  const start = Math.ceil(fromMs / step) * step;
  if (start >= toMs) return [];
  const count = Math.ceil((toMs - start) / step);
  const out = new Array<string>(count);
  let writeIndex = 0;
  for (let t = start; t < toMs; t += step) {
    out[writeIndex++] = new Date(t).toISOString();
  }
  if (writeIndex !== count) {
    out.length = writeIndex;
  }
  return out;
}

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

      @if (!chart().hasData) {
        <div class="usage-chart__empty">No usage data for the selected range.</div>
      } @else if (chart().bucketCount === 1) {
        <svg
          class="usage-chart__svg"
          [attr.viewBox]="'0 0 ' + chart().width + ' ' + chart().height"
          preserveAspectRatio="none"
          role="img"
          aria-label="Usage over time"
        >
          @for (s of chart().series; track s.id) {
            @if (s.pointHasValue) {
              <circle
                [attr.cx]="s.pointCx"
                [attr.cy]="s.pointCy"
                r="3"
                [attr.fill]="s.color"
              />
            }
          }
        </svg>
      } @else {
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
  readonly range = input<IUsageChartRange | null>(null);
  /**
   * Kept for backwards compatibility with the parent template — no longer
   * drives the empty-state decision now that the timeline is densified
   * client-side. `hasData` (computed from `data`) controls rendering.
   */
  readonly hasRecentActivity = input<boolean>(false);

  readonly chart = computed<IChartModel>(() => {
    const rows = this.data();
    const range = this.range();

    const byBucket = new Map<string, Map<UsageDirection, number>>();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      let inner = byBucket.get(row.bucket);
      if (!inner) {
        inner = new Map<UsageDirection, number>();
        byBucket.set(row.bucket, inner);
      }
      inner.set(row.direction, (inner.get(row.direction) ?? 0) + row.events);
    }

    const buckets = range
      ? generateBucketGrid(range)
      : Array.from(byBucket.keys()).sort();
    const bucketCount = buckets.length;

    if (bucketCount === 0) {
      return {
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
        bucketCount: 0,
        maxValue: 0,
        hasData: false,
        series: DIRECTION_ORDER.map((id) => ({
          id,
          label: SERIES_COLORS[id].label,
          color: SERIES_COLORS[id].color,
          linePoints: "",
          fillPoints: "",
          pointCx: 0,
          pointCy: 0,
          pointHasValue: false,
        })),
      };
    }

    let maxValue = 0;
    let totalEvents = 0;
    const valuesByDir = new Map<UsageDirection, number[]>();
    for (let d = 0; d < DIRECTION_ORDER.length; d += 1) {
      const dir = DIRECTION_ORDER[d]!;
      const values = new Array<number>(bucketCount);
      for (let i = 0; i < bucketCount; i += 1) {
        const key = buckets[i]!;
        const inner = byBucket.get(key);
        const v = inner?.get(dir) ?? 0;
        values[i] = v;
        if (v > maxValue) maxValue = v;
        totalEvents += v;
      }
      valuesByDir.set(dir, values);
    }

    const hasData = totalEvents > 0;
    const rangeMax = maxValue === 0 ? 1 : maxValue;
    const spanX = CHART_WIDTH - CHART_PAD * 2;
    const spanY = CHART_HEIGHT - CHART_PAD * 2;
    const baseY = CHART_HEIGHT - CHART_PAD;

    const series: IChartSeries[] = DIRECTION_ORDER.map((id) => {
      const values = valuesByDir.get(id) ?? [];

      if (bucketCount === 1) {
        const v = values[0] ?? 0;
        const cx = CHART_WIDTH / 2;
        const cy = baseY - (v / rangeMax) * spanY;
        return {
          id,
          label: SERIES_COLORS[id].label,
          color: SERIES_COLORS[id].color,
          linePoints: "",
          fillPoints: "",
          pointCx: cx,
          pointCy: cy,
          pointHasValue: v > 0,
        };
      }

      const denom = bucketCount - 1;
      const linePointsParts = new Array<string>(bucketCount);
      for (let i = 0; i < bucketCount; i += 1) {
        const v = values[i] ?? 0;
        const x = CHART_PAD + (i / denom) * spanX;
        const y = baseY - (v / rangeMax) * spanY;
        linePointsParts[i] = `${x.toFixed(2)},${y.toFixed(2)}`;
      }
      const linePoints = linePointsParts.join(" ");
      const fillPoints = `${CHART_PAD.toFixed(2)},${CHART_HEIGHT} ${linePoints} ${(CHART_WIDTH - CHART_PAD).toFixed(2)},${CHART_HEIGHT}`;

      return {
        id,
        label: SERIES_COLORS[id].label,
        color: SERIES_COLORS[id].color,
        linePoints,
        fillPoints,
        pointCx: 0,
        pointCy: 0,
        pointHasValue: false,
      };
    });

    return {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      bucketCount,
      maxValue,
      hasData,
      series,
    };
  });
}
