import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  type Signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar } from "@angular/material/snack-bar";
import {
  MatSortModule,
  type Sort,
  type SortDirection,
} from "@angular/material/sort";
import { MatTableModule } from "@angular/material/table";
import { MatTooltipModule } from "@angular/material/tooltip";
import {
  WorkflowApiService,
  type ExecutionSortDirection,
  type IWorkflowExecutionDetail,
  type IWorkflowExecutionRow,
} from "../../services/workflow-api.service";

export interface IWorkflowExecutionsDialogData {
  workflowId: string;
  workflowName: string;
}

const PAGE_SIZE = 20;

type DetailKind = "request" | "results";

interface IDetailPanel {
  kind: DetailKind;
  executionId: string;
  json: string;
  loading: boolean;
  error?: string;
}

/**
 * Modal that lists a workflow's executions with server-side
 * pagination (20 per page) and `created_at` sort. Per-execution
 * details (request payload + per-action results) are fetched on
 * demand and cached in a `Map` keyed by `executionId` to avoid
 * refetching when the user reopens the same panel.
 *
 * Performance characteristics:
 * - Page load: O(log n + 20) rows + 1 count query (parallel on the
 *   backend). UI never accumulates rows across pages.
 * - Detail fetch: O(1) cache hit after the first request per
 *   execution (`Map.get`).
 */
@Component({
  selector: "app-workflow-executions-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon class="dialog-title-icon">history</mat-icon>
      <span class="dialog-title-text">
        Executions · {{ data.workflowName }}
      </span>
      <span class="dialog-title-spacer"></span>
      <button
        mat-icon-button
        type="button"
        (click)="close()"
        matTooltip="Cerrar"
        aria-label="Cerrar"
      >
        <mat-icon>close</mat-icon>
      </button>
    </h2>

    <mat-dialog-content class="dialog-content">
      <div class="table-wrap">
        <table
          mat-table
          [dataSource]="rows()"
          matSort
          [matSortActive]="'createdAt'"
          [matSortDirection]="sort()"
          [matSortDisableClear]="true"
          (matSortChange)="onSortChange($event)"
          class="executions-table"
        >
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>ID</th>
            <td mat-cell *matCellDef="let row">
              <div class="id-cell">
                <span
                  class="row-id"
                  [matTooltip]="row.id"
                  matTooltipPosition="above"
                >
                  {{ shortId(row.id) }}
                </span>
                <button
                  mat-icon-button
                  type="button"
                  class="copy-btn"
                  matTooltip="Copy ID"
                  (click)="copyId(row.id, $event)"
                >
                  <mat-icon>content_copy</mat-icon>
                </button>
              </div>
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let row">
              <span
                class="status-badge"
                [class.status-completed]="row.status === 'COMPLETED'"
                [class.status-running]="row.status === 'RUNNING'"
                [class.status-failed]="
                  row.status === 'FAILED' || row.status === 'TERMINATED'
                "
              >
                {{ row.status }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="createdAt">
            <th mat-header-cell *matHeaderCellDef mat-sort-header>
              Executed At
            </th>
            <td mat-cell *matCellDef="let row">
              {{ row.createdAt | date: "medium" }}
            </td>
          </ng-container>

          <ng-container matColumnDef="updatedAt">
            <th mat-header-cell *matHeaderCellDef>Updated At</th>
            <td mat-cell *matCellDef="let row">
              {{ row.updatedAt | date: "medium" }}
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let row">
              <div class="actions-cell">
                <button
                  mat-stroked-button
                  type="button"
                  (click)="onViewRequest(row)"
                >
                  <mat-icon>input</mat-icon>
                  Request
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  (click)="onViewResults(row)"
                >
                  <mat-icon>output</mat-icon>
                  Results
                </button>
              </div>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>

        @if (loading()) {
          <div class="overlay">
            <mat-progress-spinner
              mode="indeterminate"
              diameter="32"
            />
          </div>
        }

        @if (!loading() && rows().length === 0) {
          <div class="empty-state">
            <mat-icon>history_toggle_off</mat-icon>
            <span>There are no executions for this workflow.</span>
          </div>
        }
      </div>

      <mat-paginator
        [length]="total()"
        [pageSize]="pageSize"
        [pageIndex]="pageIndex()"
        [hidePageSize]="true"
        showFirstLastButtons
        (page)="onPageChange($event)"
      />

      @if (panel(); as p) {
        <section class="detail-panel">
          <header class="detail-panel-header">
            <mat-icon>{{
              p.kind === "request" ? "input" : "output"
            }}</mat-icon>
            <span class="detail-panel-title">
              {{ p.kind === "request" ? "Request" : "Results" }}
              · {{ shortId(p.executionId) }}
            </span>
            <span class="dialog-title-spacer"></span>
            <button
              mat-icon-button
              type="button"
              matTooltip="Copy JSON"
              [disabled]="!p.json || p.loading || !!p.error"
              (click)="onCopyPanelJson(p)"
            >
              <mat-icon>content_copy</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              matTooltip="Close panel"
              (click)="closePanel()"
            >
              <mat-icon>close</mat-icon>
            </button>
          </header>
          @if (p.loading) {
            <div class="detail-panel-loading">
              <mat-progress-spinner
                mode="indeterminate"
                diameter="20"
              />
              <span>Cargando…</span>
            </div>
          } @else if (p.error) {
            <div class="detail-panel-error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ p.error }}</span>
            </div>
          } @else {
            <pre class="detail-panel-json">{{ p.json }}</pre>
          }
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" (click)="close()">
        Close
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 720px;
    }
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .dialog-title-icon {
      color: var(--accent, #6366f1);
    }
    .dialog-title-text {
      font-weight: 600;
    }
    .dialog-title-spacer {
      flex: 1;
    }
    .dialog-content {
      padding-top: 8px;
      max-height: 70vh;
      overflow-y: auto;
    }
    .table-wrap {
      position: relative;
      min-height: 120px;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      overflow: hidden;
    }
    .executions-table {
      width: 100%;
    }
    .executions-table th.mat-mdc-header-cell,
    .executions-table td.mat-mdc-cell {
      vertical-align: middle;
    }
    .id-cell {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .row-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--text2);
    }
    .copy-btn {
      width: 24px;
      height: 24px;
      line-height: 24px;
      color: var(--text3);
      flex-shrink: 0;
    }
    .copy-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .status-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg2);
      color: var(--text2);
    }
    .status-badge.status-completed {
      color: #16a34a;
      border-color: rgba(22, 163, 74, 0.4);
      background: rgba(22, 163, 74, 0.08);
    }
    .status-badge.status-running {
      color: #2563eb;
      border-color: rgba(37, 99, 235, 0.4);
      background: rgba(37, 99, 235, 0.08);
    }
    .status-badge.status-failed {
      color: #dc2626;
      border-color: rgba(220, 38, 38, 0.4);
      background: rgba(220, 38, 38, 0.08);
    }
    .actions-cell {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      white-space: nowrap;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.15);
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 32px;
      color: var(--text3);
    }
    .empty-state mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
    .detail-panel {
      margin-top: 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: var(--bg2);
    }
    .detail-panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .detail-panel-title {
      font-weight: 600;
      font-size: 13px;
    }
    .detail-panel-loading,
    .detail-panel-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      color: var(--text3);
    }
    .detail-panel-error {
      color: var(--red, #dc2626);
    }
    .detail-panel-json {
      margin: 0;
      padding: 12px;
      max-height: 280px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre;
      color: var(--text);
    }
  `,
})
export class WorkflowExecutionsDialogComponent {
  readonly columns = [
    "id",
    "status",
    "createdAt",
    "updatedAt",
    "actions",
  ] as const;

  readonly pageSize = PAGE_SIZE;

  private readonly api = inject(WorkflowApiService);
  private readonly dialogRef = inject<
    MatDialogRef<WorkflowExecutionsDialogComponent>
  >(MatDialogRef);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<IWorkflowExecutionsDialogData>(MAT_DIALOG_DATA);

  readonly page = signal(1);
  readonly sort = signal<SortDirection>("desc");
  readonly rows = signal<IWorkflowExecutionRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly panel = signal<IDetailPanel | null>(null);

  readonly pageIndex: Signal<number> = computed(() => this.page() - 1);

  /**
   * Cache of detail responses keyed by `executionId`. `Map` is used
   * over a plain object so cache reads/writes are O(1) regardless of
   * cache size and keys are not coerced to strings (they already are).
   */
  private readonly detailCache = new Map<string, IWorkflowExecutionDetail>();

  constructor() {
    effect(() => {
      const page = this.page();
      const direction = this.sort();
      this.fetchPage(page, this.toExecutionSort(direction));
    });
  }

  private toExecutionSort(d: SortDirection): ExecutionSortDirection {
    return d === "asc" ? "asc" : "desc";
  }

  private fetchPage(page: number, sort: ExecutionSortDirection): void {
    this.loading.set(true);
    this.api
      .listExecutions(this.data.workflowId, {
        page,
        pageSize: this.pageSize,
        sort,
      })
      .subscribe({
        next: (resp) => {
          this.rows.set(resp.items);
          this.total.set(resp.total);
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  onPageChange(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
  }

  onSortChange(event: Sort): void {
    // Material's Sort allows direction `""`; we keep the previous
    // direction (clear is disabled via [matSortDisableClear]).
    if (event.direction === "asc" || event.direction === "desc") {
      this.sort.set(event.direction);
      this.page.set(1);
    }
  }

  shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  }

  copyId(id: string, event: Event): void {
    event.stopPropagation();
    void this.writeToClipboard(id, "ID copied");
  }

  /**
   * Copies the currently displayed JSON (request or results) to the
   * clipboard. Disabled in the template while the panel is loading or
   * has an error so we don't ship empty/inconsistent payloads.
   */
  onCopyPanelJson(p: IDetailPanel): void {
    if (!p.json) return;
    const label = p.kind === "request" ? "Request copied" : "Results copied";
    void this.writeToClipboard(p.json, label);
  }

  /**
   * Centralised clipboard write — falls back to a hidden `<textarea>`
   * + `execCommand("copy")` when `navigator.clipboard` is unavailable
   * (older browsers / non-secure contexts). O(n) on the string size.
   */
  private async writeToClipboard(
    value: string,
    successLabel: string,
  ): Promise<void> {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        this.legacyCopy(value);
      }
      this.snackBar.open(successLabel, "OK", { duration: 2000 });
    } catch {
      this.snackBar.open("Couldn't copy to clipboard", "OK", {
        duration: 3000,
      });
    }
  }

  private legacyCopy(value: string): void {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  /**
   * Renders the request payload that already arrived with the row, no
   * extra HTTP call required.
   */
  onViewRequest(row: IWorkflowExecutionRow): void {
    this.panel.set({
      kind: "request",
      executionId: row.id,
      json: this.stringify(row.request),
      loading: false,
    });
  }

  /**
   * Fetches per-action results from Temporal via workflow-service. The
   * detail response is cached so repeated clicks on the same
   * execution skip the network round-trip.
   */
  onViewResults(row: IWorkflowExecutionRow): void {
    const cached = this.detailCache.get(row.id);
    if (cached) {
      this.renderResultsPanel(row.id, cached);
      return;
    }

    this.panel.set({
      kind: "results",
      executionId: row.id,
      json: "",
      loading: true,
    });

    this.api
      .getExecutionDetail(this.data.workflowId, row.id)
      .subscribe({
        next: (detail) => {
          this.detailCache.set(row.id, detail);
          this.renderResultsPanel(row.id, detail);
        },
        error: (err: { message?: string }) => {
          this.panel.set({
            kind: "results",
            executionId: row.id,
            json: "",
            loading: false,
            error:
              err?.message ??
              "Results for this execution couldn't be loaded.",
          });
        },
      });
  }

  private renderResultsPanel(
    executionId: string,
    detail: IWorkflowExecutionDetail,
  ): void {
    const payload = detail.failure
      ? { status: detail.status, failure: detail.failure }
      : { status: detail.status, results: detail.result?.results ?? {} };
    this.panel.set({
      kind: "results",
      executionId,
      json: this.stringify(payload),
      loading: false,
    });
  }

  closePanel(): void {
    this.panel.set(null);
  }

  close(): void {
    this.dialogRef.close();
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}
