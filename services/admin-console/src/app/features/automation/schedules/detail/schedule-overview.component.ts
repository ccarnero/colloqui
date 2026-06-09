import { DatePipe, JsonPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { SchedulerApiService } from "../../../../core/services/scheduler-api.service";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import type { IAgent } from "../../../../core/models/agent.model";
import type { IJob } from "../../../../core/models/scheduler.model";
import { StatusBadgeComponent } from "../../../../shared/components/status-badge/status-badge.component";

/**
 * Stateless overview tab for a schedule.
 * Displays KPIs in a grid: status, schedule, agent, dates, payload.
 */
@Component({
  selector: "app-schedule-overview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, JsonPipe, StatusBadgeComponent],
  template: `
    @if (job(); as j) {
      <div class="overview-grid">
        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Status</div>
          </div>
          <div class="section-card-body">
            <app-status-badge [status]="j.is_active ? 'active' : 'inactive'" />
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Schedule</div>
          </div>
          <div class="section-card-body">
            <code class="schedule-code">{{ j.schedule }}</code>
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Agent</div>
          </div>
          <div class="section-card-body">
            {{ agentName() ?? j.agent_id }}
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Last Run</div>
          </div>
          <div class="section-card-body">
            {{ j.last_run ? (j.last_run | date:'medium') : 'Never' }}
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Next Run</div>
          </div>
          <div class="section-card-body">
            {{ j.next_run ? (j.next_run | date:'medium') : '—' }}
          </div>
        </div>

        <div class="section-card">
          <div class="section-card-header">
            <div class="section-card-title">Created</div>
          </div>
          <div class="section-card-body">
            {{ j.created_at | date:'medium' }}
          </div>
        </div>
      </div>

      @if (hasPayload(j)) {
        <div class="section-card action-card">
          <div class="section-card-header">
            <div class="section-card-title">Action</div>
          </div>
          <div class="section-card-body">
            <span class="action-type">{{ getActionType(j) }}</span>
            @if (getActionConfig(j); as config) {
              <pre class="payload-json">{{ config | json }}</pre>
            }
          </div>
        </div>
      }
    } @else {
      <div class="loading">Loading schedule...</div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .overview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .section-card-header {
      padding: 10px 14px 0;
    }
    .section-card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text2);
    }
    .section-card-body {
      padding: 8px 14px 14px;
      font-size: 14px;
      color: var(--text-primary);
    }
    .schedule-code {
      font-size: 13px;
      background: var(--bg2);
      padding: 3px 8px;
      border-radius: 4px;
      color: var(--accent, #4f7ef8);
    }
    .payload-card {
      margin-top: 0;
    }
    .action-type {
      font-size: 13px;
      font-weight: 600;
      color: var(--accent, #4f7ef8);
      margin-bottom: 8px;
      display: inline-block;
    }
    .payload-json {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
      background: var(--bg2);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      color: var(--text-primary);
    }
    .loading {
      font-size: 13px;
      color: var(--text3);
      padding: 24px 0;
      text-align: center;
    }
  `,
})
export class ScheduleOverviewComponent implements OnInit {
  private readonly api = inject(SchedulerApiService);
  private readonly agentAdmin = inject(AgentAdminService);
  private readonly route = inject(ActivatedRoute);

  // Walk up to the parent's :id param since this component is a child route.
  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} },
  );
  private readonly id = computed<string>(() => this.parentParams()["id"] ?? "");

  readonly job = signal<IJob | null>(null);
  readonly agentName = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.id();
    if (id) {
      this.api.getJob(id).subscribe({
        next: (j) => {
          this.job.set(j);
          this.agentAdmin.listAgents({ status: "published" }).subscribe({
            next: (res) => {
              const match = res.agents.find(
                (a: IAgent) => a.id === j.agent_id,
              );
              this.agentName.set(match?.name ?? null);
            },
          });
        },
        error: () => this.job.set(null),
      });
    }
  }

  protected hasPayload(j: IJob): boolean {
    const payload = j.payload as Record<string, unknown> | undefined;
    return !!payload?.["action_type"];
  }

  protected getActionType(j: IJob): string {
    const payload = j.payload as Record<string, unknown> | undefined;
    if (!payload?.["action_type"]) return "Not configured";
    const at = payload["action_type"] as string;
    if (at === "llm_call") return "LLM Call";
    if (at === "webhook") return "Webhook";
    if (at === "function") return "Function";
    return at;
  }

  protected getActionConfig(j: IJob): Record<string, unknown> | null {
    const payload = j.payload as Record<string, unknown> | undefined;
    return (payload?.["action_config"] as Record<string, unknown>) ?? null;
  }
}
