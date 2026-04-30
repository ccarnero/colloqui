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
import { ConnectionsMetricsService } from "../../core/services/metrics/connections-metrics.service";

interface ITopConnector {
  name: string;
  kind: "internal" | "external" | "hosted" | "mcp";
  calls7d: number;
}

/**
 * Connections section landing.
 *
 * Aggregated view across all connection types — Internal HTTP, External
 * HTTP, MCP, Hosted services. KPIs show counts per type; primary panel
 * lists most-used connectors regardless of type; secondary panel is
 * recent activity (errors, sync events, additions).
 *
 * `Most-used connectors` and `Recent activity` are PHASE 4 DEMO data —
 * no aggregate endpoint exists yet.
 */
@Component({
  selector: "app-connections-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionLandingShellComponent,
    KpiCardComponent,
    ActivityFeedComponent,
  ],
  template: `
    <app-section-landing-shell
      title="Connections"
      subtitle="Catálogo de integraciones del tenant"
      [hasSecondary]="true"
    >
      <div slot="actions">
        <button class="btn btn-primary" type="button" (click)="newConnector()">
          + New connector
        </button>
      </div>

      <div slot="kpis" class="kpis">
        <app-kpi-card
          label="HTTP"
          [value]="metrics.httpCount() ?? '—'"
          [sub]="httpSub()"
        />
        <app-kpi-card label="MCP" value="—" sub="backend coming" />
        <app-kpi-card
          label="Hosted services"
          [value]="metrics.hostedCount() ?? '—'"
          sub="all healthy"
        />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Most-used connectors · last 7 days</h2>
        @for (c of topConnectors(); track c.name) {
          <a class="row" (click)="openByKind(c.kind)">
            <span class="name">{{ c.name }}</span>
            <span class="kind">{{ c.kind }}</span>
            <span class="stat">{{ formatNum(c.calls7d) }} calls</span>
          </a>
        }
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent activity</h2>
        <app-activity-feed [entries]="recentActivity()" />
      </div>
    </app-section-landing-shell>
  `,
  styles: `
    :host { display: block; }
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
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--bg3); }
    .name {
      flex: 1;
      color: var(--text-primary);
      font-family: var(--font-mono, monospace);
    }
    .kind { color: var(--text2); width: 70px; font-size: 11px; }
    .stat {
      color: var(--text2);
      width: 90px;
      text-align: right;
      font-variant-numeric: tabular-nums;
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
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
  `,
})
export class ConnectionsLandingComponent {
  protected readonly metrics = inject(ConnectionsMetricsService);
  private readonly router = inject(Router);

  protected readonly httpSub = computed(() => {
    const errs = this.metrics.httpErrored() ?? 0;
    return errs > 0 ? `${errs} errored` : "all healthy";
  });

  protected readonly topConnectors = computed<ITopConnector[]>(() => [
    { name: "hubspot-prod", kind: "external", calls7d: 2_140 },
    { name: "payments-svc", kind: "internal", calls7d: 1_820 },
    { name: "stripe-billing", kind: "external", calls7d: 980 },
    { name: "leads-router", kind: "hosted", calls7d: 612 },
  ]);

  protected readonly recentActivity = computed<IActivityEntry[]>(() => [
    {
      time: "1h ago",
      tone: "danger",
      html: '<strong>snowflake-dwh</strong> · auth expired · external',
    },
    {
      time: "4m ago",
      tone: "ok",
      html: '<strong>salesforce-eu</strong> · sync ok',
    },
    {
      time: "22m ago",
      tone: "info",
      html: '<strong>intercom-app</strong> · tenant added',
    },
  ]);

  protected formatNum(n: number): string {
    return n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
  }

  protected openByKind(kind: ITopConnector["kind"]): void {
    if (kind === "hosted") {
      void this.router.navigate(["/connections", "hosted-services"]);
      return;
    }
    if (kind === "mcp") {
      void this.router.navigate(["/connections", "mcp"]);
      return;
    }
    // internal + external collapse to the same flat HTTP page in v1.
    void this.router.navigate(["/connections", "http"]);
  }

  protected newConnector(): void {
    void this.router.navigate(["/connections", "http"]);
  }
}
