import { Component } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import { SparklineComponent } from "../../../shared/components/sparkline/sparkline.component";

@Component({
  selector: "app-system-health",
  imports: [MatIconModule, StatusBadgeComponent, SparklineComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">System Health</div>
        <div class="ws-subtitle">Real-time platform status</div>
      </div>
      <div class="ws-actions">
        <span class="badge badge-green" style="font-size:13px;padding:6px 12px">All Systems Operational</span>
      </div>
    </div>

    <div class="section-card" style="margin-bottom:20px">
      <div class="section-card-header">
        <div class="section-card-title">Platform Services</div>
      </div>
      <div class="section-card-body">
        <div class="health-grid">
          @for (svc of platformServices; track svc.name) {
            <div class="health-card">
              <div class="health-header">
                <span class="health-name">{{ svc.name }}</span>
                <app-status-badge [status]="svc.status" />
              </div>
              <div class="health-stats">
                <div><span class="text-muted text-sm">Uptime:</span> {{ svc.uptime }}</div>
                <div><span class="text-muted text-sm">Latency:</span> {{ svc.latency }}</div>
              </div>
              <app-sparkline [data]="svc.sparkData" [color]="svc.status === 'active' ? '#22c55e' : '#ef4444'" />
            </div>
          }
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">Infrastructure</div>
      </div>
      <div class="section-card-body">
        <div class="health-grid">
          @for (infra of infrastructure; track infra.name) {
            <div class="health-card">
              <div class="health-header">
                <span class="health-name">{{ infra.name }}</span>
                <app-status-badge [status]="infra.status" />
              </div>
              <div class="health-stats">
                <div><span class="text-muted text-sm">Version:</span> {{ infra.version }}</div>
                <div><span class="text-muted text-sm">Latency:</span> {{ infra.latency }}</div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .health-card {
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
    }
    .health-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .health-name {
      font-weight: 600;
      font-size: 13px;
    }
    .health-stats {
      font-size: 12px;
      color: var(--text2);
    }
    .health-stats div {
      padding: 2px 0;
    }
  `,
})
export class SystemHealthComponent {
  readonly platformServices = [
    { name: "API Gateway", status: "active", uptime: "99.99%", latency: "12ms", sparkData: [12, 14, 11, 13, 12, 15, 12] },
    { name: "Auth Service", status: "active", uptime: "99.98%", latency: "8ms", sparkData: [8, 9, 7, 8, 10, 8, 9] },
    { name: "Event Processor", status: "active", uptime: "99.97%", latency: "5ms", sparkData: [5, 6, 4, 5, 7, 5, 6] },
    { name: "Tenant Service", status: "active", uptime: "99.99%", latency: "10ms", sparkData: [10, 11, 9, 10, 12, 10, 11] },
    { name: "Audit Service", status: "active", uptime: "99.95%", latency: "15ms", sparkData: [15, 18, 14, 16, 20, 15, 17] },
    { name: "Webhook Service", status: "active", uptime: "99.90%", latency: "22ms", sparkData: [22, 25, 20, 23, 28, 22, 24] },
    { name: "Metrics Service", status: "active", uptime: "99.98%", latency: "6ms", sparkData: [6, 7, 5, 6, 8, 6, 7] },
    { name: "Cache Service", status: "active", uptime: "99.99%", latency: "1ms", sparkData: [1, 1, 1, 2, 1, 1, 1] },
    { name: "Scheduler Service", status: "active", uptime: "99.96%", latency: "18ms", sparkData: [18, 20, 16, 19, 22, 18, 20] },
    { name: "Registry Service", status: "active", uptime: "99.99%", latency: "4ms", sparkData: [4, 5, 3, 4, 6, 4, 5] },
    { name: "Workflow Service", status: "active", uptime: "99.94%", latency: "25ms", sparkData: [25, 28, 22, 26, 30, 25, 27] },
    { name: "Proxy Service", status: "active", uptime: "99.98%", latency: "3ms", sparkData: [3, 4, 2, 3, 5, 3, 4] },
  ];

  readonly infrastructure = [
    { name: "NATS JetStream", status: "active", version: "2.10", latency: "<1ms" },
    { name: "Redis", status: "active", version: "7.x", latency: "<1ms" },
    { name: "PostgreSQL", status: "active", version: "17", latency: "2ms" },
    { name: "Temporal", status: "active", version: "1.x", latency: "5ms" },
    { name: "Knative Serving", status: "active", version: "1.17", latency: "—" },
    { name: "Kourier", status: "active", version: "1.17", latency: "—" },
  ];
}
