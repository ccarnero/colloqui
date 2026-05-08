import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import {
  YOIZENCLAW_AGENT_STATUSES,
  type IYoizenclawAgent,
} from "../../../core/models/yoizenclaw.model";

export interface IAgentRuntimeHealth {
  state: "unknown" | "checking" | "synced" | "unsynced";
  detail?: string;
  checkedAt?: number;
}

@Component({
  selector: "app-yoizenclaw-existing-agents",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <aside class="stack-column">
      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Existing Agents</div>
            <div class="section-card-sub">
              Drafts already stored in the tenant.
            </div>
          </div>
        </div>

        <div class="section-card-body list-body">
          @if (!agents().length && !loading()) {
            <div class="empty-state">
              <mat-icon>smart_toy</mat-icon>
              <p>No agents yet. Create the first YoizenClaw agent now.</p>
            </div>
          }

          @for (agent of agents(); track agent.id || $index) {
            <article
              class="agent-item"
              [class.editing]="editingAgentId() === agent.id"
            >
              <div class="agent-item-top">
                <div class="agent-info" (click)="edit.emit(agent)">
                  <strong class="agent-name">{{ agent.name }}</strong>
                  <div class="agent-meta">
                    {{ formatProvider(agent) }} ·
                    {{ formatModel(agent) }}
                  </div>
                </div>
                <span [class]="statusClass(agent.status)">
                  {{ agent.status }}
                </span>
              </div>

              <p class="agent-description">
                {{ agent.description || "No description provided." }}
              </p>

              <div class="agent-footer">
                <span>
                  {{ getSkillsCount(agent) }} skills
                </span>
                <span [class]="runtimeHealthClass(agent.id)">
                  Runtime: {{ runtimeHealthLabel(agent.id) }}
                </span>
                <span>
                  {{ agent.created_at | date: "mediumDate" }}
                </span>
              </div>

              <div class="agent-actions">
                @if (agent.status === "draft") {
                  <button
                    mat-button
                    class="action-btn publish-btn"
                    (click)="publish.emit(agent.id)"
                    [disabled]="publishingId() === agent.id"
                  >
                    @if (publishingId() === agent.id) {
                      <mat-spinner diameter="14"></mat-spinner>
                    }
                    Publish
                  </button>
                }

                @if (agent.status === "published") {
                  <button
                    mat-button
                    class="action-btn unpublish-btn"
                    (click)="unpublish.emit(agent.id)"
                    [disabled]="publishingId() === agent.id"
                  >
                    @if (publishingId() === agent.id) {
                      <mat-spinner diameter="14"></mat-spinner>
                    }
                    Unpublish
                  </button>
                }

                <button
                  mat-button
                  class="action-btn edit-btn"
                  (click)="edit.emit(agent)"
                >
                  Edit
                </button>

                <button
                  mat-button
                  class="action-btn runtime-btn"
                  (click)="checkRuntime.emit(agent.id)"
                  [disabled]="getRuntimeHealth(agent.id).state === 'checking'"
                >
                  @if (getRuntimeHealth(agent.id).state === "checking") {
                    <mat-spinner diameter="14"></mat-spinner>
                  }
                  Check Runtime
                </button>

                <button
                  mat-button
                  class="action-btn delete-btn"
                  (click)="delete.emit(agent.id)"
                  [disabled]="deletingId() === agent.id"
                >
                  @if (deletingId() === agent.id) {
                    <mat-spinner diameter="14"></mat-spinner>
                  }
                  Delete
                </button>
              </div>
            </article>
          }
        </div>
      </section>
    </aside>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .stack-column {
      display: grid;
      gap: 20px;
      min-width: 0;
    }

    .list-body {
      display: grid;
      gap: 14px;
    }

    .agent-item {
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      transition: all 0.2s ease;
    }

    .agent-item:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .agent-item.editing {
      border-color: var(--primary);
      background: var(--accent-dim);
      box-shadow: 0 0 0 2px var(--primary);
    }

    .agent-info {
      cursor: pointer;
      flex: 1;
    }

    .agent-name {
      cursor: pointer;
      transition: color 0.2s ease;
    }

    .agent-name:hover {
      color: var(--primary);
    }

    .agent-item-top,
    .agent-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .badge {
      text-transform: capitalize;
    }

    .agent-meta,
    .agent-description,
    .agent-footer {
      color: var(--text3);
      font-size: 12px;
    }

    .runtime-state {
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.4px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border-subtle);
      color: var(--text3);
      background: var(--bg3);
    }

    .runtime-state-synced {
      color: var(--green, #22c55e);
      border-color: rgba(34, 197, 94, 0.35);
      background: rgba(34, 197, 94, 0.12);
    }

    .runtime-state-unsynced {
      color: var(--red, #ef4444);
      border-color: rgba(239, 68, 68, 0.35);
      background: rgba(239, 68, 68, 0.12);
    }

    .runtime-state-checking {
      color: var(--yellow, #fdbd27);
      border-color: rgba(253, 189, 39, 0.35);
      background: rgba(253, 189, 39, 0.12);
    }

    .agent-description {
      margin: 10px 0 12px;
      line-height: 1.5;
    }

    .agent-actions {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      gap: 8px;
      justify-content: flex-start;
    }

    .action-btn {
      height: 32px;
      padding: 0 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      border: none;
      cursor: pointer;
    }

    .action-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .action-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .publish-btn {
      background: rgba(0, 188, 212, 0.15);
      color: #00bcd4;
    }

    .publish-btn:hover:not(:disabled) {
      background: rgba(0, 188, 212, 0.25);
    }

    .unpublish-btn {
      background: rgba(244, 67, 54, 0.15);
      color: #f44336;
    }

    .unpublish-btn:hover:not(:disabled) {
      background: rgba(244, 67, 54, 0.25);
    }

    .edit-btn {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text2);
    }

    .edit-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: var(--text);
    }

    .delete-btn {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }

    .delete-btn:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.25);
    }

    .runtime-btn {
      background: rgba(26, 102, 255, 0.15);
      color: var(--primary);
    }

    .runtime-btn:hover:not(:disabled) {
      background: rgba(26, 102, 255, 0.25);
    }

    .agent-actions mat-spinner {
      display: inline-block;
    }

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: rgba(255, 255, 255, 0.4);
      border: 2px dashed rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.005);
      transition: all 0.2s ease;
    }
    .empty-state:hover {
      border-style: dotted;
      border-color: rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.015);
    }

    .empty-state p {
      margin: 0;
    }

    .empty-state mat-icon {
      margin-bottom: 12px;
      font-size: 32px;
      height: 32px;
      width: 32px;
      opacity: 0.7;
    }

    .badge-draft {
      background: var(--accent-dim);
      color: var(--text-accent);
    }

    .badge-published {
      background: var(--green-dim);
      color: var(--green);
    }

    .badge-archived {
      background: var(--bg4);
      color: var(--text3);
    }
  `,
})
export class YoizenclawExistingAgentsPanelComponent {
  readonly agents = input.required<IYoizenclawAgent[]>();
  readonly loading = input.required<boolean>();
  readonly editingAgentId = input.required<string | null>();
  readonly publishingId = input.required<string | null>();
  readonly deletingId = input.required<string | null>();
  readonly runtimeHealth = input.required<Record<string, IAgentRuntimeHealth>>();

  readonly edit = output<IYoizenclawAgent>();
  readonly publish = output<string>();
  readonly unpublish = output<string>();
  readonly delete = output<string>();
  readonly checkRuntime = output<string>();

  formatProvider(agent: IYoizenclawAgent): string {
    const provider = agent.model_config?.llm?.provider?.trim();
    return provider ? provider : "No provider";
  }

  formatModel(agent: IYoizenclawAgent): string {
    const model = agent.model_config?.llm?.model?.trim();
    return model ? model : "No model";
  }

  getSkillsCount(agent: IYoizenclawAgent): number {
    return agent.model_config?.subagents?.length ?? 0;
  }

  statusClass(status: IYoizenclawAgent["status"]): string {
    switch (status) {
      case YOIZENCLAW_AGENT_STATUSES.PUBLISHED:
        return "badge badge-published";
      case YOIZENCLAW_AGENT_STATUSES.ARCHIVED:
        return "badge badge-archived";
      default:
        return "badge badge-draft";
    }
  }

  runtimeHealthLabel(agentId: string): string {
    const state = this.getRuntimeHealth(agentId).state;
    switch (state) {
      case "synced":
        return "Synced";
      case "unsynced":
        return "Issue";
      case "checking":
        return "Checking";
      default:
        return "Unknown";
    }
  }

  runtimeHealthClass(agentId: string): string {
    return `runtime-state runtime-state-${this.getRuntimeHealth(agentId).state}`;
  }

  protected getRuntimeHealth(agentId: string): IAgentRuntimeHealth {
    return this.runtimeHealth()[agentId] ?? { state: "unknown" };
  }
}
