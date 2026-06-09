import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import {
  KnowledgeBasesService,
  type IChunk,
  type IChunkListResponse,
  type IDocument,
} from "../../../../core/services/knowledge-bases.service";

export interface IChunkViewerDialogData {
  knowledgeBaseId: string;
  document: IDocument;
}

@Component({
  selector: "app-chunk-viewer-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>view_list</mat-icon>
      Chunks: {{ data.document.original_filename }}
    </h2>

    <mat-dialog-content>
      <div class="chunk-meta">
        <span class="chunk-meta-left">
          <span class="doc-type-badge">{{ data.document.content_type.toUpperCase() }}</span>
          <span class="chunk-count">{{ data.document.chunk_count }} chunks</span>
        </span>
        <span class="chunk-meta-right">
          Page {{ currentPage() }} of {{ totalPages() }} | Showing {{ chunks().length }} of {{ data.document.chunk_count }} chunks
        </span>
      </div>

      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Loading chunks...</span>
        </div>
      } @else {
        <div class="chunks-list">
          @for (chunk of chunks(); track chunk.id) {
            @if (editingChunk() === chunk.chunk_index) {
              <div class="chunk-card editing">
                <div class="chunk-header">
                  <span class="chunk-index"><span class="chunk-index-badge">#{{ chunk.chunk_index }}</span> Editing</span>
                  <span class="chunk-header-right">
                    <span class="chunk-size">{{ editContent().length }} chars</span>
                  </span>
                </div>
                <div class="chunk-edit">
                  <textarea
                    class="edit-textarea"
                    [value]="editContent()"
                    (input)="onEditInput($event)"
                    rows="12"
                  ></textarea>
                  <div class="edit-actions">
                    <button mat-stroked-button (click)="cancelEdit()" [disabled]="saving()">Cancel</button>
                    <button mat-flat-button color="primary" (click)="saveEdit(chunk)" [disabled]="saving()">
                      {{ saving() ? "Saving..." : "Save" }}
                    </button>
                  </div>
                </div>
              </div>
            } @else {
              <div class="chunk-card">
                <div class="chunk-header">
                  <span class="chunk-index"><span class="chunk-index-badge">#{{ chunk.chunk_index }}</span> Chunk</span>
                  <span class="chunk-header-right">
                    @if (chunk.is_edited) {
                      <span class="edited-badge">edited</span>
                    }
                    <span class="chunk-size">{{ chunk.char_count }} chars</span>
                    <button class="edit-btn" (click)="startEdit(chunk)">
                      <mat-icon>edit</mat-icon>
                    </button>
                  </span>
                </div>
                <div class="chunk-content">
                  @if (expandedChunks().has(chunk.chunk_index)) {
                    <pre class="chunk-text">{{ chunk.content }}</pre>
                    <button class="expand-btn" (click)="toggleExpand(chunk.chunk_index)">
                      <mat-icon>expand_less</mat-icon> Collapse
                    </button>
                  } @else {
                    <pre class="chunk-text truncated">{{ chunk.content | slice:0:400 }}{{ chunk.content.length > 400 ? '...' : '' }}</pre>
                    @if (chunk.content.length > 400) {
                      <button class="expand-btn" (click)="toggleExpand(chunk.chunk_index)">
                        <mat-icon>expand_more</mat-icon> Expand
                      </button>
                    }
                  }
                </div>
              </div>
            }
          }
        </div>

        @if (totalPages() > 1) {
          <div class="pagination">
            <button
              mat-icon-button
              class="pagination-btn"
              [class.pagination-btn-disabled]="currentPage() <= 1"
              [disabled]="currentPage() <= 1"
              (click)="loadPage(currentPage() - 1)"
            >
              <mat-icon>chevron_left</mat-icon>
            </button>
            <span class="page-info">Page <strong>{{ currentPage() }}</strong> of {{ totalPages() }}</span>
            <button
              mat-icon-button
              class="pagination-btn"
              [class.pagination-btn-disabled]="currentPage() >= totalPages()"
              [disabled]="currentPage() >= totalPages()"
              (click)="loadPage(currentPage() + 1)"
            >
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    :host { display: block; min-width: 800px; max-width: 1000px; }
    h2 { display: flex; align-items: center; gap: 8px; }
    h2 mat-icon { color: var(--primary, #7c4dff); }

    .chunk-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .chunk-meta-left { display: flex; align-items: center; gap: 10px; }
    .chunk-meta-right { font-size: 12px; color: var(--text-secondary, #888); }
    .doc-type-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; background: rgba(124, 77, 255, 0.12); color: var(--primary, #7c4dff); }
    .chunk-count { font-size: 14px; font-weight: 600; color: var(--text-primary, #eee); }

    .loading { display: flex; align-items: center; gap: 12px; padding: 32px; justify-content: center; color: var(--text-secondary, #888); }

    .chunks-list { display: flex; flex-direction: column; gap: 16px; max-height: 65vh; overflow-y: auto; }

    .chunk-card { border: 1px solid var(--border-subtle, #333); border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: box-shadow 0.2s ease, border-color 0.2s ease; }
    .chunk-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
    .chunk-card.editing { border-color: var(--primary, #7c4dff); }
    .chunk-card.editing:hover { box-shadow: 0 2px 8px rgba(124, 77, 255, 0.3); }

    .chunk-edit { padding: 12px; }
    .edit-textarea { width: 100%; min-height: 200px; font-family: 'JetBrains Mono', 'Fira Code', var(--font-mono, monospace); font-size: 13px; line-height: 1.6; padding: 12px; border: 1px solid var(--border-subtle, #333); border-radius: 8px; background: var(--bg1, #111); color: var(--text-primary, #eee); resize: vertical; box-sizing: border-box; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
    .edit-textarea:focus { outline: none; border-color: var(--primary, #7c4dff); box-shadow: 0 0 0 3px rgba(124, 77, 255, 0.2); }
    .edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }

    .edit-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: none; border-radius: 50%; background: transparent; color: var(--text-muted, #666); cursor: pointer; transition: background 0.2s ease, color 0.2s ease; }
    .edit-btn:hover { background: var(--bg3, #222); color: var(--text-primary, #eee); }
    .edit-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .chunk-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg3, #222); border-radius: 10px 10px 0 0; font-size: 13px; }
    .chunk-header-right { display: flex; align-items: center; gap: 8px; }
    .chunk-index { display: flex; align-items: center; gap: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted, #666); }
    .chunk-index-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; background: rgba(124, 77, 255, 0.12); color: var(--primary, #7c4dff); }
    .chunk-size { color: var(--text-secondary, #888); font-family: var(--font-mono, monospace); font-size: 12px; }
    .edited-badge { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(255, 167, 38, 0.12); color: #ffa726; text-transform: uppercase; }

    .chunk-content { padding: 12px; }
    .chunk-text { margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono, monospace); color: var(--text-primary, #eee); }
    .chunk-text.truncated { max-height: 140px; overflow: hidden; }
    .expand-btn { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--primary, #7c4dff); cursor: pointer; font-size: 12px; padding: 4px 0; margin-top: 4px; }
    .expand-btn:hover { text-decoration: underline; }
    .expand-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0 0; }
    .pagination-btn { color: var(--text-primary, #eee); }
    .pagination-btn-disabled { color: var(--text-muted, #444) !important; }
    .page-info { font-size: 13px; color: var(--text-secondary, #888); }
    .page-info strong { color: var(--text-primary, #eee); font-weight: 600; }
  `,
})
export class ChunkViewerDialogComponent implements OnInit {
  private readonly service = inject(KnowledgeBasesService);
  private readonly dialogRef = inject(MatDialogRef<ChunkViewerDialogComponent>);
  protected readonly data = inject<IChunkViewerDialogData>(MAT_DIALOG_DATA);

  readonly chunks = signal<IChunk[]>([]);
  readonly loading = signal(true);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly expandedChunks = signal(new Set<number>());

  readonly editingChunk = signal<number | null>(null);
  readonly editContent = signal("");
  readonly saving = signal(false);

  private readonly pageSize = 50;

  ngOnInit(): void {
    this.loadPage(1);
  }

  loadPage(page: number): void {
    this.loading.set(true);
    this.service
      .findDocumentChunks(this.data.knowledgeBaseId, this.data.document.id, page, this.pageSize)
      .subscribe({
        next: (res: IChunkListResponse) => {
          this.chunks.set(res.chunks);
          this.currentPage.set(res.page);
          this.totalPages.set(res.total_pages);
          this.loading.set(false);
          this.expandedChunks.set(new Set());
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  toggleExpand(index: number): void {
    const set = new Set(this.expandedChunks());
    if (set.has(index)) {
      set.delete(index);
    } else {
      set.add(index);
    }
    this.expandedChunks.set(set);
  }

  startEdit(chunk: IChunk): void {
    this.editingChunk.set(chunk.chunk_index);
    this.editContent.set(chunk.content);
  }

  cancelEdit(): void {
    this.editingChunk.set(null);
    this.editContent.set("");
  }

  onEditInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.editContent.set(textarea.value);
  }

  saveEdit(chunk: IChunk): void {
    this.saving.set(true);
    this.service
      .updateChunk(
        this.data.knowledgeBaseId,
        this.data.document.id,
        chunk.id,
        this.editContent(),
      )
      .subscribe({
        next: (updated) => {
          const current = this.chunks();
          const idx = current.findIndex((c) => c.id === chunk.id);
          if (idx >= 0) {
            const updatedList = [...current];
            updatedList[idx] = { ...updatedList[idx], ...updated };
            this.chunks.set(updatedList);
          }
          this.editingChunk.set(null);
          this.editContent.set("");
          this.saving.set(false);
        },
        error: () => {
          this.saving.set(false);
        },
      });
  }
}
