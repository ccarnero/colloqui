import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { Router } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";
import {
  WorkflowApiService,
  type IWorkflowDefinitionDto,
} from "./services/workflow-api.service";

@Component({
  selector: "app-workflows",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatIconModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Workflows</div>
        <div class="ws-subtitle">Automate business processes</div>
      </div>
      <div class="ws-actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="createNew()"
        >
          + New Workflow
        </button>
      </div>
    </div>

    @if (loading()) {
      <div class="wf-loading">Loading workflows...</div>
    }

    @for (wf of workflows(); track wf.id) {
      <div class="section-card wf-card" (click)="openEditor(wf.id)">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">{{ wf.name }}</div>
            <div class="section-card-sub">
              {{ triggerLabel(wf) }} · {{ wf.application }}
            </div>
          </div>
          <app-status-badge
            [status]="wf.trigger ? 'active' : 'draft'"
          />
        </div>
        <div class="section-card-body wf-meta">
          <span class="wf-meta-item">
            <mat-icon>account_tree</mat-icon>
            {{ actionCount(wf) }} actions
          </span>
          <span class="wf-meta-item">
            <mat-icon>schedule</mat-icon>
            {{ wf.createdAt | date }}
          </span>
        </div>
      </div>
    }

    @if (!loading() && workflows().length === 0) {
      <div class="wf-empty">
        <mat-icon class="wf-empty-icon">account_tree</mat-icon>
        <div class="wf-empty-title">No workflows yet</div>
        <div class="wf-empty-sub">
          Create your first workflow to automate business processes
        </div>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="createNew()"
        >
          + New Workflow
        </button>
      </div>
    }
  `,
  styles: `
    .wf-card {
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .wf-card:hover {
      border-color: var(--accent);
    }
    .wf-meta {
      display: flex;
      gap: 20px;
      align-items: center;
    }
    .wf-meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text3);
    }
    .wf-meta-item mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .wf-loading {
      text-align: center;
      padding: 40px;
      color: var(--text3);
    }
    .wf-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 20px;
      text-align: center;
      gap: 8px;
    }
    .wf-empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--text3);
      margin-bottom: 8px;
    }
    .wf-empty-title {
      font-size: 16px;
      font-weight: 600;
    }
    .wf-empty-sub {
      font-size: 13px;
      color: var(--text3);
      margin-bottom: 12px;
    }
  `,
})
export class WorkflowsComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly router = inject(Router);

  readonly workflows = signal<IWorkflowDefinitionDto[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.api.list().subscribe({
      next: (data) => {
        this.workflows.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  createNew(): void {
    this.router.navigate(["/workflows", "new"]);
  }

  openEditor(id: string): void {
    this.router.navigate(["/workflows", id, "edit"]);
  }

  triggerLabel(wf: IWorkflowDefinitionDto): string {
    if (!wf.trigger) return "No trigger";
    const t = wf.trigger as { type: string };
    return t.type === "message_received"
      ? "Message trigger"
      : t.type;
  }

  actionCount(wf: IWorkflowDefinitionDto): number {
    return Array.isArray(wf.actions) ? wf.actions.length : 0;
  }
}
