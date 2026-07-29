import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import {
  getAgentLlmConfig,
  type IAgent,
} from "../../../../core/models/agent.model";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import {
  ConnectorCallService,
  type IAgentExecutionCall,
} from "../../../../core/services/connector-call.service";
import { KpiCardComponent } from "../../../../shared/components/kpi-card/kpi-card.component";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import {
  CallInspectorComponent,
  type ICallInspectorRow,
} from "../../../connections/call-inspector/call-inspector.component";

@Component({
  selector: "app-ai-agent-overview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UtcDatePipe,
    KpiCardComponent,
    RouterLink,
    MatIconModule,
    MatProgressSpinnerModule,
    CallInspectorComponent,
  ],
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

      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Recent executions</div>
            <div class="section-card-sub">Last 7 days, up to 20 runs</div>
          </div>
        </div>

        <div class="section-card-body">
          @if (executionsLoading()) {
            <div class="loader">
              <mat-spinner diameter="24"></mat-spinner>
              <span>Loading recent executions…</span>
            </div>
          } @else if (recentExecutions().length === 0) {
            <p class="empty">No executions in the last 7 days.</p>
          } @else {
            <div class="call-body">
              <div class="call-list">
                @for (e of recentExecutions(); track $index) {
                  <div
                    class="call-row"
                    role="button"
                    tabindex="0"
                    [class.call-row--selected]="selectedExecution() === e"
                    (click)="openInspector(e)"
                    (keydown.enter)="openInspector(e)"
                  >
                    <span class="call-ts">{{ e.timestamp | utcDate: "medium" }}</span>
                    <span class="call-state" [class]="stateClass(e.state)">{{ e.state ?? "—" }}</span>
                    <span class="call-model">{{ e.model ?? "—" }}</span>
                    <span class="call-dur">{{ e.durationMs !== null ? e.durationMs + "ms" : "—" }}</span>
                    <span class="call-cost">{{ e.costUsd !== null ? "$" + e.costUsd.toFixed(4) : "—" }}</span>
                    @if (e.correlationId) {
                      <a
                        [routerLink]="['/processes/trace', e.correlationId]"
                        class="trace-link"
                        (click)="$event.stopPropagation()"
                      >
                        <mat-icon>open_in_new</mat-icon>
                        View trace
                      </a>
                    }
                  </div>
                }
              </div>
              @if (inspectorRow(); as row) {
                <app-call-inspector [row]="row" (close)="closeInspector()" />
              }
            </div>
          }
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

    .loader {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      padding: 2rem;
      color: var(--text-secondary);
      font-size: 13px;
    }

    .call-body {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }

    .call-list {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .call-row {
      display: grid;
      grid-template-columns: 160px 90px 1fr 70px 90px auto;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-radius: 4px;
      background: var(--bg2);
      font-size: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background-color 0.12s;
      outline: none;
    }

    .call-row:hover,
    .call-row:focus-visible,
    .call-row--selected {
      background: var(--rd-hover, rgba(255, 255, 255, 0.06));
      color: var(--text-primary);
    }

    .call-ts {
      color: var(--text-muted);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .call-state {
      font-family: var(--rd-font-mono, monospace);
      font-weight: 600;
      font-size: 11px;
      text-transform: capitalize;
    }

    .call-state.st-completed {
      color: var(--green, #22c55e);
    }

    .call-state.st-failed {
      color: var(--rd-red, #ef4444);
    }

    .call-model {
      font-family: var(--rd-font-mono, monospace);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .call-dur,
    .call-cost {
      color: var(--text-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .trace-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--rd-accent, var(--primary, #1a66ff));
      text-decoration: none;
      transition: color 0.12s;
    }

    .trace-link:hover {
      color: var(--text-primary);
      text-decoration: underline;
    }

    .trace-link mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
  `,
})
export class AiAgentOverviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly calls = inject(ConnectorCallService);

  private readonly agentId =
    this.route.parent?.snapshot.paramMap.get("id") ?? "";

  protected readonly loading = signal(false);
  protected readonly agent = signal<IAgent | null>(null);

  /** T10: "Recent executions" tracked_events feed
   * (`ConnectorCallService.recentAgentExecutions`, 7-day window, limit 20 —
   * mirrors `connector-detail.component.ts`'s T08 `recentCalls`/`loadCalls`
   * pattern). */
  protected readonly recentExecutions = signal<IAgentExecutionCall[]>([]);
  protected readonly executionsLoading = signal(false);

  /** Currently-selected "Recent executions" row — feeds the docked
   * `app-call-inspector` panel. `null` means the inspector is closed. */
  protected readonly selectedExecution = signal<IAgentExecutionCall | null>(
    null
  );

  /** Projects `selectedExecution()` into the inspector's row contract, per
   * SPEC.md T07 ("event_id + correlation_id + kind + scalars"). Agent
   * executions only carry `execution_completed` events, so `kind` is
   * hardcoded (mirrors `mcp-detail.component.ts`'s `inspectorRow`). */
  protected readonly inspectorRow = computed<ICallInspectorRow | null>(() => {
    const e = this.selectedExecution();
    if (!e || !e.eventId || !e.correlationId) {
      return null;
    }
    return {
      eventId: e.eventId,
      correlationId: e.correlationId,
      kind: "execution_completed",
      scalars: {
        state: e.state,
        model: e.model,
        durationMs: e.durationMs,
        costUsd: e.costUsd,
      },
    };
  });

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
        console.debug("[AiAgentOverviewComponent] agent loaded", {
          agentId: this.agentId,
        });
      },
      error: (err: unknown) => {
        console.error("[AiAgentOverviewComponent] failed to load agent", {
          agentId: this.agentId,
          err,
        });
        this.agent.set(null);
        this.loading.set(false);
      },
    });

    this.loadExecutions();
  }

  protected goConfigure(): void {
    void this.router.navigate(["/ai/agents", this.agentId, "configure"]);
  }

  /** T10: `tracking.tracked_events` feed for the "Recent executions" list,
   * server-side filtered to `resource=agent/<id>` (7-day default window,
   * limit 20). */
  private loadExecutions(): void {
    if (!this.agentId) {
      console.error(
        "[AiAgentOverviewComponent] recent executions load skipped — no agentId"
      );
      return;
    }
    this.executionsLoading.set(true);
    this.calls.recentAgentExecutions(this.agentId, undefined, 20).subscribe({
      next: (rows) => {
        this.recentExecutions.set(rows);
        this.executionsLoading.set(false);
        console.debug("[AiAgentOverviewComponent] recent executions loaded", {
          agentId: this.agentId,
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        console.error(
          "[AiAgentOverviewComponent] failed to load recent executions",
          { agentId: this.agentId, err }
        );
        this.executionsLoading.set(false);
      },
    });
  }

  /** Opens the docked call inspector for the clicked row (T10). Rows
   * without an `eventId`/`correlationId` can't be resolved to a tracking
   * event, so the click is a no-op — mirroring
   * `mcp-detail.component.ts`'s T09 `openInspector`. */
  protected openInspector(execution: IAgentExecutionCall): void {
    if (!execution.eventId || !execution.correlationId) {
      console.debug(
        "[AiAgentOverviewComponent] inspector open skipped — row has no eventId/correlationId",
        { agentId: this.agentId, timestamp: execution.timestamp }
      );
      return;
    }
    console.debug("[AiAgentOverviewComponent] opening call inspector", {
      eventId: execution.eventId,
      correlationId: execution.correlationId,
    });
    this.selectedExecution.set(execution);
  }

  /** Consumer side of the inspector's `close` output contract. */
  protected closeInspector(): void {
    console.debug("[AiAgentOverviewComponent] closing call inspector");
    this.selectedExecution.set(null);
  }

  protected stateClass(state: string | null): string {
    return state ? `st-${state}` : "";
  }
}
