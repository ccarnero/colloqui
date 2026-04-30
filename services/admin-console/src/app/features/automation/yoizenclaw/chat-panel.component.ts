import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatChipsModule } from "@angular/material/chips";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import type { ISkillInfo, IToolInfo } from "./yoizenclaw.types";

@Component({
  selector: "app-yoizenclaw-chat-panel",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatChipsModule,
    MatFormFieldModule,
    MatTooltipModule,
    MonacoEditorModule,
  ],
  template: `
    <div class="section-card-body">
      <div class="editor-grid">
        <div class="full-span editor-container">
          <label class="editor-label">System Prompt</label>
          <div class="prompt-hint">
            Use <code>&#64;skill:name</code> to invoke skills and
            <code>&#64;tool:name</code> to invoke tools from the prompt.
          </div>

          <div class="quick-insert-section">
            <span class="quick-insert-label">Quick insert:</span>
            <div class="quick-insert-chips">
              @for (skill of availableSkills(); track skill.id) {
                <button
                  mat-chip-option
                  [matTooltip]="skill.description"
                  matTooltipPosition="above"
                  (click)="insertMention('@skill:' + skill.id)"
                >
                  &#64;skill:{{ skill.id }}
                </button>
              }
              @for (tool of availableTools(); track tool.id) {
                <button
                  mat-chip-option
                  [matTooltip]="tool.description"
                  matTooltipPosition="above"
                  (click)="insertMention('@tool:' + tool.id)"
                >
                  &#64;tool:{{ tool.id }}
                </button>
              }
            </div>
          </div>

          <ngx-monaco-editor
            class="prompt-editor"
            [options]="editorOptions()"
            [(ngModel)]="systemPrompt"
          />

          @if (extractedMentions().length > 0) {
            <div class="mentions-section">
              <label class="mentions-label">Detected References:</label>
              <div class="mentions-chips">
                @for (mention of extractedMentions(); track mention) {
                  <mat-chip
                    [color]="
                      mention.startsWith('@skill') ? 'accent' : 'primary'
                    "
                    selected
                  >
                    {{ mention }}
                  </mat-chip>
                }
              </div>
            </div>
          }
        </div>

        <div class="full-span editor-container">
          <label class="editor-label">Rules</label>
          <ngx-monaco-editor
            class="prompt-editor-sm"
            [options]="editorOptions()"
            [(ngModel)]="rules"
          />
        </div>

        <div class="full-span editor-container">
          <label class="editor-label">Soul</label>
          <ngx-monaco-editor
            class="prompt-editor-sm"
            [options]="editorOptions()"
            [(ngModel)]="soul"
          />
        </div>
      </div>
    </div>
  `,
  styles: `
    .editor-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .full-span {
      grid-column: 1 / -1;
    }

    .prompt-hint {
      margin-bottom: 12px;
      color: var(--text3);
      font-size: 13px;
    }

    .prompt-hint code {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }

    .mentions-section {
      margin-top: 16px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .mentions-label {
      display: block;
      font-size: 12px;
      color: var(--text3);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mentions-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .quick-insert-section {
      margin-bottom: 12px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .quick-insert-label {
      display: block;
      font-size: 11px;
      color: var(--text3);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .quick-insert-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .quick-insert-chips button {
      font-size: 12px;
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .quick-insert-chips button:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.2);
      color: var(--text-primary);
    }

    .editor-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .editor-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    }

    .prompt-editor,
    .prompt-editor-sm {
      display: block;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius2);
      overflow: hidden;
    }

    .prompt-editor {
      height: 300px;
    }

    .prompt-editor-sm {
      height: 150px;
    }

    @media (max-width: 1180px) {
      .editor-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 720px) {
      .editor-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class YoizenclawChatPanelComponent {
  readonly editorOptions = input.required<Record<string, unknown>>();
  readonly availableSkills = input.required<ISkillInfo[]>();
  readonly availableTools = input.required<IToolInfo[]>();
  readonly extractedMentions = input.required<string[]>();

  readonly systemPrompt = model("");
  readonly rules = model("");
  readonly soul = model("");

  insertMention(mention: string): void {
    let next = this.systemPrompt();
    if (next.length > 0 && !next.endsWith(" ")) {
      next += " ";
    }
    this.systemPrompt.set(next + mention + " ");
  }
}
