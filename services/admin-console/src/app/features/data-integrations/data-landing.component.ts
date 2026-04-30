import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router } from "@angular/router";
import { SectionLandingShellComponent } from "../../shared/components/section-landing-shell/section-landing-shell.component";
import { KpiCardComponent } from "../../shared/components/kpi-card/kpi-card.component";
import {
  ActivityFeedComponent,
  type IActivityEntry,
} from "../../shared/components/activity-feed/activity-feed.component";
import { DataMetricsService } from "../../core/services/metrics/data-metrics.service";

type ConnectorState = "ok" | "syncing" | "error";

interface IConnector {
  name: string;
  kind: string;
  state: ConnectorState;
  lastSync: string;
}

/**
 * Data section landing.
 *
 * KPIs lean operational; primary panel is the connectors fleet view,
 * secondary is recent syncs. Replicates the same shape as the AI /
 * Channels / Automate landings with section-specific content.
 */
@Component({
  selector: "app-data-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionLandingShellComponent,
    KpiCardComponent,
    ActivityFeedComponent,
  ],
  template: `
    <app-section-landing-shell
      title="Data"
      subtitle="Conectores, integraciones y exportaciones"
      [hasSecondary]="true"
    >
      <div slot="actions">
        <button class="btn" type="button" (click)="goToExports()">Exports</button>
        <button class="btn btn-primary" type="button" (click)="newConnector()">
          + New connector
        </button>
      </div>

      <div slot="kpis" class="kpis">
        <app-kpi-card
          label="Connectors"
          [value]="connectorsLabel()"
          [sub]="connectorsSub()"
        />
        <app-kpi-card
          label="Records 24h"
          [value]="recordsLabel()"
          sub="ingested"
          trend="up"
          trendLabel=""
        />
        <app-kpi-card
          label="Storage"
          value="42.1 GB"
          sub="of 100 GB · 42%"
        />
        <app-kpi-card
          label="Schema drift"
          value="2"
          sub="warnings open"
        />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Connectors</h2>
        @for (c of connectors(); track c.name) {
          <a class="conn-row" (click)="openConnectors()">
            <span class="dot" [class]="'dot-' + c.state" aria-hidden="true"></span>
            <span class="conn-name">{{ c.name }}</span>
            <span class="conn-kind">{{ c.kind }}</span>
            <span class="conn-sync">{{ c.lastSync }}</span>
          </a>
        }
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent syncs</h2>
        <app-activity-feed [entries]="recentSyncs()" />
      </div>
    </app-section-landing-shell>
  `,
  styles: `
    :host {
      display: block;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 14px 16px;
    }
    .panel-h {
      font-size: 13px;
      font-weight: 500;
      margin: 0 0 10px;
      color: var(--text-primary);
    }
    .conn-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .conn-row:last-child { border-bottom: none; }
    .conn-row:hover { background: var(--bg3); }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .dot-ok { background: var(--green, #16a34a); }
    .dot-syncing { background: var(--primary, #1a66ff); }
    .dot-error { background: var(--red, #ef4444); }
    .conn-name {
      flex: 1;
      color: var(--text-primary);
      font-weight: 500;
    }
    .conn-kind {
      color: var(--text2);
      width: 80px;
      font-size: 12px;
    }
    .conn-sync {
      color: var(--text3);
      width: 90px;
      text-align: right;
      font-size: 12px;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn:hover { background: var(--bg3); }
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
    .btn-primary:hover { opacity: 0.9; }
  `,
})
export class DataLandingComponent {
  protected readonly metrics = inject(DataMetricsService);
  private readonly router = inject(Router);

  protected readonly connectorsLabel = computed(() => {
    const c = this.metrics.connectorsConnected() ?? 0;
    const e = this.metrics.connectorsErrored() ?? 0;
    const s = this.metrics.connectorsSyncing() ?? 0;
    return `${c + e + s}`;
  });

  protected readonly connectorsSub = computed(() => {
    const c = this.metrics.connectorsConnected() ?? 0;
    const e = this.metrics.connectorsErrored() ?? 0;
    const s = this.metrics.connectorsSyncing() ?? 0;
    return `${c} ok · ${s} syncing · ${e} errored`;
  });

  protected readonly recordsLabel = computed(() => {
    const n = this.metrics.recordsIngested24h() ?? 0;
    return this.formatNum(n);
  });

  // PHASE 2 DEMO DATA.
  protected readonly connectors = computed<IConnector[]>(() => [
    { name: "hubspot-prod", kind: "CRM", state: "ok", lastSync: "2m ago" },
    { name: "stripe-billing", kind: "Billing", state: "ok", lastSync: "8m ago" },
    { name: "salesforce-eu", kind: "CRM", state: "syncing", lastSync: "now" },
    { name: "intercom-app", kind: "Support", state: "ok", lastSync: "14m ago" },
    { name: "snowflake-dwh", kind: "Warehouse", state: "error", lastSync: "1h ago" },
  ]);

  protected readonly recentSyncs = computed<IActivityEntry[]>(() => [
    { time: "now", tone: "info", html: '<strong>salesforce-eu</strong> · syncing 4,210 records' },
    { time: "2m ago", tone: "ok", html: '<strong>hubspot-prod</strong> · 812 contacts updated' },
    { time: "1h ago", tone: "danger", html: '<strong>snowflake-dwh</strong> · auth expired · sync paused' },
    { time: "3h ago", tone: "ok", html: '<strong>stripe-billing</strong> · 24 invoices' },
  ]);

  protected formatNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  protected openConnectors(): void {
    void this.router.navigate(["/connectors"]);
  }

  protected newConnector(): void {
    void this.router.navigate(["/connectors"]);
  }

  protected goToExports(): void {
    void this.router.navigate(["/data-export"]);
  }
}
