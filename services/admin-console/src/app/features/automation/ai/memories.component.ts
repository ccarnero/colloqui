import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import { FormsModule, FormControl, ReactiveFormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { MatTableModule } from "@angular/material/table";
import { MatTooltipModule } from "@angular/material/tooltip";
import { firstValueFrom } from "rxjs";
import { debounceTime, distinctUntilChanged } from "rxjs/operators";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  MEMORY_KIND,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  type IAgentMemory,
  type IAgentMemoryQuery,
  type MemoryKind,
  type MemoryScope,
  type MemoryStatus,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import {
  StatusBadgeComponent,
  type StatusBadgeColor,
} from "../../../shared/components/status-badge/status-badge.component";
import { ConfirmDialogComponent } from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import {
  MemoryFormDialogComponent,
  type IMemoryDialogData,
  type IMemoryDialogResult,
} from "./memory-form-dialog.component";
import { AgentMemoryProposalsPanelComponent } from "./memory-proposals-panel.component";

const SCOPE_OPTIONS: { value: MemoryScope; label: string }[] = [
  { value: MEMORY_SCOPE.SESSION, label: "Session" },
  { value: MEMORY_SCOPE.USER, label: "User" },
  { value: MEMORY_SCOPE.TENANT, label: "Tenant" },
];

const KIND_OPTIONS: { value: MemoryKind; label: string }[] = [
  { value: MEMORY_KIND.PREFERENCE, label: "Preference" },
  { value: MEMORY_KIND.FACT, label: "Fact" },
  { value: MEMORY_KIND.NOTICE, label: "Notice" },
  { value: MEMORY_KIND.INCIDENT, label: "Incident" },
  { value: MEMORY_KIND.PROMO, label: "Promo" },
];

const STATUS_OPTIONS: { value: MemoryStatus; label: string }[] = [
  { value: MEMORY_STATUS.PROPOSED, label: "Proposed" },
  { value: MEMORY_STATUS.ACTIVE, label: "Active" },
  { value: MEMORY_STATUS.PUBLISHED, label: "Published" },
  { value: MEMORY_STATUS.REJECTED, label: "Rejected" },
  { value: MEMORY_STATUS.EXPIRED, label: "Expired" },
  { value: MEMORY_STATUS.ARCHIVED, label: "Archived" },
];

@Component({
  selector: "app-agent-memories",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    StatusBadgeComponent,
    AgentMemoryProposalsPanelComponent,
  ],
  template: `
    <div class="memories-page">
      <section class="hero">
        <div class="hero__icon">
          <mat-icon>memory</mat-icon>
        </div>
        <div class="hero__copy">
          <span class="hero__eyebrow">Agent Memory</span>
          <h1 class="hero__title">Memories</h1>
          <p class="hero__subtitle">
            Manage tenant memories — create, review, edit, and govern shared runtime context.
          </p>
        </div>
      </section>

      <section class="info-banner">
        <mat-icon class="info-banner__icon">shield</mat-icon>
        <div class="info-banner__copy">
          <h3 class="info-banner__title">Human review required</h3>
          <p class="info-banner__text">
            Agents can propose tenant-wide memories, but they only become auto-readable after explicit approval.
          </p>
        </div>
      </section>

      <app-agent-memory-proposals-panel />

      <section class="toolbar">
        <div class="toolbar__filters">
          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Status</mat-label>
            <mat-select [(ngModel)]="filterStatus" (ngModelChange)="loadMemories()">
              <mat-option value="">All</mat-option>
              @for (opt of statusOptions; track opt.value) {
                <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Kind</mat-label>
            <mat-select [(ngModel)]="filterKind" (ngModelChange)="loadMemories()">
              <mat-option value="">All</mat-option>
              @for (opt of kindOptions; track opt.value) {
                <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Scope</mat-label>
            <mat-select [(ngModel)]="filterScope" (ngModelChange)="loadMemories()">
              <mat-option value="">All</mat-option>
              @for (opt of scopeOptions; track opt.value) {
                <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field search-field">
            <mat-label>Search</mat-label>
            <input matInput [formControl]="filterSearch" placeholder="Search memories..." />
          </mat-form-field>
        </div>

        <div class="toolbar__actions">
          <button
            mat-stroked-button
            type="button"
            class="toolbar__refresh"
            (click)="loadMemories()"
            [disabled]="loading()"
          >
            <mat-icon>refresh</mat-icon>
            Refresh
          </button>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            (click)="openCreateDialog()"
          >
            + Create Memory
          </button>
        </div>
      </section>

      @if (loading()) {
        <div class="loading-row">
          <mat-spinner diameter="20"></mat-spinner>
          <span>Loading memories...</span>
        </div>
      }

      @if (!loading() && error()) {
        <p class="error-text">{{ error() }}</p>
      }

      @if (!loading() && !error() && memories().length === 0) {
        <div class="empty-state">
          <div class="empty-state__icon">
            <mat-icon>psychology</mat-icon>
          </div>
          <h4 class="empty-state__title">No memories found</h4>
          <p class="empty-state__text">
            No memories match the current filters. Try adjusting your search or create a new memory.
          </p>
        </div>
      }

      @if (!loading() && !error() && memories().length > 0) {
        <div class="table-wrap">
        <table mat-table [dataSource]="memories()">
          <ng-container matColumnDef="title">
            <th mat-header-cell *matHeaderCellDef>Title</th>
            <td mat-cell *matCellDef="let m" class="cell-title">
              <strong>{{ m.title }}</strong>
              <span class="cell-content-preview">{{ truncateContent(m.content) }}</span>
            </td>
          </ng-container>

          <ng-container matColumnDef="kind">
            <th mat-header-cell *matHeaderCellDef>Kind</th>
            <td mat-cell *matCellDef="let m">
              <app-status-badge [status]="m.kind" [color]="kindColor(m.kind)" />
            </td>
          </ng-container>

          <ng-container matColumnDef="scope">
            <th mat-header-cell *matHeaderCellDef>Scope</th>
            <td mat-cell *matCellDef="let m">
              <app-status-badge [status]="m.scope" [color]="'blue'" />
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let m">
              <app-status-badge [status]="m.status" [color]="statusColor(m.status)" />
            </td>
          </ng-container>

          <ng-container matColumnDef="createdAt">
            <th mat-header-cell *matHeaderCellDef>Created</th>
            <td mat-cell *matCellDef="let m" style="color: var(--text3)">
              {{ m.createdAt | date: "mediumDate" }}
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let m">
              <div class="row-actions">
                <button
                  mat-icon-button
                  type="button"
                  aria-label="Edit memory"
                  matTooltip="Edit"
                  (click)="openEditDialog(m)"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                @if (m.status === 'PROPOSED') {
                  <button
                    mat-icon-button
                    type="button"
                    aria-label="Approve memory"
                    matTooltip="Approve"
                    (click)="approveMemory(m.id)"
                    [disabled]="busyId() === m.id"
                  >
                    <mat-icon>check_circle</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    type="button"
                    aria-label="Reject memory"
                    matTooltip="Reject"
                    (click)="rejectMemory(m.id)"
                    [disabled]="busyId() === m.id"
                  >
                    <mat-icon>cancel</mat-icon>
                  </button>
                }
                <button
                  mat-icon-button
                  color="warn"
                  type="button"
                  aria-label="Delete memory"
                  matTooltip="Delete"
                  (click)="deleteMemory(m)"
                  [disabled]="busyId() === m.id"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
        </table>
      </div>
      }

      @if (total() > 0) {
        <div class="pagination-info">
          Showing {{ memories().length }} of {{ total() }} memories
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100%;
      }

      .memories-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 32px;
      }

      /* ---- Hero ---- */
      .hero {
        display: flex;
        align-items: center;
        gap: 20px;
      }

      .hero__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: linear-gradient(
          135deg,
          rgba(26, 102, 255, 0.18),
          rgba(26, 102, 255, 0.06)
        );
        color: var(--primary, #1a66ff);
      }

      .hero__icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      .hero__eyebrow {
        display: block;
        color: var(--primary, #1a66ff);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .hero__title {
        margin: 0 0 6px;
        color: var(--text-primary, #fff);
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
      }

      .hero__subtitle {
        margin: 0;
        color: var(--text2, #a0a0a0);
        font-size: 0.9rem;
        line-height: 1.6;
        max-width: 640px;
      }

      /* ---- Info Banner ---- */
      .info-banner {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 20px 24px;
        border-radius: 12px;
        border: 1px solid rgba(26, 102, 255, 0.18);
        background: rgba(26, 102, 255, 0.06);
      }

      .info-banner__icon {
        flex-shrink: 0;
        color: var(--primary, #1a66ff);
        font-size: 22px;
        width: 22px;
        height: 22px;
        margin-top: 1px;
      }

      .info-banner__title {
        margin: 0 0 4px;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--primary, #1a66ff);
      }

      .info-banner__text {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--text2, #a0a0a0);
      }

      /* ---- Toolbar ---- */
      .toolbar {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      .toolbar__filters {
        display: flex;
        align-items: flex-end;
        gap: 12px;
        flex-wrap: wrap;
      }

      .filter-field {
        width: 140px;
      }

      .search-field {
        width: 200px;
      }

      .toolbar__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .toolbar__refresh {
        color: var(--text2, #a0a0a0);
        border-color: var(--border-subtle, #333);
        font-size: 0.8rem;
      }

      /* ---- Loading / Error ---- */
      .loading-row {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text2, #a0a0a0);
        padding: 8px 0;
      }

      .error-text {
        color: #ef5350;
        margin: 0;
        padding: 8px 0;
      }

      /* ---- Empty State ---- */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 56px 24px;
        text-align: center;
        border-radius: 10px;
        border: 1px dashed var(--border-subtle, #333);
        background: rgba(255, 255, 255, 0.01);
      }

      .empty-state__icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: rgba(26, 102, 255, 0.1);
        margin-bottom: 16px;
      }

      .empty-state__icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: var(--primary, #1a66ff);
      }

      .empty-state__title {
        margin: 0 0 6px;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-primary, #fff);
      }

      .empty-state__text {
        margin: 0;
        color: var(--text2, #a0a0a0);
        font-size: 0.85rem;
      }

      /* ---- Table cells ---- */
      .cell-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .cell-content-preview {
        font-size: 0.8rem;
        color: var(--text3, #888);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 300px;
      }

      .row-actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      /* ---- Pagination ---- */
      .pagination-info {
        text-align: center;
        color: var(--text3, #888);
        font-size: 0.8rem;
        padding-top: 4px;
      }
    `,
  ],
})
export class AgentMemoriesComponent {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly dialog = inject(MatDialog);

  readonly scopeOptions = SCOPE_OPTIONS;
  readonly kindOptions = KIND_OPTIONS;
  readonly statusOptions = STATUS_OPTIONS;

  readonly displayedColumns = [
    "title",
    "kind",
    "scope",
    "status",
    "createdAt",
    "actions",
  ];

  readonly memories = signal<IAgentMemory[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  filterStatus: MemoryStatus | "" = "";
  filterKind: MemoryKind | "" = "";
  filterScope: MemoryScope | "" = "";
  readonly filterSearch = new FormControl("", { nonNullable: true });

  constructor() {
    this.filterSearch.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadMemories());

    this.loadMemories();
  }

  async loadMemories(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const query: IAgentMemoryQuery = {};
    if (this.filterStatus) query.status = this.filterStatus;
    if (this.filterKind) query.kind = this.filterKind;
    if (this.filterScope) query.scope = this.filterScope;
    const searchTerm = this.filterSearch.value.trim();
    if (searchTerm) query.search = searchTerm;

    try {
      const response = await firstValueFrom(
        this.agentAdminService.listMemories(query),
      );
      this.memories.set(response.items);
      this.total.set(response.total);
    } catch {
      this.error.set("Failed to load memories.");
    } finally {
      this.loading.set(false);
    }
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(MemoryFormDialogComponent, {
      width: "520px",
      data: {} as IMemoryDialogData,
    });

    ref.afterClosed().subscribe((result: IMemoryDialogResult | undefined) => {
      if (result?.saved) {
        this.loadMemories();
      }
    });
  }

  openEditDialog(memory: IAgentMemory): void {
    const ref = this.dialog.open(MemoryFormDialogComponent, {
      width: "520px",
      data: { memory } as IMemoryDialogData,
    });

    ref.afterClosed().subscribe((result: IMemoryDialogResult | undefined) => {
      if (result?.saved) {
        this.loadMemories();
      }
    });
  }

  async approveMemory(id: string): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: "400px",
      data: {
        title: "Approve Memory",
        message:
          "Are you sure you want to approve this memory? It will be published immediately and become readable by agents.",
        confirmLabel: "Approve",
        icon: "check_circle",
      },
    });

    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;

    this.busyId.set(id);
    this.error.set(null);

    try {
      await firstValueFrom(this.agentAdminService.approveMemory(id));
      this.loadMemories();
    } catch {
      this.error.set("Failed to approve memory.");
    } finally {
      this.busyId.set(null);
    }
  }

  async rejectMemory(id: string): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: "400px",
      data: {
        title: "Reject Memory",
        message: "Are you sure you want to reject this memory?",
        confirmLabel: "Reject",
        variant: "danger" as const,
        icon: "cancel",
      },
    });

    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;

    this.busyId.set(id);
    this.error.set(null);

    try {
      await firstValueFrom(this.agentAdminService.rejectMemory(id));
      this.loadMemories();
    } catch {
      this.error.set("Failed to reject memory.");
    } finally {
      this.busyId.set(null);
    }
  }

  async deleteMemory(memory: IAgentMemory): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: "400px",
      data: {
        title: "Delete Memory",
        message: `Are you sure you want to delete "${memory.title}"? This action cannot be undone.`,
        confirmLabel: "Delete",
        variant: "danger" as const,
        icon: "delete",
      },
    });

    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;

    this.busyId.set(memory.id);
    this.error.set(null);

    try {
      await firstValueFrom(
        this.agentAdminService.deleteMemory(memory.id),
      );
      this.loadMemories();
    } catch {
      this.error.set("Failed to delete memory.");
    } finally {
      this.busyId.set(null);
    }
  }

  truncateContent(content: string): string {
    if (content.length <= 80) return content;
    return content.slice(0, 80) + "...";
  }

  kindColor(kind: MemoryKind): StatusBadgeColor {
    const map: Record<MemoryKind, StatusBadgeColor> = {
      PREFERENCE: "purple",
      FACT: "blue",
      NOTICE: "green",
      INCIDENT: "red",
      PROMO: "yellow",
    };
    return map[kind] ?? "gray";
  }

  statusColor(status: MemoryStatus): StatusBadgeColor {
    const map: Record<MemoryStatus, StatusBadgeColor> = {
      PROPOSED: "yellow",
      ACTIVE: "green",
      PUBLISHED: "green",
      REJECTED: "red",
      EXPIRED: "gray",
      ARCHIVED: "gray",
    };
    return map[status] ?? "gray";
  }
}
