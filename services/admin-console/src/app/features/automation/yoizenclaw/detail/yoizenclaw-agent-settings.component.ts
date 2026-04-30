import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import {
  type IYoizenclawAgent,
} from "../../../../core/models/yoizenclaw.model";
import { YoizenclawAdminService } from "../../../../core/services/yoizenclaw-admin.service";
import { ActivatedRoute } from "@angular/router";

@Component({
  selector: "app-yoizenclaw-agent-settings",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (!agent()) {
      <p class="empty">Loading settings...</p>
    }

    @if (agent(); as current) {
      <section class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Lifecycle</div>
            <div class="section-card-sub">Publish state and metadata</div>
          </div>
          <span class="status-pill" [class]="'status-' + current.status">
            {{ current.status }}
          </span>
        </div>

        <div class="section-card-body lifecycle-body">
          <div class="metadata">
            <div class="meta-item">
              <span class="meta-label">Created</span>
              <strong>{{ current.created_at | date: "medium" }}</strong>
            </div>
            <div class="meta-item">
              <span class="meta-label">Updated</span>
              <strong>{{ current.updated_at | date: "medium" }}</strong>
            </div>
            <div class="meta-item">
              <span class="meta-label">Published</span>
              <strong>{{ current.published_at ? (current.published_at | date: "medium") : "Not published" }}</strong>
            </div>
          </div>

          <div class="actions-row">
            @if (current.status === "draft") {
              <button
                class="btn btn-primary btn-sm"
                type="button"
                [disabled]="processing()"
                (click)="publish()"
              >
                Publish
              </button>
            }

            @if (current.status === "published") {
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                [disabled]="processing()"
                (click)="unpublish()"
              >
                Unpublish
              </button>
            }
          </div>

          @if (errorMessage()) {
            <p class="error">{{ errorMessage() }}</p>
          }
          @if (successMessage()) {
            <p class="success">{{ successMessage() }}</p>
          }
        </div>
      </section>

      <section class="section-card danger-zone">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Danger Zone</div>
            <div class="section-card-sub">
              Destructive actions are intentionally disabled in this phase.
            </div>
          </div>
        </div>
        <div class="section-card-body">
          <button class="btn btn-danger btn-sm" type="button" disabled>
            Delete agent (coming soon)
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 12px;
    }

    .empty {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0;
      padding: 10px 0;
    }

    .lifecycle-body {
      display: grid;
      gap: 14px;
    }

    .metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .meta-item {
      background: var(--bg2);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 4px;
    }

    .meta-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .actions-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .status-pill {
      text-transform: capitalize;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }

    .status-draft {
      color: var(--yellow, #fdbd27);
      background: rgba(253, 189, 39, 0.15);
    }

    .status-published {
      color: var(--green, #22c55e);
      background: rgba(34, 197, 94, 0.15);
    }

    .status-archived {
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.08);
    }

    .danger-zone {
      border-color: rgba(239, 68, 68, 0.25);
    }

    .error,
    .success {
      margin: 0;
      font-size: 12px;
      font-weight: 500;
    }

    .error {
      color: var(--red, #ef4444);
    }

    .success {
      color: var(--green, #22c55e);
    }
  `,
})
export class YoizenclawAgentSettingsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly yoizenclawAdminService = inject(YoizenclawAdminService);

  private readonly agentId =
    this.route.parent?.snapshot.paramMap.get("id") ?? "";

  protected readonly agent = signal<IYoizenclawAgent | null>(null);
  protected readonly processing = signal(false);
  protected readonly errorMessage = signal("");
  protected readonly successMessage = signal("");

  ngOnInit(): void {
    this.loadAgent();
  }

  protected publish(): void {
    if (!this.agentId) {
      return;
    }

    this.processing.set(true);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.yoizenclawAdminService.publishAgent(this.agentId).subscribe({
      next: (agent) => {
        this.agent.set(agent);
        this.processing.set(false);
        this.successMessage.set(`Agent "${agent.name}" published.`);
      },
      error: () => {
        this.processing.set(false);
        this.errorMessage.set("Failed to publish the agent.");
      },
    });
  }

  protected unpublish(): void {
    if (!this.agentId) {
      return;
    }

    this.processing.set(true);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.yoizenclawAdminService.unpublishAgent(this.agentId).subscribe({
      next: (agent) => {
        this.agent.set(agent);
        this.processing.set(false);
        this.successMessage.set(`Agent "${agent.name}" unpublished.`);
      },
      error: () => {
        this.processing.set(false);
        this.errorMessage.set("Failed to unpublish the agent.");
      },
    });
  }

  private loadAgent(): void {
    if (!this.agentId) {
      this.agent.set(null);
      return;
    }

    this.yoizenclawAdminService.getAgent(this.agentId).subscribe({
      next: (agent) => {
        this.agent.set(agent);
      },
      error: () => {
        this.agent.set(null);
      },
    });
  }
}
