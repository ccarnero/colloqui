import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-environments",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Environments</div>
        <div class="ws-subtitle">Manage deployment environments</div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm">+ New Environment</button>
      </div>
    </div>

    <div class="cards-grid">
      @for (env of environments; track env.name) {
        <div class="section-card">
          <div class="section-card-header">
            <div>
              <div class="section-card-title">{{ env.name }}</div>
              <div class="section-card-sub">{{ env.url }}</div>
            </div>
            <app-status-badge [status]="env.status" />
          </div>
          <div class="section-card-body">
            <div class="env-stat"><span class="text-muted">Services:</span> <strong>{{ env.services }}</strong></div>
            <div class="env-stat"><span class="text-muted">Last Deploy:</span> <strong>{{ env.lastDeploy }}</strong></div>
            <div class="env-stat"><span class="text-muted">Version:</span> <strong>{{ env.version }}</strong></div>
            <div style="margin-top: 12px; display: flex; gap: 8px">
              <button class="btn btn-secondary btn-sm">Deploy</button>
              <button class="btn btn-secondary btn-sm">Rollback</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .env-stat { font-size: 13px; padding: 4px 0; }
  `,
})
export class EnvironmentsComponent {
  readonly environments = [
    {
      name: "Development",
      url: "dev.platform.yoizen.io",
      status: "active",
      services: 13,
      lastDeploy: "10 min ago",
      version: "v2.4.1-dev",
    },
    {
      name: "Staging",
      url: "staging.platform.yoizen.io",
      status: "active",
      services: 13,
      lastDeploy: "2 hrs ago",
      version: "v2.4.0",
    },
    {
      name: "Production",
      url: "platform.yoizen.io",
      status: "active",
      services: 13,
      lastDeploy: "1 day ago",
      version: "v2.3.8",
    },
  ];
}
