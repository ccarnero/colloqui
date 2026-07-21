import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

/**
 * Compact trend chart (redesign: dashboard "API usage" chart, analytics
 * "Mensajes" chart, fleet-row mini sparklines — see
 * `Rediseño Terminal.dc.html` lines 130-134, 201-205, 292, 541).
 * Renders a gradient-filled area + line from a plain number series.
 */
@Component({
  selector: "app-sparkline",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="sparkline"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      preserveAspectRatio="none"
      role="img"
      [attr.aria-label]="hasData() ? 'Trend sparkline' : 'No trend data'"
    >
      <defs>
        <linearGradient [attr.id]="gradientId()" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color()" stop-opacity=".3" />
          <stop offset="100%" [attr.stop-color]="color()" stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon
        [attr.points]="fillPoints()"
        [attr.fill]="'url(#' + gradientId() + ')'"
      />
      <polyline
        [attr.points]="linePoints()"
        fill="none"
        [attr.stroke]="color()"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    .sparkline {
      width: 100%;
      height: 36px;
      margin-top: var(--rd-space-4, 8px);
    }
  `,
})
export class SparklineComponent {
  readonly data = input<number[]>([]);
  readonly color = input("var(--rd-accent)");

  readonly width = 240;
  readonly height = 36;
  private readonly pad = 2;

  private static idCounter = 0;
  private readonly uniqueId = ++SparklineComponent.idCounter;

  readonly gradientId = computed(() => `sg-${this.uniqueId}`);

  readonly hasData = computed(() => this.data().length >= 2);

  readonly linePoints = computed(() => {
    const values = this.data();
    if (values.length < 2) {
      // Verbose logging: nothing renders silently — surface why.
      console.debug(
        "[SparklineComponent] insufficient data points, rendering empty chart",
        { length: values.length }
      );
      return "";
    }
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    return values
      .map((v, i) => {
        const x =
          this.pad + (i / (values.length - 1)) * (this.width - this.pad * 2);
        const y =
          this.height -
          this.pad -
          ((v - min) / range) * (this.height - this.pad * 2);
        return `${x},${y}`;
      })
      .join(" ");
  });

  readonly fillPoints = computed(() => {
    const line = this.linePoints();
    if (!line) {
      return "";
    }
    return `${this.pad},${this.height} ${line} ${this.width - this.pad},${this.height}`;
  });
}
