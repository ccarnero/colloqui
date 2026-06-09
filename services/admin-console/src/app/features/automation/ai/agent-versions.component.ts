import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { CommonModule, DatePipe } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { type IAgentVersion } from "../../../core/models/agent.model";

@Component({
  selector: "app-agent-versions",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="versions-panel">
      <div class="versions-header">
        <h3>Version History</h3>
        <button mat-icon-button (click)="refreshVersions()" [disabled]="loading()">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      @if (loading()) {
        <div class="versions-loading"><mat-spinner diameter="24" /></div>
      }

      @if (!loading() && versions().length === 0) {
        <div class="versions-empty">
          <mat-icon>history</mat-icon>
          <p>No versions yet. Publish the agent to create the first version.</p>
        </div>
      }

      @for (version of versions(); track version.id) {
        <div class="version-card">
          <div class="version-header">
            <span class="version-badge">
              @if (version.semver_label) {
                v{{ version.semver_label }}
              } @else {
                v{{ version.version_number }}
              }
            </span>
            @if (version.bump_type) {
              <span class="bump-badge" [ngClass]="{
                'bump-major': version.bump_type === 'major',
                'bump-minor': version.bump_type === 'minor',
                'bump-patch': version.bump_type === 'patch'
              }">{{ version.bump_type }}</span>
            }
            <span class="version-date">{{ version.created_at | date:'medium' }}</span>
          </div>
          <div class="version-details">
            <span class="version-field">Name: {{ version.snapshot['name'] || '—' }}</span>
            <span class="version-field">Prompt: {{ getPromptLength(version) }} chars</span>
            @if (version.published_by) {
              <span class="version-field published-by">
                <mat-icon class="inline-icon">person</mat-icon> {{ version.published_by }}
              </span>
            }
          </div>
          <div class="version-actions">
            <button
              mat-button
              class="action-btn rollback-btn"
              (click)="rollback.emit(version.id)"
              [disabled]="operating()"
            >
              <mat-icon>restore</mat-icon> Rollback
            </button>
            <button
              mat-button
              class="action-btn delete-btn"
              (click)="onDelete(version)"
              [disabled]="operating()"
            >
              <mat-icon>delete</mat-icon> Delete
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .versions-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .versions-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .versions-header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .versions-loading {
        display: flex;
        justify-content: center;
        padding: 20px;
      }
      .versions-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 24px;
        color: var(--text3);
        font-size: 13px;
      }
      .versions-empty mat-icon {
        font-size: 28px;
        opacity: 0.5;
      }
      .version-card {
        padding: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .version-header {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .version-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--primary, #6366f1);
        color: #fff;
      }
      .version-date {
        font-size: 12px;
        color: var(--text3);
      }
      .version-details {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .version-field {
        font-size: 12px;
        color: var(--text2);
      }
      .version-actions {
        display: flex;
        gap: 8px;
      }
      .action-btn {
        font-size: 12px;
        height: 28px;
      }
      .rollback-btn {
        background: rgba(99, 102, 241, 0.15);
        color: var(--primary, #6366f1);
      }
      .delete-btn {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
      }
      .bump-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .bump-major {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
      }
      .bump-minor {
        background: rgba(59, 130, 246, 0.15);
        color: #3b82f6;
      }
      .bump-patch {
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
      }
      .published-by {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .inline-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        vertical-align: middle;
      }
    `,
  ],
})
export class AgentVersionsComponent implements OnInit {
  private readonly adminService = inject(AgentAdminService);
  private readonly snackBar = inject(MatSnackBar);

  readonly agentId = input.required<string>();
  readonly rollback = output<string>();
  readonly versionDeleted = output<string>();

  readonly versions = signal<IAgentVersion[]>([]);
  readonly loading = signal(false);
  readonly operating = signal(false);

  ngOnInit(): void {
    this.refreshVersions();
  }

  refreshVersions(): void {
    this.loading.set(true);
    this.adminService.listVersions(this.agentId()).subscribe({
      next: (versions) => {
        this.versions.set(versions);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  getPromptLength(version: IAgentVersion): number {
    const prompt = version.snapshot["system_prompt"];
    return typeof prompt === "string" ? prompt.length : 0;
  }

  onDelete(version: IAgentVersion): void {
    const confirmed = window.confirm(
      `Delete version v${version.version_number}? This cannot be undone.`,
    );
    if (!confirmed) return;

    this.operating.set(true);
    this.adminService.deleteVersion(this.agentId(), version.id).subscribe({
      next: () => {
        this.versions.update((v) => v.filter((x) => x.id !== version.id));
        this.versionDeleted.emit(version.id);
        this.snackBar.open(
          `Version v${version.version_number} deleted`,
          "OK",
          { duration: 2000 },
        );
        this.operating.set(false);
      },
      error: () => {
        this.snackBar.open("Failed to delete version", "OK", {
          duration: 3000,
        });
        this.operating.set(false);
      },
    });
  }
}
