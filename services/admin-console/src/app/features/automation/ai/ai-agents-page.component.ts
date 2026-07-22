import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { Router } from "@angular/router";
import {
  AGENT_STATUSES,
  getAgentLlmConfig,
  type IAgent,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { AgentRuntimeService } from "../../../core/services/agent-runtime.service";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../../shared/components/inventory-table/inventory-table.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import type {
  AttentionSeverity,
  IAttentionIssue,
} from "../../../shared/components/needs-attention-panel/needs-attention-panel.component";
import { NeedsAttentionPanelComponent } from "../../../shared/components/needs-attention-panel/needs-attention-panel.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import type { HealthStatus } from "../../../shared/components/status-badge/status-badge.component";
import {
  deriveAgentRuntimeState,
  mapRuntimeStateToHealth,
} from "./agent-runtime-sync.helpers";
import type { IAgentRuntimeHealth } from "./existing-agents-panel.component";

/**
 * Severity used for the agents needs-attention panel. Only agents whose
 * runtime state resolves to the "warn" or "error" health (unsynced /
 * misconfigured, T02 mapping) are surfaced - see `agent-runtime-sync.helpers.ts`.
 * "unsynced" (gateway unreachable) is the more severe/critical condition;
 * "misconfigured" (missing provider/model on a published agent) is a
 * per-agent data problem, mapped to warning.
 */
const RUNTIME_ATTENTION_SEVERITY: Record<
  "unsynced" | "misconfigured",
  AttentionSeverity
> = {
  unsynced: "critical",
  misconfigured: "warning",
};

/**
 * AI agents list page (route `/ai/agents`). Rebuilt per
 * `manual-loops/admin-console/console-redesign-ai.md` T02: MetricCard row +
 * InventoryTable + NeedsAttentionPanel, following the `ChannelsComponent`
 * composition (`features/channels/channels.component.ts`). Data flow is the
 * existing `AgentAdminService.listAgents` + `AgentRuntimeService.checkRuntimeHealth`
 * pair (T01 finding 6) - only the presentation is new; no new endpoints, no
 * invented metrics. Per T01 finding 6, invocations/24h, avg p95, tokens/24h
 * and handoff rate have no backing data source and are intentionally NOT
 * rendered here.
 */
@Component({
  selector: "app-ai-agents-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
    KpiCardComponent,
    InventoryTableComponent,
    NeedsAttentionPanelComponent,
  ],
  template: `
    <app-page-header title="AI agents" subtitle="Manage your AI agents">
      <ng-container slot="actions">
        <button type="button" class="btn btn-primary btn-sm" (click)="onNewAgentClick()">
          <mat-icon>add</mat-icon>
          New agent
        </button>
      </ng-container>
    </app-page-header>

    @if (loading()) {
      <div class="metric-strip metric-strip--loading">
        <div class="metric-skeleton"></div>
      </div>
      <div class="table-wrap" style="padding: 32px; text-align: center;">
        <mat-spinner diameter="32" />
        <p style="margin-top: 12px; color: var(--rd-text-3);">
          Loading agents...
        </p>
      </div>
    } @else if (error()) {
      <div class="alert alert-error">
        <mat-icon>error_outline</mat-icon>
        <div>
          <strong>Failed to load agents</strong>
          <p style="margin-top: 4px;">{{ error() }}</p>
          <button
            class="btn btn-secondary btn-sm"
            style="margin-top: 8px;"
            (click)="loadAgents()"
          >
            Retry
          </button>
        </div>
      </div>
    } @else {
      <!-- Metric row: real, client-derived counts only (T01 finding 6 flags
           invocations/24h, avg p95, tokens/24h and handoff rate as NO-DATA -
           there is no per-agent/aggregate stats endpoint, so they are
           dropped rather than invented). -->
      <div class="metric-strip">
        <app-kpi-card label="Agents" [value]="totalAgents()" />
        <app-kpi-card label="Published" [value]="publishedCount()" />
        <app-kpi-card label="Draft" [value]="draftCount()" />
        <app-kpi-card label="Skills configured" [value]="totalSkills()" />
      </div>

      <!-- Agents inventory: health dot from the real runtime-state
           derivation (checkRuntimeSync, T01 finding 6), mapped per the T02
           mapping in agent-runtime-sync.helpers.ts. Columns are real fields
           only - name, model (provider/model from model_config.llm), status,
           skills count. No invocations/p95/sparkline columns (NO-DATA,
           T01 finding 6). -->
      <app-inventory-table
        [columns]="agentColumns"
        [rows]="agents()"
        ariaLabel="AI agents"
        [emptyMessage]="emptyAgentsMessage()"
        (rowClick)="onAgentRowClick($event)"
      />

      <!-- Needs attention: agents whose derived runtime health is warn or
           error (unsynced / misconfigured), deep-linking to the editor
           route. -->
      <app-needs-attention-panel
        title="Needs attention"
        subtitle="AI agents"
        [issues]="attentionIssues()"
        emptyMessage="No agents need attention"
        (actionClick)="onAttentionActionClick($event)"
      />
    }
  `,
  styles: `
    .metric-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--rd-space-8, 16px);
      margin-bottom: var(--rd-space-8, 16px);
    }
    .metric-strip--loading {
      opacity: 0.4;
    }
    .metric-skeleton {
      grid-column: 1 / -1;
      height: 72px;
      border-radius: var(--rd-radius-7, 8px);
      background: var(--rd-line);
    }
    app-inventory-table {
      display: block;
      margin-bottom: var(--rd-space-8, 16px);
    }
  `,
})
export class AiAgentsPageComponent implements OnInit {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly agentRuntimeService = inject(AgentRuntimeService);
  private readonly router = inject(Router);

  readonly agents = signal<IAgent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /**
   * Gateway health resolved once for the whole list, same as
   * `checkRuntimeSync`'s "one call for all agents" step (T01 finding 6,
   * `ai.component.ts:1580-1595`). `null` until the check resolves.
   */
  private readonly gatewayHealthy = signal<boolean | null>(null);

  readonly emptyAgentsMessage = signal(
    "No agents found. Create your first AI agent to get started."
  );

  readonly totalAgents = computed(() => this.agents().length);

  readonly publishedCount = computed(
    () =>
      this.agents().filter((agent) => agent.status === AGENT_STATUSES.PUBLISHED)
        .length
  );

  readonly draftCount = computed(
    () =>
      this.agents().filter((agent) => agent.status === AGENT_STATUSES.DRAFT)
        .length
  );

  readonly totalSkills = computed(() =>
    this.agents().reduce((sum, agent) => sum + this.getSkillsCount(agent), 0)
  );

  /**
   * Runtime health per agent, recomputed whenever the agent list or the
   * gateway health signal changes. While the gateway check hasn't resolved
   * yet, agents show "checking" (transient, maps to the "idle" dot per
   * `mapRuntimeStateToHealth`).
   */
  readonly runtimeHealth = computed<Record<string, IAgentRuntimeHealth>>(() => {
    const gateway = this.gatewayHealthy();
    const next: Record<string, IAgentRuntimeHealth> = {};
    for (const agent of this.agents()) {
      next[agent.id] =
        gateway === null
          ? { state: "checking", checkedAt: Date.now() }
          : deriveAgentRuntimeState(agent, gateway);
    }
    return next;
  });

  readonly attentionIssues = computed<IAttentionIssue[]>(() => {
    const issues: IAttentionIssue[] = [];
    const health = this.runtimeHealth();
    for (const agent of this.agents()) {
      const state = health[agent.id]?.state;
      if (state !== "unsynced" && state !== "misconfigured") {
        continue;
      }
      issues.push({
        id: agent.id,
        message: this.attentionMessage(agent, state),
        severity: RUNTIME_ATTENTION_SEVERITY[state],
        action: { label: "Open agent" },
      });
    }
    if (issues.length === 0) {
      // Verbose logging: empty attention list must not fail silently.
      console.debug(
        "[AiAgentsPageComponent] no agents in warn/error runtime state, needs-attention panel will render its empty state"
      );
    }
    return issues;
  });

  /**
   * Inventory columns: real fields only (T01 finding 6). Name carries the
   * health dot (runtime state derivation, T02 mapping); model reads
   * `model_config.llm` via `getAgentLlmConfig`; status is the raw agent
   * status; skills is `model_config.subagents.length`.
   */
  readonly agentColumns: InventoryTableColumn<IAgent>[] = [
    {
      key: "name",
      header: "Name",
      type: "status-badge",
      variant: "dot",
      value: (agent) => agent.name,
      health: (agent): HealthStatus =>
        mapRuntimeStateToHealth(this.runtimeHealthFor(agent.id).state),
    },
    {
      key: "model",
      header: "Model",
      type: "mono",
      value: (agent) => this.formatModel(agent),
      width: "220px",
    },
    {
      key: "status",
      header: "Status",
      type: "text",
      value: (agent) => agent.status,
      width: "110px",
    },
    {
      key: "skills",
      header: "Skills",
      type: "mono",
      value: (agent) => String(this.getSkillsCount(agent)),
      width: "90px",
    },
  ];

  ngOnInit(): void {
    this.loadAgents();
  }

  protected loadAgents(): void {
    this.loading.set(true);
    this.error.set(null);
    this.gatewayHealthy.set(null);

    this.agentAdminService.listAgents({ limit: 12, offset: 0 }).subscribe({
      next: (response) => {
        this.agents.set(response.agents);
        this.loading.set(false);
        console.debug("[AiAgentsPageComponent] agents loaded", {
          count: response.agents.length,
        });
        this.checkGatewayHealth();
      },
      error: (err: unknown) => {
        this.error.set(
          err instanceof Error ? err.message : "Failed to load agents"
        );
        this.loading.set(false);
        console.error("[AiAgentsPageComponent] failed to load agents", {
          error: err,
        });
      },
    });
  }

  /**
   * One gateway health call for the whole list (T01 finding 6,
   * `ai.component.ts:1580-1595`); per-agent state is then derived purely
   * from that result plus each agent's own fields via
   * `deriveAgentRuntimeState`.
   */
  private checkGatewayHealth(): void {
    this.agentRuntimeService.checkRuntimeHealth().subscribe({
      next: (result) => {
        const healthy = result.status === "ok";
        this.gatewayHealthy.set(healthy);
        console.debug("[AiAgentsPageComponent] gateway health checked", {
          healthy,
          nats: result.nats,
          redis: result.redis,
        });
      },
      error: (err: unknown) => {
        // Runtime gateway unavailable is itself a real, non-invented state
        // (T01 finding 6) - treat the failed health check as unhealthy
        // rather than failing silently.
        this.gatewayHealthy.set(false);
        console.error(
          "[AiAgentsPageComponent] gateway health check failed, treating as unhealthy",
          { error: err }
        );
      },
    });
  }

  protected runtimeHealthFor(agentId: string): IAgentRuntimeHealth {
    return this.runtimeHealth()[agentId] ?? { state: "unknown" };
  }

  protected getSkillsCount(agent: IAgent): number {
    return agent.model_config?.subagents?.length ?? 0;
  }

  protected formatModel(agent: IAgent): string {
    const llm = getAgentLlmConfig(agent.model_config);
    const provider = llm.provider?.trim() || "No provider";
    const model = llm.model?.trim() || "No model";
    return `${provider} . ${model}`;
  }

  private attentionMessage(
    agent: IAgent,
    state: "unsynced" | "misconfigured"
  ): string {
    if (state === "unsynced") {
      return `${agent.name} runtime is unreachable (gateway unsynced).`;
    }
    return `${agent.name} is published but missing provider/model configuration.`;
  }

  /**
   * Row click navigates to the existing editor route (SPEC decision:
   * routes unchanged, `/ai/agents/:id`).
   */
  onAgentRowClick(agent: IAgent): void {
    console.debug("[AiAgentsPageComponent] agent row clicked, navigating", {
      agentId: agent.id,
    });
    this.router.navigate(["/ai/agents", agent.id]).catch((error: unknown) => {
      console.error("[AiAgentsPageComponent] navigation to agent failed", {
        agentId: agent.id,
        error,
      });
    });
  }

  /**
   * Needs-attention action link navigates to the same editor route as the
   * row click; `issue.id` is the agent id (see `attentionIssues`).
   */
  onAttentionActionClick(issue: IAttentionIssue): void {
    console.debug(
      "[AiAgentsPageComponent] needs-attention action clicked, navigating",
      { agentId: issue.id }
    );
    this.router.navigate(["/ai/agents", issue.id]).catch((error: unknown) => {
      console.error(
        "[AiAgentsPageComponent] navigation from needs-attention panel failed",
        { agentId: issue.id, error }
      );
    });
  }

  /**
   * Existing create-agent affordance (T01 finding 2: `navigationMode ===
   * "route"` navigates to `/ai/agents/new`, `ai.component.ts:695-696`) -
   * route unchanged.
   */
  onNewAgentClick(): void {
    console.debug("[AiAgentsPageComponent] new agent clicked, navigating");
    this.router.navigate(["/ai/agents/new"]).catch((error: unknown) => {
      console.error(
        "[AiAgentsPageComponent] navigation to new-agent route failed",
        { error }
      );
    });
  }
}
