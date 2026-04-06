import { ChangeDetectionStrategy, Component } from "@angular/core";
import { ProgressBarComponent } from "../../../shared/components/progress-bar/progress-bar.component";

@Component({
  selector: "app-quotas",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProgressBarComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Quotas & Limits</div>
        <div class="ws-subtitle">
          Monitor usage against your plan limits
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">Resource usage</div>
        <div class="section-card-sub">
          Values update as your tenant consumes resources
        </div>
      </div>
      <div class="section-card-body">
        @for (q of quotaRows; track q.label) {
          <app-progress-bar
            [label]="q.label"
            [current]="q.current"
            [max]="q.max"
          />
        }
      </div>
    </div>
  `,
  styles: `
    .section-card-body {
      padding-top: 4px;
    }
  `,
})
export class QuotasComponent {
  readonly quotaRows = [
    { label: "API Calls (per day)", current: 842_000, max: 1_000_000 },
    { label: "Storage", current: 38, max: 50 },
    { label: "Users", current: 142, max: 200 },
    { label: "Webhooks", current: 12, max: 20 },
    { label: "Workflows", current: 8, max: 15 },
  ] as const;
}
