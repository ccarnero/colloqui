import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router } from "@angular/router";
import { KpiCardComponent } from "../../../../shared/components/kpi-card/kpi-card.component";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import {
  type IWorkflowExecutionRow,
  WorkflowApiService,
} from "../services/workflow-api.service";

interface IDayBar {
  label: string;
  /** Heights are 0–100 percent of panel height. */
  okPct: number;
  failPct: number;
}

interface IFailingNode {
  name: string;
  fails: number;
}

/**
 * Workflow Overview sub-tab.
 *
 * Renders 4 KPIs + a 7-day stacked bar chart + top-failing-nodes panel
 * + recent runs list. KPIs and analytics use demo data for Phase 3 since
 * the backend doesn't expose aggregates yet; recent runs use the real
 * `listExecutions` endpoint so the user sees actual data flowing.
 */
@Component({
  selector: "app-workflow-overview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UtcDatePipe, KpiCardComponent],
  template: `
    <div class="ov">
      <div class="kpis">
        <app-kpi-card
          label="Runs · 7d"
          value="1,247"
          sub="vs last week"
          trend="up"
          trendLabel="+12%"
        />
        <app-kpi-card
          label="Success rate"
          value="96.4%"
          sub="vs last week"
          trend="down"
          trendLabel="-0.8%"
          [trendIsGood]="false"
        />
        <app-kpi-card
          label="Avg duration"
          value="2.3s"
          sub="p95 · 4.8s"
        />
        <app-kpi-card
          label="Cost MTD"
          value="$12.40"
          sub="42 tools · 1.8M tokens"
        />
      </div>

      <div class="row2">
        <section class="panel">
          <h2 class="panel-h">Runs · last 7 days</h2>
          <div class="chart" aria-hidden="true">
            @for (d of bars(); track d.label) {
              <div class="bar-stack" [attr.title]="d.label">
                <div class="bar-fail" [style.height.%]="d.failPct"></div>
                <div class="bar-ok" [style.height.%]="d.okPct"></div>
              </div>
            }
          </div>
          <div class="chart-x">
            @for (d of bars(); track d.label) {
              <span>{{ d.label }}</span>
            }
          </div>
        </section>

        <section class="panel">
          <h2 class="panel-h">Top failing nodes · last 7 days</h2>
          @for (n of failingNodes(); track n.name) {
            <div class="fail-row">
              <span class="fail-name">{{ n.name }}</span>
              <span class="fail-count">{{ n.fails }} fails</span>
            </div>
          } @empty {
            <p class="empty">No failures in the last 7 days.</p>
          }
        </section>
      </div>

      <section class="runs">
        <header class="runs-h">
          <h2>Recent runs</h2>
          <a class="link" (click)="goToExecutions()">View all</a>
        </header>
        @if (loadingRuns()) {
          <p class="empty">Loading…</p>
        }
        @if (!loadingRuns()) {
          <div class="runs-list">
            @for (r of recentRuns(); track r.id) {
              <a class="run-row" (click)="openRun(r)">
                <span class="run-status" [class]="'rs-' + statusClass(r.status)">
                  <span class="dot"></span>{{ r.status }}
                </span>
                <span class="run-id">{{ shortId(r.id) }}</span>
                <span class="run-time">{{ r.createdAt | utcDate: "short" }}</span>
              </a>
            } @empty {
              <p class="empty">No runs yet.</p>
            }
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    :host { display: block; }
    .ov {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .row2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 900px) {
      .row2 { grid-template-columns: 1fr; }
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
    .chart {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      height: 90px;
    }
    .bar-stack {
      flex: 1;
      display: flex;
      flex-direction: column-reverse;
      min-height: 2px;
      height: 100%;
    }
    .bar-ok {
      background: var(--primary, #1a66ff);
      border-radius: 2px 2px 0 0;
    }
    .bar-fail {
      background: var(--red, #ef4444);
    }
    .chart-x {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .chart-x span {
      flex: 1;
      text-align: center;
      font-size: 11px;
      color: var(--text3);
    }
    .fail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
    }
    .fail-row:last-child { border-bottom: none; }
    .fail-name { font-family: var(--font-mono, monospace); color: var(--text-primary); }
    .fail-count { color: var(--red, #ef4444); font-weight: 500; }
    .empty {
      font-size: 12px;
      color: var(--text3);
      margin: 8px 0;
    }
    .runs-h {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 4px 0 8px;
    }
    .runs-h h2 {
      font-size: 13px;
      font-weight: 500;
      margin: 0;
      color: var(--text-primary);
    }
    .link {
      font-size: 12px;
      color: var(--primary, #1a66ff);
      cursor: pointer;
    }
    .runs-list {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .run-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
    }
    .run-row:last-child { border-bottom: none; }
    .run-row:hover { background: var(--bg3); }
    .run-status {
      width: 90px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .run-status .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .rs-ok { color: var(--green, #16a34a); }
    .rs-fail { color: var(--red, #ef4444); }
    .rs-running { color: var(--primary, #1a66ff); }
    .rs-other { color: var(--text2); }
    .run-id {
      font-family: var(--font-mono, monospace);
      color: var(--text-primary);
      width: 90px;
    }
    .run-time { color: var(--text2); flex: 1; }
  `,
})
export class WorkflowOverviewComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Walk up to the parent's :id param since this component is a child route.
  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} }
  );
  protected readonly id = computed<string>(
    () => this.parentParams()["id"] ?? ""
  );

  readonly recentRuns = signal<IWorkflowExecutionRow[]>([]);
  readonly loadingRuns = signal(true);

  // PHASE 3 DEMO DATA — analytics until backend exposes aggregates.
  protected readonly bars = signal<IDayBar[]>([
    { label: "Mon", okPct: 60, failPct: 6 },
    { label: "Tue", okPct: 70, failPct: 3 },
    { label: "Wed", okPct: 50, failPct: 9 },
    { label: "Thu", okPct: 56, failPct: 28 },
    { label: "Fri", okPct: 80, failPct: 4 },
    { label: "Sat", okPct: 92, failPct: 3 },
    { label: "Sun", okPct: 75, failPct: 5 },
  ]);

  protected readonly failingNodes = signal<IFailingNode[]>([
    { name: "enrich-lead.http", fails: 28 },
    { name: "score-lead.ai", fails: 11 },
    { name: "send-to-crm.adapter", fails: 6 },
    { name: "notify-slack.webhook", fails: 2 },
  ]);

  ngOnInit(): void {
    const id = this.id();
    if (!id) {
      this.loadingRuns.set(false);
      return;
    }
    this.api
      .listExecutions(id, { page: 0, pageSize: 5, sort: "desc" })
      .subscribe({
        next: (resp) => {
          this.recentRuns.set(resp.items);
          this.loadingRuns.set(false);
        },
        error: () => this.loadingRuns.set(false),
      });
  }

  protected statusClass(status: string): "ok" | "fail" | "running" | "other" {
    const s = status.toLowerCase();
    if (s.includes("complete") || s === "ok" || s === "success") {
      return "ok";
    }
    if (s.includes("fail") || s.includes("error")) {
      return "fail";
    }
    if (s.includes("run")) {
      return "running";
    }
    return "other";
  }

  protected shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  protected openRun(r: IWorkflowExecutionRow): void {
    void this.router.navigate(["/workflows", this.id(), "runs", r.id]);
  }

  protected goToExecutions(): void {
    void this.router.navigate(["/workflows", this.id(), "executions"]);
  }
}
