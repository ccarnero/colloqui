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
import { ProcessesMetricsService } from "../../core/services/metrics/processes-metrics.service";

interface ITopWorkflow {
  id: string;
  name: string;
  runs7d: number;
  successRate: number;
}

/**
 * Processes section landing — replaces the Phase 2 Automate landing.
 *
 * Fleet view: how many workflows + schedules, current health, top
 * workflows by usage, recent executions across all of them. Drilling
 * into a workflow opens the Phase 3 detail mini-app.
 */
@Component({
  selector: "app-processes-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionLandingShellComponent,
    KpiCardComponent,
    ActivityFeedComponent,
  ],
  template: `
    <app-section-landing-shell
      title="Processes"
      subtitle="Workflows y schedules"
      [hasSecondary]="true"
    >
      <div slot="actions">
        <button class="btn" type="button" (click)="goToSchedules()">
          Schedules
        </button>
        <button class="btn btn-primary" type="button" (click)="newWorkflow()">
          + New workflow
        </button>
      </div>

      <div slot="kpis" class="kpis">
        <app-kpi-card
          label="Workflows active"
          [value]="metrics.workflowsActive() ?? '—'"
          [sub]="failingSub()"
        />
        <app-kpi-card
          label="Executions today"
          [value]="execTotalLabel()"
          [sub]="execBreakdownSub()"
        />
        <app-kpi-card
          label="Schedules active"
          [value]="metrics.schedulesActive() ?? '—'"
          [sub]="nextRunSub()"
        />
        <app-kpi-card label="Services" value="up" sub="all healthy" />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Top workflows · last 7 days</h2>
        @for (w of topWorkflows(); track w.id) {
          <a class="row" (click)="openWorkflow(w)">
            <span class="name">{{ w.name }}</span>
            <span class="runs">{{ formatNum(w.runs7d) }} runs</span>
            <span class="rate" [class.bad]="w.successRate < 0.9">
              {{ (w.successRate * 100).toFixed(1) }}%
            </span>
          </a>
        }
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent executions</h2>
        <app-activity-feed [entries]="recentExecutions()" />
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
      padding: 9px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--bg3); }
    .name {
      flex: 1;
      color: var(--text-primary);
      font-weight: 500;
      font-family: var(--font-mono, monospace);
    }
    .runs {
      color: var(--text2);
      font-variant-numeric: tabular-nums;
      width: 90px;
      text-align: right;
    }
    .rate {
      color: var(--text2);
      font-variant-numeric: tabular-nums;
      width: 60px;
      text-align: right;
    }
    .rate.bad { color: var(--red, #ef4444); font-weight: 500; }
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
  `,
})
export class ProcessesLandingComponent {
  protected readonly metrics = inject(ProcessesMetricsService);
  private readonly router = inject(Router);

  protected readonly failingSub = computed(() => {
    const f = this.metrics.workflowsFailing() ?? 0;
    return f > 0 ? `${f} failing` : "all healthy";
  });

  protected readonly execTotalLabel = computed(() => {
    const s = this.metrics.executionsSuccessToday() ?? 0;
    const f = this.metrics.executionsFailedToday() ?? 0;
    return this.formatNum(s + f);
  });

  protected readonly execBreakdownSub = computed(() => {
    const s = this.metrics.executionsSuccessToday() ?? 0;
    const f = this.metrics.executionsFailedToday() ?? 0;
    return `${this.formatNum(s)} ok · ${f} failed`;
  });

  protected readonly nextRunSub = computed(() => {
    const t = this.metrics.schedulesNextRun();
    return t ? `next run · ${t}` : "no upcoming runs";
  });

  protected readonly topWorkflows = computed<ITopWorkflow[]>(() => [
    { id: "lead-qualification", name: "lead-qualification", runs7d: 1_247, successRate: 0.964 },
    { id: "support-routing", name: "support-routing", runs7d: 982, successRate: 0.991 },
    { id: "daily-summary", name: "daily-summary", runs7d: 168, successRate: 1 },
    { id: "lead-enrichment", name: "lead-enrichment", runs7d: 412, successRate: 0.88 },
    { id: "abandoned-cart", name: "abandoned-cart", runs7d: 304, successRate: 0.97 },
  ]);

  protected readonly recentExecutions = computed<IActivityEntry[]>(() => [
    { time: "2m ago", tone: "danger", html: '<strong>lead-qualification</strong> · run failed at score-lead' },
    { time: "5m ago", tone: "ok", html: '<strong>support-routing</strong> · run ok · 1.2s' },
    { time: "12m ago", tone: "ok", html: '<strong>daily-summary</strong> · run ok · 4.8s' },
    { time: "18m ago", tone: "warn", html: '<strong>lead-enrichment</strong> · http retry · ok' },
  ]);

  protected formatNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  protected openWorkflow(w: ITopWorkflow): void {
    void this.router.navigate(["/workflows", w.id]);
  }

  protected newWorkflow(): void {
    void this.router.navigate(["/workflows", "new"]);
  }

  protected goToSchedules(): void {
    void this.router.navigate(["/schedules"]);
  }
}
