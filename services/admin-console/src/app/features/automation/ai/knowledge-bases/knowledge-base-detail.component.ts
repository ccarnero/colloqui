import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ActivatedRoute, RouterLink } from "@angular/router";
import {
  AdaptersService,
  type IAdapterSummary,
} from "../../../../core/services/adapters.service";
import {
  type IDocument,
  type IKnowledgeBase,
  KnowledgeBasesService,
} from "../../../../core/services/knowledge-bases.service";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import { ChunkViewerDialogComponent } from "./chunk-viewer-dialog.component";
import {
  DocumentUploadDialogComponent,
  type IDocumentUploadDialogResult,
} from "./document-upload-dialog.component";

const STATUS_COLORS: Record<string, string> = {
  pending: "#ffa726",
  processing: "#42a5f5",
  ready: "#66bb6a",
  failed: "#ef5350",
};

@Component({
  selector: "app-knowledge-base-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    UtcDatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="detail-page">
      <div class="page-header">
        <div class="page-header-left">
          <a class="back-link" routerLink="/ai/knowledge-bases">
            <mat-icon>arrow_back</mat-icon>
            <span>Knowledge Bases</span>
          </a>
          <div class="kb-title-section">
            <h1>{{ kb()?.name }}</h1>
            @if (kb()?.description) {
              <p class="text-secondary">{{ kb()?.description }}</p>
            }
            <div class="kb-meta">
              @if (kb()?.project) {
                <span class="kb-badge project-badge">{{ kb()?.project }}</span>
              }
              @if (kb()?.category) {
                <span class="kb-badge category-badge">{{ kb()?.category }}</span>
              }
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" (click)="uploadDocument()">
          <mat-icon>upload</mat-icon> Upload Document
        </button>
      </div>

      @if (ingestionConfigKeys.length > 0) {
        <div class="ingestion-config-section">
          <h2>Ingestion Configuration</h2>
          <div class="config-grid">
            @for (key of ingestionConfigKeys; track key) {
              <div class="config-item">
                <span class="config-label">{{ formatConfigKey(key) }}</span>
                <span class="config-value">{{ formatConfigValue(key, kb()?.ingestion_config?.[key]) }}</span>
              </div>
            }
          </div>
        </div>
      }

      <div class="documents-section">
        <h2>Documents ({{ documents().length }})</h2>

        @if (documents().length > 0) {
          <div class="doc-table">
            <div class="doc-table-header">
              <span class="col-filename">Filename</span>
              <span class="col-type">Type</span>
              <span class="col-status">Status</span>
              <span class="col-chunks">Chunks</span>
              <span class="col-date">Created</span>
              <span class="col-actions"></span>
            </div>
            @for (doc of documents(); track doc.id) {
              <div class="doc-table-row">
                <span class="col-filename" title="{{ doc.original_filename }}">
                  <mat-icon class="file-icon">description</mat-icon>
                  {{ doc.original_filename }}
                </span>
                <span class="col-type">
                  <span class="type-badge">{{ doc.content_type }}</span>
                </span>
                <span class="col-status">
                  <span
                    class="status-badge"
                    [style.background]="statusColor(doc.status) + '20'"
                    [style.color]="statusColor(doc.status)"
                    [title]="doc.status?.toLowerCase() === 'failed' && doc.error_message ? doc.error_message : ''"
                  >
                    {{ doc.status }}
                    @if (doc.status?.toLowerCase() === 'failed' && doc.error_message) {
                      <mat-icon class="error-icon" [title]="doc.error_message">error_outline</mat-icon>
                    }
                  </span>
                </span>
                <span class="col-chunks">
                  @if (doc.status?.toLowerCase() === 'ready' && doc.chunk_count > 0) {
                    <button class="chunk-link" (click)="openChunkViewer(doc)">
                      {{ doc.chunk_count }}
                    </button>
                  } @else {
                    {{ doc.chunk_count }}
                  }
                </span>
                <span class="col-date">{{ doc.created_at | utcDate:"short" }}</span>
                <span class="col-actions">
                  @if (doc.status?.toLowerCase() === 'failed' || doc.status?.toLowerCase() === 'processing') {
                    <button
                      class="icon-btn"
                      (click)="reingestDocument(doc)"
                      title="Retry ingestion"
                    >
                      <mat-icon>refresh</mat-icon>
                    </button>
                  }
                  <button
                    class="icon-btn danger"
                    (click)="deleteDocument(doc)"
                    title="Delete document"
                  >
                    <mat-icon>delete</mat-icon>
                  </button>
                </span>
              </div>
            }
          </div>
        } @else {
          <div class="empty-state">
            <mat-icon>description</mat-icon>
            <p>No documents yet. Upload your first document!</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
    .detail-page { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .page-header-left { display: flex; flex-direction: column; gap: 8px; }
    .back-link {
      display: inline-flex; align-items: center; gap: 4px; font-size: 13px;
      color: var(--text-secondary); text-decoration: none; cursor: pointer;
    }
    .back-link:hover { color: var(--text-primary); }
    .back-link mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .kb-title-section h1 { margin: 0; font-size: 24px; }
    .kb-title-section p { margin: 2px 0 0; font-size: 13px; }
    .kb-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .kb-badge {
      padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .project-badge { background: rgba(66, 165, 245, 0.12); color: #42a5f5; }
    .category-badge { background: rgba(102, 187, 106, 0.12); color: #66bb6a; }

    .ingestion-config-section { margin-top: 24px; }
    .ingestion-config-section h2 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
    .config-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--bg2);
    }
    .config-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .config-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    .config-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      font-family: var(--font-mono, monospace);
    }

    .documents-section { margin-top: 8px; }
    .documents-section h2 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }

    .doc-table {
      border: 1px solid var(--border-subtle); border-radius: 10px; overflow: hidden;
    }
    .doc-table-header {
      display: grid;
      grid-template-columns: 1fr 100px 110px 80px 140px 60px;
      gap: 12px;
      padding: 10px 16px;
      background: var(--bg3);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    .doc-table-row {
      display: grid;
      grid-template-columns: 1fr 100px 110px 80px 140px 60px;
      gap: 12px;
      padding: 10px 16px;
      align-items: center;
      border-top: 1px solid var(--border-subtle);
      font-size: 13px;
    }
    .doc-table-row:hover { background: var(--bg3); }
    .col-filename {
      display: flex; align-items: center; gap: 8px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .file-icon { font-size: 18px; width: 18px; height: 18px; color: var(--text-muted); flex-shrink: 0; }
    .type-badge {
      padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      background: rgba(255, 167, 38, 0.12); color: #ffa726;
      text-transform: uppercase;
    }
    .status-badge {
      padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex;
      align-items: center;
    }
    .error-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      margin-left: 4px;
      vertical-align: middle;
      cursor: help;
    }
    .col-chunks { color: var(--text-secondary); text-align: center; }
    .chunk-link {
      background: none;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      padding: 1px 8px;
      cursor: pointer;
      color: var(--primary, #7c4dff);
      font-weight: 600;
      font-size: 13px;
      transition: background 0.15s;
    }
    .chunk-link:hover {
      background: rgba(124, 77, 255, 0.08);
      border-color: var(--primary, #7c4dff);
    }
    .col-date { color: var(--text-muted); font-size: 12px; }
    .col-actions { display: flex; gap: 4px; justify-content: flex-end; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 1px solid var(--border-subtle); border-radius: 8px; background: transparent;
      color: var(--text-muted); cursor: pointer;
    }
    .icon-btn:hover { color: var(--text-primary); border-color: var(--border2); }
    .icon-btn.danger:hover { color: #ef5350; border-color: #ef5350; }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
  `,
  ],
})
export class KnowledgeBaseDetailComponent implements OnInit {
  private readonly service = inject(KnowledgeBasesService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly adaptersService = inject(AdaptersService);

  readonly kb = signal<IKnowledgeBase | null>(null);
  readonly documents = signal<IDocument[]>([]);
  readonly llmConnectors = signal<IAdapterSummary[]>([]);

  private kbId = "";

  statusColor(status: string): string {
    return STATUS_COLORS[status?.toLowerCase() ?? ""] ?? "#999";
  }

  get ingestionConfigKeys(): string[] {
    const cfg = this.kb()?.ingestion_config;
    return cfg ? Object.keys(cfg) : [];
  }

  formatConfigKey(key: string): string {
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  formatConfigValue(key: string, value: unknown): string {
    if (key === "provider_connector_id" && typeof value === "string") {
      const conn = this.llmConnectors().find((c) => c.id === value);
      return conn ? conn.name : value;
    }
    return String(value ?? "");
  }

  ngOnInit(): void {
    this.kbId = this.route.snapshot.paramMap.get("id") ?? "";
    if (this.kbId) {
      this.loadKnowledgeBase();
      this.loadDocuments();
    }
    this.adaptersService.listByTag("llm").subscribe({
      next: (connectors) => this.llmConnectors.set(connectors),
    });
  }

  private loadKnowledgeBase(): void {
    this.service.findById(this.kbId).subscribe({
      next: (res) => this.kb.set(res),
      error: () =>
        this.snackBar.open("Failed to load knowledge base", "OK", {
          duration: 3000,
        }),
    });
  }

  private loadDocuments(): void {
    this.service.findDocuments(this.kbId).subscribe({
      next: (res) => this.documents.set(res.documents),
      error: () =>
        this.snackBar.open("Failed to load documents", "OK", {
          duration: 3000,
        }),
    });
  }

  uploadDocument(): void {
    const ref = this.dialog.open(DocumentUploadDialogComponent, {
      width: "560px",
      data: { knowledgeBaseId: this.kbId },
    });
    ref
      .afterClosed()
      .subscribe((result: IDocumentUploadDialogResult | undefined) => {
        if (result?.saved) {
          this.loadDocuments();
          this.snackBar.open("Document uploaded", "OK", { duration: 2000 });
        }
      });
  }

  openChunkViewer(doc: IDocument): void {
    this.dialog.open(ChunkViewerDialogComponent, {
      width: "720px",
      maxHeight: "80vh",
      data: {
        knowledgeBaseId: this.kbId,
        document: doc,
      },
    });
  }

  reingestDocument(doc: IDocument): void {
    if (!confirm(`Retry ingestion for "${doc.original_filename}"?`)) {
      return;
    }
    this.service.reingestDocument(this.kbId, doc.id).subscribe({
      next: () => {
        this.loadDocuments();
        this.snackBar.open("Document queued for re-ingestion", "OK", {
          duration: 2000,
        });
      },
      error: () =>
        this.snackBar.open("Failed to retry document", "OK", {
          duration: 3000,
        }),
    });
  }

  deleteDocument(doc: IDocument): void {
    if (!confirm(`Delete document "${doc.original_filename}"?`)) {
      return;
    }
    this.service.deleteDocument(this.kbId, doc.id).subscribe({
      next: () => {
        this.loadDocuments();
        this.snackBar.open("Document deleted", "OK", { duration: 2000 });
      },
      error: () =>
        this.snackBar.open("Failed to delete document", "OK", {
          duration: 3000,
        }),
    });
  }
}
