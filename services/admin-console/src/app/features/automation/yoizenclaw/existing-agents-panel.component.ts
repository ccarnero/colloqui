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

@Component({
  selector: "app-yoizenclaw-existing-agents",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
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
                    {{ agent.model_config.model || "No model" }}
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
                  {{ agent.model_config.subagents.length }} skills
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
                    } @else {
                      <mat-icon>rocket_launch</mat-icon>
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
                    } @else {
                      <mat-icon>pause_circle</mat-icon>
                    }
                    Unpublish
                  </button>
                }

                <button
                  mat-button
                  class="action-btn edit-btn"
                  (click)="edit.emit(agent)"
                >
                  <mat-icon>edit_note</mat-icon>
                  Edit
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

  readonly edit = output<IYoizenclawAgent>();
  readonly publish = output<string>();
  readonly unpublish = output<string>();

  formatProvider(agent: IYoizenclawAgent): string {
    const provider = agent.model_config.provider?.trim();
    return provider ? provider : "No provider";
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
}
