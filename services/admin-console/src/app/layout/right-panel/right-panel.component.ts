import { Component, inject } from "@angular/core";
import { NotificationService } from "../../core/services/notification.service";
import { SparklineComponent } from "../../shared/components/sparkline/sparkline.component";
import { ProgressBarComponent } from "../../shared/components/progress-bar/progress-bar.component";

@Component({
  selector: "app-right-panel",
  imports: [SparklineComponent, ProgressBarComponent],
  template: `
    <aside class="panel">
      <!-- Tenant Health -->
      <div class="rp-section">
        <div class="rp-title">Tenant Health</div>
        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Uptime</span>
            <span class="metric-value" style="color: var(--green)">99.98%</span>
          </div>
          <div class="metric-sub">Last 30 days</div>
          <app-sparkline
            [data]="[100, 100, 99.9, 100, 100, 100, 99.98]"
            color="#22c55e"
          />
        </div>
        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Error Rate</span>
            <span class="metric-value" style="color: var(--yellow)">0.12%</span>
          </div>
          <div class="metric-sub">&#8595; 0.03% from yesterday</div>
        </div>
        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Avg Response</span>
            <span class="metric-value">48ms</span>
          </div>
          <div class="metric-sub">p95: 120ms</div>
        </div>
      </div>

      <!-- Quota Usage -->
      <div class="rp-section">
        <div class="rp-title">Quota Usage</div>
        <div class="quota-row">
          <div class="quota-header">
            <span class="quota-label">API Calls</span>
            <span class="quota-val">84.2K / 100K</span>
          </div>
          <app-progress-bar [value]="84" color="var(--yellow)" />
        </div>
        <div class="quota-row">
          <div class="quota-header">
            <span class="quota-label">Storage</span>
            <span class="quota-val">42 / 100 GB</span>
          </div>
          <app-progress-bar [value]="42" />
        </div>
        <div class="quota-row">
          <div class="quota-header">
            <span class="quota-label">Webhooks</span>
            <span class="quota-val">4 / 20</span>
          </div>
          <app-progress-bar [value]="20" />
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="rp-section">
        <div class="rp-title">Recent Activity</div>
        @for (item of notificationService.notifications(); track item.text) {
          <div class="activity-item">
            <div class="activity-dot" [style.background]="item.color"></div>
            <div>
              <div class="activity-text">{{ item.text }}</div>
              <div class="activity-time">{{ item.time }}</div>
            </div>
          </div>
        }
      </div>
    </aside>
  `,
  styles: `
    .panel {
      background: var(--bg2);
      border-left: 1px solid var(--border);
      overflow-y: auto;
      padding: 16px;
      height: 100%;
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }
  `,
})
export class RightPanelComponent {
  protected readonly notificationService = inject(NotificationService);
}
