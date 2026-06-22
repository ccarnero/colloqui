import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import {
  getAgentLlmConfig,
  type IAgent,
} from "../../../../core/models/agent.model";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import { KpiCardComponent } from "../../../../shared/components/kpi-card/kpi-card.component";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";

@Component({
  selector: "app-ai-agent-overview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UtcDatePipe, KpiCardComponent],
  template: `
    @if (loading()) {
      <p class="empty">Loading agent overview...</p>
    }

    @if (!loading() && agent(); as current) {
      <div class="kpis">
        <app-kpi-card
          label="Status"
          [value]="current.status"
          sub="lifecycle"
        />
        <app-kpi-card
          label="Skills"
          [value]="current.model_config.subagents.length"
          sub="enabled"
        />
        <app-kpi-card
          label="Tools"
          [value]="current.tools.length"
          sub="configured"
        />
        <app-kpi-card
          label="Channels"
          [value]="current.channels.length"
          sub="attached"
        />
      </div>

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Summary</div>
            <div class="section-card-sub">
              Provider, model and update metadata
            </div>
          </div>
          <button class="btn btn-primary btn-sm" type="button" (click)="goConfigure()">
            Edit configuration
          </button>
        </div>

        <div class="section-card-body">
          <p class="summary">{{ current.description || "No description yet." }}</p>

          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">Provider</span>
              <strong>{{ llmProvider() }}</strong>
            </div>
            <div class="meta-item">
              <span class="meta-label">Model</span>
              <strong>{{ llmModel() }}</strong>
            </div>
            <div class="meta-item">
              <span class="meta-label">Created</span>
              <strong>{{ current.created_at | utcDate: "medium" }}</strong>
            </div>
            <div class="meta-item">
              <span class="meta-label">Updated</span>
              <strong>{{ current.updated_at | utcDate: "medium" }}</strong>
            </div>
          </div>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }

    .summary {
      margin: 0;
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.5;
    }

    .meta-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .meta-item {
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 10px;
      background: var(--bg2);
      display: grid;
      gap: 4px;
    }

    .meta-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .empty {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0;
      padding: 12px 0;
    }
  `,
})
export class AiAgentOverviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agentAdminService = inject(AgentAdminService);

  private readonly agentId =
    this.route.parent?.snapshot.paramMap.get("id") ?? "";

  protected readonly loading = signal(false);
  protected readonly agent = signal<IAgent | null>(null);

  protected readonly llmProvider = computed(() => {
    const current = this.agent();
    if (!current) {
      return "—";
    }

    return getAgentLlmConfig(current.model_config).provider || "—";
  });

  protected readonly llmModel = computed(() => {
    const current = this.agent();
    if (!current) {
      return "—";
    }

    return getAgentLlmConfig(current.model_config).model || "—";
  });

  ngOnInit(): void {
    this.loading.set(true);

    this.agentAdminService.getAgent(this.agentId).subscribe({
      next: (agent) => {
        this.agent.set(agent);
        this.loading.set(false);
      },
      error: () => {
        this.agent.set(null);
        this.loading.set(false);
      },
    });
  }

  protected goConfigure(): void {
    void this.router.navigate(["/ai/agents", this.agentId, "configure"]);
  }
}
