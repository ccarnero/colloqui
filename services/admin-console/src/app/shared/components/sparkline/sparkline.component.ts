import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from "@angular/core";

@Component({
  selector: "app-sparkline",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="sparkline"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      preserveAspectRatio="none"
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
      margin-top: 8px;
    }
  `,
})
export class SparklineComponent {
  readonly data = input<number[]>([]);
  readonly color = input("#4f7ef8");

  readonly width = 240;
  readonly height = 36;
  private readonly pad = 2;

  private static idCounter = 0;
  private readonly uniqueId = ++SparklineComponent.idCounter;

  readonly gradientId = computed(() => `sg-${this.uniqueId}`);

  readonly linePoints = computed(() => {
    const values = this.data();
    if (values.length < 2) return "";
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
    if (!line) return "";
    return `${this.pad},${this.height} ${line} ${this.width - this.pad},${this.height}`;
  });
}
