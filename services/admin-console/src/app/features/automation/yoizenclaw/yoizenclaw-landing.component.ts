import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router } from "@angular/router";
import { SectionLandingShellComponent } from "../../../shared/components/section-landing-shell/section-landing-shell.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import {
  ActivityFeedComponent,
  type IActivityEntry,
} from "../../../shared/components/activity-feed/activity-feed.component";
import { AiMetricsService } from "../../../core/services/metrics/ai-metrics.service";

interface ITopAgent {
  name: string;
  tokens: number;
  /** Bar fill percentage 0–100, derived from tokens / max. */
  pct: number;
}

/**
 * AI section landing page.
 *
 * Three KPIs (active agents, tokens MTD, pending memory proposals) above a
 * 50/50 split: top agents by usage on the left, recent activity on the
 * right. Top-agents and activity are demo data for Phase 2 — wire to
 * yoizenclaw-admin endpoints in a later phase.
 */
@Component({
  selector: "app-yoizenclaw-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionLandingShellComponent,
    KpiCardComponent,
    ActivityFeedComponent,
  ],
  template: `
    <app-section-landing-shell
      title="AI · Yoizenclaw"
      subtitle="Agentes, herramientas, memorias y playground"
      [hasSecondary]="true"
    >
      <div slot="actions">
        <button class="btn" type="button" (click)="goToPlayground()">
          Open playground
        </button>
        <button class="btn btn-primary" type="button" (click)="newAgent()">
          + New agent
        </button>
      </div>

      <div slot="kpis" class="kpis">
        <app-kpi-card
          label="Active agents"
          [value]="ai.activeAgents() ?? '—'"
          sub="+2 this week"
          trend="up"
          trendLabel=""
        />
        <app-kpi-card
          label="Tokens MTD"
          [value]="formattedTokens()"
          [sub]="costSub()"
        />
        <app-kpi-card
          label="Memory proposals"
          [value]="ai.pendingMemoryProposals() ?? 0"
          sub="pending review"
        />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Top agents · last 7 days</h2>
        @for (a of topAgents(); track a.name) {
          <div class="agent-row">
            <span class="agent-name">{{ a.name }}</span>
            <span class="bar-bg"><span class="bar-fill" [style.width.%]="a.pct"></span></span>
            <span class="agent-val">{{ formatTokens(a.tokens) }}</span>
          </div>
        }
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent activity</h2>
        <app-activity-feed [entries]="recentActivity()" />
      </div>
    </app-section-landing-shell>
  `,
  styles: `
    :host {
      display: block;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
    .agent-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
      font-size: 12px;
    }
    .agent-name {
      width: 130px;
      color: var(--text-primary);
      flex-shrink: 0;
    }
    .bar-bg {
      flex: 1;
      height: 4px;
      background: var(--bg3);
      border-radius: 2px;
      overflow: hidden;
    }
    .bar-fill {
      display: block;
      height: 100%;
      background: var(--primary, #1a66ff);
    }
    .agent-val {
      color: var(--text2);
      width: 60px;
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
    .btn:hover { background: var(--bg3); }
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
    .btn-primary:hover { opacity: 0.9; }
  `,
})
export class YoizenclawLandingComponent {
  protected readonly ai = inject(AiMetricsService);
  private readonly router = inject(Router);

  protected readonly formattedTokens = computed(() => {
    const t = this.ai.tokensMtd();
    if (t === null) return "—";
    return `${(t / 1_000_000).toFixed(1)}M`;
  });

  protected readonly costSub = computed(() => {
    const c = this.ai.costMtd();
    return c === null ? "" : `$${c} · 38% of budget`;
  });

  // PHASE 2 DEMO DATA — top agents and recent activity.
  protected readonly topAgents = computed<ITopAgent[]>(() => {
    const raw = [
      { name: "support-bot", tokens: 1_200_000 },
      { name: "sales-qualifier", tokens: 680_000 },
      { name: "intake-form", tokens: 410_000 },
      { name: "scheduler", tokens: 190_000 },
    ];
    const max = Math.max(...raw.map((a) => a.tokens));
    return raw.map((a) => ({ ...a, pct: Math.round((a.tokens / max) * 100) }));
  });

  protected readonly recentActivity = computed<IActivityEntry[]>(() => [
    {
      time: "2m ago",
      tone: "info",
      html: '<strong>support-bot</strong> invoked tool search-kb',
    },
    {
      time: "14m ago",
      tone: "ok",
      html: 'Memory proposal accepted on <strong>sales-qualifier</strong>',
    },
    {
      time: "1h ago",
      tone: "neutral",
      text: "Playground session by chris@yoizen.com",
    },
    {
      time: "3h ago",
      tone: "danger",
      html: '<strong>intake-form</strong> tool error · timeout',
    },
  ]);

  protected formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(n);
  }

  protected goToPlayground(): void {
    void this.router.navigate(["/yoizenclaw/playground"]);
  }

  protected newAgent(): void {
    void this.router.navigate(["/yoizenclaw/agents/new"]);
  }
}
