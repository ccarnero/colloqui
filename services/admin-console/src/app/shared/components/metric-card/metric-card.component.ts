import { Component, input, ChangeDetectionStrategy } from "@angular/core";

@Component({
  selector: "app-metric-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="metric-card">
      <div class="metric-row">
        <span class="metric-label">{{ label() }}</span>
        <span class="metric-value" [style.color]="valueColor()">{{
          value()
        }}</span>
      </div>
      @if (subtitle()) {
        <div class="metric-sub">{{ subtitle() }}</div>
      }
      <ng-content />
    </div>
  `,
})
export class MetricCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly subtitle = input<string>();
  readonly valueColor = input<string>();
}
