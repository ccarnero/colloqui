import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import {
  KnowledgeBasesService,
  type IKnowledgeBase,
} from "../../../../core/services/knowledge-bases.service";
import {
  KnowledgeBaseFormDialogComponent,
  type IKnowledgeBaseDialogResult,
} from "./knowledge-base-form-dialog.component";

@Component({
  selector: "app-knowledge-bases-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="knowledge-bases-page">
      <div class="page-header">
        <div>
          <h1>Knowledge Bases</h1>
          <p class="text-secondary">
            Manage knowledge bases for your AI agents
          </p>
        </div>
        <button class="btn btn-primary btn-sm" (click)="createKnowledgeBase()">
          <mat-icon>add</mat-icon> New KB
        </button>
      </div>

      <div class="kb-grid">
        @for (kb of knowledgeBases(); track kb.id) {
          <a class="kb-card" [routerLink]="kb.id">
            <div class="kb-body">
              <div class="kb-header">
                <span class="kb-icon">
                  <mat-icon>library_books</mat-icon>
                </span>
                <div class="kb-info">
                  <strong>{{ kb.name }}</strong>
                  @if (kb.description) {
                    <span class="kb-description">{{ kb.description }}</span>
                  }
                </div>
              </div>
              <div class="kb-meta">
                @if (kb.project) {
                  <span class="kb-badge project-badge">{{ kb.project }}</span>
                }
                @if (kb.category) {
                  <span class="kb-badge category-badge">{{ kb.category }}</span>
                }
                @if (!kb.is_active) {
                  <span class="kb-badge inactive-badge">Inactive</span>
                }
              </div>
            </div>
            <div class="kb-footer">
              <span class="kb-date">
                Updated {{ kb.updated_at | date:"short" }}
              </span>
              <div class="kb-actions" (click)="$event.stopPropagation()">
                <button
                  class="icon-btn"
                  (click)="editKnowledgeBase(kb)"
                  title="Edit"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  class="icon-btn danger"
                  (click)="deleteKnowledgeBase(kb)"
                  title="Delete"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </div>
          </a>
        } @empty {
          <div class="empty-state">
            <mat-icon>library_books</mat-icon>
            <p>No knowledge bases yet. Create your first one!</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
    .knowledge-bases-page { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; }
    .kb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .kb-card {
      background: var(--bg2); border: 1px solid var(--border-subtle); border-radius: 12px;
      border-left: 4px solid #7c4dff; padding: 16px; display: flex; flex-direction: column; gap: 12px;
      text-decoration: none; color: inherit; cursor: pointer; transition: border-color 0.15s;
    }
    .kb-card:hover { border-color: var(--border2); }
    .kb-body { display: flex; flex-direction: column; gap: 10px; }
    .kb-header { display: flex; align-items: center; gap: 12px; }
    .kb-icon {
      width: 40px; height: 40px; border-radius: 10px; display: flex;
      align-items: center; justify-content: center; flex-shrink: 0;
      background: rgba(124, 77, 255, 0.12);
    }
    .kb-icon mat-icon { font-size: 22px; width: 22px; height: 22px; color: #7c4dff; }
    .kb-info { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
    .kb-info strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kb-description { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kb-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .kb-badge {
      padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
    }
    .project-badge { background: rgba(66, 165, 245, 0.12); color: #42a5f5; }
    .category-badge { background: rgba(102, 187, 106, 0.12); color: #66bb6a; }
    .inactive-badge { background: rgba(239, 83, 80, 0.12); color: #ef5350; }
    .kb-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .kb-date { font-size: 11px; color: var(--text-muted); }
    .kb-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 1px solid var(--border-subtle); border-radius: 8px; background: transparent;
      color: var(--text-muted); cursor: pointer;
    }
    .icon-btn:hover { color: var(--text-primary); border-color: var(--border2); }
    .icon-btn.danger:hover { color: #ef5350; border-color: #ef5350; }
    .empty-state { grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
  `,
  ],
})
export class KnowledgeBasesPageComponent implements OnInit {
  private readonly service = inject(KnowledgeBasesService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly knowledgeBases = signal<IKnowledgeBase[]>([]);

  ngOnInit(): void {
    this.loadKnowledgeBases();
  }

  private loadKnowledgeBases(): void {
    this.service.findAll().subscribe({
      next: (res) => this.knowledgeBases.set(res.knowledge_bases),
      error: () =>
        this.snackBar.open("Failed to load knowledge bases", "OK", {
          duration: 3000,
        }),
    });
  }

  createKnowledgeBase(): void {
    const ref = this.dialog.open(KnowledgeBaseFormDialogComponent, {
      width: "560px",
      data: {},
    });
    ref
      .afterClosed()
      .subscribe(
        (result: IKnowledgeBaseDialogResult | undefined) => {
          if (result?.saved) {
            this.loadKnowledgeBases();
            this.snackBar.open("Knowledge base created", "OK", {
              duration: 2000,
            });
          }
        },
      );
  }

  editKnowledgeBase(kb: IKnowledgeBase): void {
    const ref = this.dialog.open(KnowledgeBaseFormDialogComponent, {
      width: "560px",
      data: { knowledgeBase: kb },
    });
    ref
      .afterClosed()
      .subscribe(
        (result: IKnowledgeBaseDialogResult | undefined) => {
          if (result?.saved) {
            this.loadKnowledgeBases();
            this.snackBar.open("Knowledge base updated", "OK", {
              duration: 2000,
            });
          }
        },
      );
  }

  deleteKnowledgeBase(kb: IKnowledgeBase): void {
    if (!confirm(`Delete knowledge base "${kb.name}"?`)) return;
    this.service.delete(kb.id).subscribe({
      next: () => {
        this.loadKnowledgeBases();
        this.snackBar.open("Knowledge base deleted", "OK", { duration: 2000 });
      },
      error: () =>
        this.snackBar.open("Failed to delete knowledge base", "OK", {
          duration: 3000,
        }),
    });
  }
}
