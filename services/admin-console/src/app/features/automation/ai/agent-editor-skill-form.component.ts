import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import type { ISubagentDraft } from "../../../core/models/agent.model";

/**
 * Center-pane editor for a single skill (subagent).
 * Mutates the bound `skill` object in place — same pattern as agent-config's skill loop.
 */
@Component({
  selector: "app-ai-editor-skill-form",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MonacoEditorModule,
  ],
  template: `
    <div class="focus-card">
      <header class="focus-header">
        <div class="title-block">
          <span class="kicker">Skill</span>
          <h2 class="title">{{ skill().name || "New skill" }}</h2>
        </div>
        <div class="skill-actions">
          @if (!skill().catalogSkillId) {
            <button type="button" class="btn-ghost btn-sm" (click)="saveToCatalog.emit()">
              <mat-icon>cloud_upload</mat-icon> Save to Catalog
            </button>
          } @else {
            <button type="button" class="btn-ghost btn-sm" (click)="syncFromCatalog.emit()">
              <mat-icon>sync</mat-icon> Sync
            </button>
            <span class="catalog-badge" title="Linked to Catalog skill">
              <mat-icon>link</mat-icon> Catalog
            </span>
          }
        </div>
        <button
          type="button"
          class="icon-btn danger"
          aria-label="Remove skill"
          (click)="remove.emit()"
        >
          <mat-icon>delete</mat-icon>
        </button>
      </header>

      <div class="focus-grid">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input
            matInput
            [ngModel]="skill().name"
            (ngModelChange)="onNameChange($event)"
            maxlength="120"
            placeholder="Lead Qualifier"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <input
            matInput
            [ngModel]="skill().description ?? ''"
            (ngModelChange)="onDescriptionChange($event)"
            placeholder="When this skill should be used"
          />
        </mat-form-field>

        <div class="full-span editor-container">
          <label class="editor-label">System Prompt</label>
          <ngx-monaco-editor
            class="prompt-editor"
            [options]="editorOptions()"
            [ngModel]="skill().systemPrompt"
            (ngModelChange)="onSystemPromptChange($event)"
          />
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .focus-card {
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 20px 22px;
    }

    .focus-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .title-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .kicker {
      font-size: 10px;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .icon-btn {
      width: 32px;
      height: 32px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .icon-btn.danger:hover {
      color: #f87171;
      border-color: rgba(248, 113, 113, 0.3);
      background: rgba(248, 113, 113, 0.06);
    }

    .skill-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .btn-ghost {
      font-size: 11px;
      padding: 3px 8px;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .btn-ghost:hover {
      border-color: var(--primary);
      color: var(--primary);
      background: rgba(66, 165, 245, 0.04);
    }

    .catalog-badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      background: rgba(66, 165, 245, 0.1);
      color: #42a5f5;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-weight: 500;
    }

    .catalog-badge mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .focus-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .full-span {
      grid-column: 1 / -1;
    }

    .editor-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .editor-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    }

    .prompt-editor {
      display: block;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius2);
      overflow: hidden;
      height: 280px;
    }

    @media (max-width: 980px) {
      .focus-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AiAgentEditorSkillFormComponent {
  readonly skill = input.required<ISubagentDraft>();
  readonly editorOptions = input.required<Record<string, unknown>>();
  readonly remove = output<void>();
  readonly skillChange = output<ISubagentDraft>();
  readonly saveToCatalog = output<void>();
  readonly syncFromCatalog = output<void>();

  protected onNameChange(value: string): void {
    this.skillChange.emit({ ...this.skill(), name: value });
  }

  protected onDescriptionChange(value: string): void {
    this.skillChange.emit({ ...this.skill(), description: value });
  }

  protected onSystemPromptChange(value: string): void {
    this.skillChange.emit({ ...this.skill(), systemPrompt: value });
  }
}
