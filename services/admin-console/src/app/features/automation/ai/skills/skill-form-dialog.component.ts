import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import type { ISkill, ISkillFile } from "../../../../core/services/skills.service";

export interface ISkillFormResult {
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  color: string;
  trigger_commands: string[];
  when_to_use: string;
  priority: number;
  allowed_tools: string[];
  mode: string;
  files?: ISkillFile[];
}

const ICON_OPTIONS = [
  { value: "smart_toy", label: "Bot" },
  { value: "person_search", label: "Search" },
  { value: "verified", label: "Verified" },
  { value: "code", label: "Code" },
  { value: "analytics", label: "Analytics" },
  { value: "translate", label: "Translate" },
  { value: "forum", label: "Chat" },
  { value: "psychology", label: "Psychology" },
  { value: "travel_explore", label: "Explore" },
  { value: "summarize", label: "Summarize" },
];

const COLOR_OPTIONS = [
  { value: "#42a5f5", label: "Blue" },
  { value: "#4caf50", label: "Green" },
  { value: "#ff9800", label: "Orange" },
  { value: "#9c27b0", label: "Purple" },
  { value: "#ef5350", label: "Red" },
  { value: "#26c6da", label: "Cyan" },
  { value: "#ec407a", label: "Pink" },
];

@Component({
  selector: "app-skill-form-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ skill ? "Edit Skill" : "New Skill" }}</h2>

    <mat-dialog-content>
      <mat-tab-group>
        <mat-tab label="General">
          <div class="form-grid">
            <mat-form-field appearance="outline" class="full-span">
              <mat-label>Name</mat-label>
              <input
                matInput
                [(ngModel)]="form.name"
                placeholder="Lead Qualification"
                required
              />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-span">
              <mat-label>Description</mat-label>
              <input
                matInput
                [(ngModel)]="form.description"
                placeholder="Brief description of when to use this skill"
              />
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Icon</mat-label>
              <mat-select [(ngModel)]="form.icon">
                @for (ico of icons; track ico.value) {
                  <mat-option [value]="ico.value">{{ ico.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Color</mat-label>
              <mat-select [(ngModel)]="form.color">
                @for (c of colors; track c.value) {
                  <mat-option [value]="c.value">
                    <span class="color-dot" [style.background]="c.value"></span>
                    {{ c.label }}
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-span">
              <mat-label>Trigger Commands (comma-separated)</mat-label>
              <input
                matInput
                [(ngModel)]="triggerCommandsText"
                placeholder="/help, /guide, /tutorial"
              />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-span">
              <mat-label>System Prompt</mat-label>
              <textarea
                matInput
                [(ngModel)]="form.system_prompt"
                rows="8"
                placeholder="Instructions for the agent when using this skill..."
                required
              ></textarea>
            </mat-form-field>
          </div>
        </mat-tab>
        <mat-tab label="Files">
          <div class="files-section">
            <p class="text-muted text-sm">Add scripts, reference docs, and assets that the agent can use with this skill.</p>

            <div class="file-list">
              @for (file of files; track $index) {
                <div class="file-row">
                  <div class="file-header">
                    <mat-icon class="file-icon">{{ getFileIcon(file.type) }}</mat-icon>
                    <input class="file-name-input" [(ngModel)]="file.name" placeholder="filename.ext" [ngModelOptions]="{standalone: true}" />
                    <select class="file-type-select" [(ngModel)]="file.type" [ngModelOptions]="{standalone: true}">
                      <option value="script">Script</option>
                      <option value="reference">Reference</option>
                      <option value="asset">Asset</option>
                    </select>
                    <button type="button" class="icon-btn danger" (click)="removeFile($index)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                  <textarea class="file-content-editor" [(ngModel)]="file.content" rows="6" placeholder="File content..." [ngModelOptions]="{standalone: true}"></textarea>
                </div>
              }
            </div>

            <button type="button" class="btn btn-secondary btn-sm" (click)="addFile()">
              <mat-icon>add</mat-icon> Add File
            </button>
          </div>
        </mat-tab>
      </mat-tab-group>

      <details class="advanced-section">
        <summary class="advanced-summary">
          <mat-icon>tune</mat-icon> Advanced Settings
        </summary>
        <div class="advanced-fields">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>When To Use</mat-label>
            <textarea matInput [(ngModel)]="form.when_to_use" rows="3"
              placeholder="Describe when the LLM should activate this skill..."></textarea>
            <mat-hint>Helps the LLM decide when this skill is relevant</mat-hint>
          </mat-form-field>

          <div class="inline-fields">
            <mat-form-field appearance="outline">
              <mat-label>Priority</mat-label>
              <input matInput type="number" [(ngModel)]="form.priority" min="0" max="1000" />
              <mat-hint>Higher = preferred (default: 0)</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Mode</mat-label>
              <mat-select [(ngModel)]="form.mode">
                @for (opt of modeOptions; track opt.value) {
                  <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                }
              </mat-select>
              <mat-hint>How this skill is activated</mat-hint>
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Allowed Tools</mat-label>
            <input matInput [(ngModel)]="allowedToolsText"
              placeholder="tool1, tool2, tool3" />
            <mat-hint>Tools this skill may use (comma-separated)</mat-hint>
          </mat-form-field>
        </div>
      </details>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button
        mat-button
        color="primary"
        type="button"
        [disabled]="!form.name || !form.system_prompt"
        [mat-dialog-close]="getResult()"
      >
        Save
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form-grid {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 8px 0;
    }
    .full-span, .full-width {
      width: 100%;
    }
    .color-dot {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      margin-right: 8px;
      vertical-align: middle;
    }
    textarea {
      resize: vertical;
      min-height: 120px;
    }
    .files-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 0;
    }
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .file-row {
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 12px;
      background: var(--bg3);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .file-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .file-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .file-name-input {
      flex: 1;
      background: var(--bg2);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 6px 10px;
      color: var(--text-primary);
      font-size: 13px;
      font-family: monospace;
    }
    .file-name-input:focus {
      outline: none;
      border-color: var(--primary);
    }
    .file-type-select {
      background: var(--bg2);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 6px 8px;
      color: var(--text-primary);
      font-size: 12px;
    }
    .file-type-select:focus {
      outline: none;
      border-color: var(--primary);
    }
    .file-content-editor {
      width: 100%;
      background: var(--bg2);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 8px 10px;
      color: var(--text-primary);
      font-family: monospace;
      font-size: 12px;
      resize: vertical;
      min-height: 80px;
      box-sizing: border-box;
    }
    .file-content-editor:focus {
      outline: none;
      border-color: var(--primary);
    }
    .advanced-section {
      margin-top: 16px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 8px 12px;
    }
    .advanced-summary {
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
    }
    .advanced-fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
    }
    .inline-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
  `,
})
export class SkillFormDialogComponent {
  readonly skill: ISkill | null = inject(MAT_DIALOG_DATA);
  readonly icons = ICON_OPTIONS;
  readonly colors = COLOR_OPTIONS;

  form = {
    name: this.skill?.name ?? "",
    description: this.skill?.description ?? "",
    system_prompt: this.skill?.system_prompt ?? "",
    icon: this.skill?.icon ?? "smart_toy",
    color: this.skill?.color ?? "#42a5f5",
    when_to_use: this.skill?.when_to_use ?? "",
    priority: this.skill?.priority ?? 0,
    mode: this.skill?.mode ?? "inline",
  };

  triggerCommandsText = (this.skill?.trigger_commands ?? []).join(", ");

  allowedToolsText = (this.skill?.allowed_tools ?? []).join(", ");

  readonly modeOptions = [
    { value: "inline", label: "Inline" },
    { value: "router", label: "Router" },
    { value: "llm_driven", label: "LLM Driven" },
  ];

  files: ISkillFile[] = this.skill?.files ? [...this.skill.files] : [];

  addFile(): void {
    this.files.push({ name: "", path: "", type: "reference", content: "" });
  }

  removeFile(index: number): void {
    this.files.splice(index, 1);
  }

  getFileIcon(type: string): string {
    switch (type) {
      case "script": return "terminal";
      case "reference": return "description";
      case "asset": return "attachment";
      default: return "insert_drive_file";
    }
  }

  getResult(): ISkillFormResult {
    return {
      ...this.form,
      trigger_commands: this.triggerCommandsText
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      allowed_tools: this.allowedToolsText
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      files: this.files.map((f) => ({
        ...f,
        path:
          f.type === "script"
            ? `scripts/${f.name}`
            : f.type === "reference"
              ? `references/${f.name}`
              : `assets/${f.name}`,
      })),
    };
  }
}
