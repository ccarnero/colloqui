import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ActivatedRoute } from "@angular/router";
import {
  type QueryHistoryRecord,
  type QueryResult,
  type SKBContainer,
  type SKBFile,
  StructuredKbService,
} from "../../../../core/services/structured-kb.service";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import { SkbUploadDialogComponent } from "./skb-upload-dialog.component";

export type SkbTab = "files" | "schema" | "query" | "history";

@Component({
  selector: "app-skb-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    UtcDatePipe,
  ],
  template: `
    <div class="detail-page">
      <div class="page-header">
        <div class="page-header-left">
          <h1>{{ container()?.name ?? "Loading..." }}</h1>
          @if (container()?.description) {
            <p class="text-secondary">{{ container()?.description }}</p>
          }
        </div>
        <button class="btn btn-primary btn-sm" (click)="uploadFile()">
          <mat-icon>upload</mat-icon> Upload File
        </button>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button
          class="tab"
          [class.active]="activeTab() === 'files'"
          (click)="activeTab.set('files')"
        >
          Files
        </button>
        <button
          class="tab"
          [class.active]="activeTab() === 'schema'"
          (click)="activeTab.set('schema')"
        >
          Schema
        </button>
        <button
          class="tab"
          [class.active]="activeTab() === 'query'"
          (click)="activeTab.set('query')"
        >
          Query
        </button>
        <button
          class="tab"
          [class.active]="activeTab() === 'history'"
          (click)="activeTab.set('history')"
        >
          History
        </button>
      </div>

      <!-- Files Tab -->
      @if (activeTab() === 'files') {
        @if (files().length > 0) {
          <div class="section">
            <div class="file-table">
              <div class="file-table-header">
                <span class="col-name">Filename</span>
                <span class="col-status">Status</span>
                <span class="col-rows">Rows</span>
                <span class="col-date">Created</span>
              </div>
              @for (file of files(); track file.id) {
                <div class="file-table-row">
                  <span class="col-name">
                    <mat-icon class="file-icon">description</mat-icon>
                    {{ file.name }}
                  </span>
                  <span class="col-status">
                    <span
                      class="status-badge"
                      [style.color]="getStatusColor(file.status)"
                    >
                      {{ file.status }}
                    </span>
                  </span>
                  <span class="col-rows">{{ file.row_count }}</span>
                  <span class="col-date">{{ file.created_at | utcDate: "short" }}</span>
                </div>
              }
            </div>
          </div>
        } @else {
          <div class="empty-state">
            <mat-icon>description</mat-icon>
            <p>No files uploaded yet</p>
          </div>
        }
      }

      <!-- Schema Tab -->
      @if (activeTab() === 'schema') {
        @if (container()?.schema?.columns?.length; as cols) {
          <div class="section">
            <div class="schema-table">
              <div class="schema-table-header">
                <span class="col-col">Column</span>
                <span class="col-type">Type</span>
                <span class="col-desc">Description</span>
                <span class="col-filter">Filterable</span>
              </div>
              @for (col of container()!.schema!.columns; track col.name) {
                <div class="schema-table-row">
                  <span class="col-col">{{ col.name }}</span>
                  <span class="col-type">
                    <span class="type-badge">{{ col.type }}</span>
                  </span>
                  <span class="col-desc">{{ col.description || "—" }}</span>
                  <span class="col-filter">
                    @if (col.filterable) {
                      <mat-icon class="check-icon">check_circle</mat-icon>
                      <span>filterable</span>
                    }
                  </span>
                </div>
              }
            </div>
          </div>
        } @else {
          <div class="empty-state">
            <mat-icon>schema</mat-icon>
            <p>No schema information available</p>
          </div>
        }
      }

      <!-- Query Tab -->
      @if (activeTab() === 'query') {
        <div class="section">
          <div class="query-bar">
            <textarea
              [ngModel]="queryText()"
              (ngModelChange)="queryText.set($event)"
              placeholder="Ask a question in natural language..."
              rows="2"
              class="query-input"
            ></textarea>
            <button
              class="btn btn-primary btn-sm"
              [disabled]="queryLoading() || !queryText().trim()"
              (click)="executeQuery(queryText())"
            >
              @if (queryLoading()) {
                <span class="spinner-sm"></span>
              } @else {
                <mat-icon>search</mat-icon>
              }
              Search
            </button>
          </div>

          @if (queryLoading()) {
            <div class="query-loading">
              <div class="spinner" data-testid="query-loading"></div>
              <p>Running query...</p>
            </div>
          } @else if (queryError(); as err) {
            <div class="error-state">
              <mat-icon>error_outline</mat-icon>
              <p>{{ err }}</p>
            </div>
          } @else if (queryResult(); as result) {
            @if (result.rows.length === 0) {
              <div class="empty-state">
                <mat-icon>search_off</mat-icon>
                <p>No results found</p>
              </div>
            } @else {
              <div class="result-info">
                <span>{{ result.total }} result(s) in {{ result.duration_ms }}ms</span>
                @if (result.sql) {
                  <code class="result-sql">{{ result.sql }}</code>
                }
              </div>
              <div class="result-table-wrapper">
                <table class="result-table">
                  <thead>
                    <tr>
                      @for (col of result.columns; track col) {
                        <th>{{ col }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of result.rows; track $index) {
                      <tr>
                        @for (col of result.columns; track col) {
                          <td>{{ row[col] }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </div>
      }

      <!-- History Tab -->
      @if (activeTab() === 'history') {
        @if (queryHistory().length > 0) {
          <div class="section">
            <div class="history-table">
              <div class="history-table-header">
                <span class="col-query">Query</span>
                <span class="col-sql">SQL</span>
                <span class="col-results">Results</span>
                <span class="col-duration">Duration</span>
                <span class="col-date">Date</span>
              </div>
              @for (record of queryHistory(); track record.id) {
                <div class="history-table-row">
                  <span class="col-query">{{ record.query }}</span>
                  <span class="col-sql"><code>{{ record.sql }}</code></span>
                  <span class="col-results">{{ record.results_count }}</span>
                  <span class="col-duration">{{ record.duration_ms }}ms</span>
                  <span class="col-date">{{ record.created_at | utcDate: "short" }}</span>
                </div>
              }
            </div>
          </div>
        } @else {
          <div class="empty-state">
            <mat-icon>history</mat-icon>
            <p>No queries yet</p>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
    .detail-page { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .page-header-left h1 { margin: 0; font-size: 24px; }
    .page-header-left p { margin: 2px 0 0; font-size: 13px; }

    .tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border-subtle); }
    .tab {
      padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent;
      font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab:hover { color: var(--text-primary); }
    .tab.active { color: var(--primary, #7c4dff); border-bottom-color: var(--primary, #7c4dff); }

    .section { margin-top: 4px; }

    .file-table, .schema-table, .history-table {
      border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden;
    }
    .file-table-header, .schema-table-header, .history-table-header {
      display: grid; gap: 12px; padding: 10px 16px;
      background: var(--bg3); font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);
    }
    .file-table-header { grid-template-columns: 1fr 100px 80px 140px; }
    .schema-table-header { grid-template-columns: 1fr 100px 1fr 100px; }
    .history-table-header { grid-template-columns: 1fr 1fr 80px 80px 140px; }

    .file-table-row, .schema-table-row, .history-table-row {
      display: grid; gap: 12px; padding: 10px 16px;
      align-items: center; border-top: 1px solid var(--border-subtle); font-size: 13px;
    }
    .file-table-row { grid-template-columns: 1fr 100px 80px 140px; }
    .schema-table-row { grid-template-columns: 1fr 100px 1fr 100px; }
    .history-table-row { grid-template-columns: 1fr 1fr 80px 80px 140px; }

    .file-table-row:hover, .schema-table-row:hover, .history-table-row:hover { background: var(--bg3); }
    .file-icon { font-size: 18px; width: 18px; height: 18px; color: var(--text-muted); vertical-align: middle; margin-right: 6px; }
    .col-name { display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .col-date { color: var(--text-muted); font-size: 12px; }
    .col-desc { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .status-badge, .type-badge {
      padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;
      background: rgba(0,0,0,0.06);
    }

    .check-icon { font-size: 16px; width: 16px; height: 16px; color: #66bb6a; vertical-align: middle; margin-right: 2px; }

    .query-bar { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
    .query-input {
      flex: 1; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: 8px;
      background: var(--bg2); color: var(--text-primary); font-family: inherit; font-size: 13px;
      resize: vertical; min-height: 42px;
    }
    .query-input:focus { outline: none; border-color: var(--primary, #7c4dff); }

    .query-loading { text-align: center; padding: 40px 20px; color: var(--text-muted); }
    .spinner {
      width: 32px; height: 32px; border: 3px solid var(--border-subtle);
      border-top-color: var(--primary, #7c4dff); border-radius: 50%;
      animation: spin 0.6s linear infinite; margin: 0 auto 12px;
    }
    .spinner-sm {
      display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff; border-radius: 50%;
      animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 4px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .result-info { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; font-size: 12px; color: var(--text-secondary); }
    .result-sql { padding: 2px 8px; background: var(--bg3); border-radius: 4px; font-size: 11px; }

    .result-table-wrapper { overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 10px; }
    .result-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .result-table th {
      padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);
      background: var(--bg3); border-bottom: 1px solid var(--border-subtle);
    }
    .result-table td { padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); }
    .result-table tr:last-child td { border-bottom: none; }
    .result-table tr:hover td { background: var(--bg3); }

    .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--text-muted);
    }
    .empty-state mat-icon, .error-state mat-icon {
      font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;
    }
    .error-state p { margin-bottom: 12px; }
  `,
  ],
})
export class SkbDetailComponent implements OnInit {
  private readonly service = inject(StructuredKbService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly container = signal<SKBContainer | null>(null);
  readonly files = signal<SKBFile[]>([]);
  readonly activeTab = signal<SkbTab>("files");

  readonly queryText = signal("");
  readonly queryResult = signal<QueryResult | null>(null);
  readonly queryLoading = signal(false);
  readonly queryError = signal<string | null>(null);
  readonly queryHistory = signal<QueryHistoryRecord[]>([]);

  private containerId = "";

  ngOnInit(): void {
    this.containerId = this.route.snapshot.paramMap.get("id") ?? "";
    if (this.containerId) {
      this.loadContainer();
      this.loadFiles();
    }
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      pending: "#999",
      processing: "#42a5f5",
      ready: "#66bb6a",
      failed: "#ef5350",
    };
    return colors[status?.toLowerCase() ?? ""] ?? "#999";
  }

  private loadContainer(): void {
    this.service.getContainer(this.containerId).subscribe({
      next: (res) => this.container.set(res),
      error: () =>
        this.snackBar.open("Failed to load container", "OK", {
          duration: 3000,
        }),
    });
  }

  private loadFiles(): void {
    this.service.getFiles(this.containerId).subscribe({
      next: (res) => this.files.set(res.files),
      error: () =>
        this.snackBar.open("Failed to load files", "OK", { duration: 3000 }),
    });
  }

  uploadFile(): void {
    this.dialog.open(SkbUploadDialogComponent, {
      width: "480px",
      data: { containerId: this.containerId },
    });
  }

  executeQuery(nlQuery: string): void {
    if (!nlQuery.trim()) {
      return;
    }
    this.queryLoading.set(true);
    this.queryError.set(null);
    this.queryResult.set(null);

    this.service.query(this.containerId, nlQuery).subscribe({
      next: (res) => {
        this.queryResult.set(res);
        this.queryLoading.set(false);
      },
      error: (err) => {
        this.queryError.set(err.message ?? "Query failed");
        this.queryLoading.set(false);
      },
    });
  }
}
