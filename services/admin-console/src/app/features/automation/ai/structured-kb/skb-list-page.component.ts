import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import {
  type SKBContainer,
  StructuredKbService,
} from "../../../../core/services/structured-kb.service";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import { SkbCreateDialogComponent } from "./skb-create-dialog.component";

const STATUS_COLORS: Record<string, string> = {
  pending: "#999",
  processing: "#42a5f5",
  ready: "#66bb6a",
  failed: "#ef5350",
};

@Component({
  selector: "app-skb-list-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    UtcDatePipe,
  ],
  template: `
    <div class="skb-list-page">
      <div class="page-header">
        <div>
          <h1>Structured Knowledge Bases</h1>
          <p class="text-secondary">
            Upload structured data (CSV, Excel) and query it with natural
            language
          </p>
        </div>
        <button class="btn btn-primary btn-sm" (click)="createContainer()">
          <mat-icon>add</mat-icon> New SKB
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner" data-testid="loading"></div>
          <p>Loading structured knowledge bases...</p>
        </div>
      } @else if (error(); as errMsg) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ errMsg }}</p>
          <button class="btn btn-sm" (click)="loadContainers()">Retry</button>
        </div>
      } @else if (containers().length === 0) {
        <div class="empty-state">
          <mat-icon>database</mat-icon>
          <p>No structured knowledge bases yet</p>
        </div>
      } @else {
        <div class="skb-table">
          <div class="skb-table-header">
            <span class="col-name">Name</span>
            <span class="col-desc">Description</span>
            <span class="col-status">Status</span>
            <span class="col-files">Files</span>
            <span class="col-date">Created</span>
          </div>
          @for (container of containers(); track container.id) {
            <div class="skb-table-row" (click)="navigateToDetail(container.id)">
              <span class="col-name">{{ container.name }}</span>
              <span class="col-desc">{{ container.description || "—" }}</span>
              <span class="col-status">
                <span [style.color]="getStatusColor(container.status)">{{ container.status }}</span>
              </span>
              <span class="col-files">{{ container.file_count }}</span>
              <span class="col-date">{{ container.created_at | utcDate: "short" }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
    .skb-list-page { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; }
    .page-header p { margin: 2px 0 0; font-size: 13px; }
    .skb-table {
      border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden;
    }
    .skb-table-header {
      display: grid;
      grid-template-columns: 1fr 1fr 100px 80px 140px;
      gap: 12px;
      padding: 10px 16px;
      background: var(--bg3);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    .skb-table-row {
      display: grid;
      grid-template-columns: 1fr 1fr 100px 80px 140px;
      gap: 12px;
      padding: 10px 16px;
      align-items: center;
      border-top: 1px solid var(--border-subtle);
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .skb-table-row:hover { background: var(--bg3); }
    .col-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .col-desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary); }
    .col-date { color: var(--text-muted); font-size: 12px; }
    .loading-state, .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--text-muted);
    }
    .empty-state mat-icon, .error-state mat-icon {
      font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;
    }
    .spinner {
      width: 32px; height: 32px; border: 3px solid var(--border-subtle);
      border-top-color: var(--primary, #7c4dff); border-radius: 50%;
      animation: spin 0.6s linear infinite; margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-state p { margin-bottom: 12px; }
  `,
  ],
})
export class SkbListPageComponent implements OnInit {
  private readonly service = inject(StructuredKbService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly containers = signal<SKBContainer[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadContainers();
  }

  loadContainers(): void {
    this.loading.set(true);
    try {
      const obs$ = this.service.getContainers();
      if (typeof (obs$ as { subscribe?: unknown }).subscribe !== "function") {
        return;
      }
      obs$.subscribe({
        next: (res: any) => {
          this.containers.set(res.containers);
          this.loading.set(false);
        },
        error: () => {
          this.error.set("Failed to load containers");
          this.loading.set(false);
        },
      });
    } catch {
      this.loading.set(false);
    }
  }

  getStatusColor(status: string): string {
    return STATUS_COLORS[status?.toLowerCase() ?? ""] ?? "#999";
  }

  createContainer(): void {
    this.dialog.open(SkbCreateDialogComponent, {
      width: "480px",
      data: {},
    });
  }

  navigateToDetail(id: string): void {
    this.router.navigate(["/ai/structured-kb", id]);
  }
}
