import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import type { IYoizenclawSubagentDraft } from "../../../core/models/yoizenclaw.model";
import type { IAdapterSummary } from "../../../core/services/adapters.service";

@Component({
  selector: "app-yoizenclaw-agent-config",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MonacoEditorModule,
  ],
  template: `
    @if (section() === "general") {
      <div class="section-card-body">
        <div class="editor-grid">
          <mat-form-field appearance="outline" class="full-span">
            <mat-label>Agent Name</mat-label>
            <input
              matInput
              [ngModel]="agentName()"
              (ngModelChange)="onAgentNameChange($event)"
              maxlength="255"
              placeholder="Sales Assistant Agent"
            />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-span">
            <mat-label>Description</mat-label>
            <input
              matInput
              [ngModel]="description()"
              (ngModelChange)="onDescriptionChange($event)"
              maxlength="255"
              placeholder="Short internal description for the team"
            />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>LLM Connector</mat-label>
            <mat-select
              [ngModel]="connectorId()"
              (ngModelChange)="onConnectorIdChange($event)"
            >
              <mat-option [value]="null">No connector</mat-option>
              @for (c of llmConnectors(); track c.id) {
                <mat-option [value]="c.id">
                  {{ c.name }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>LLM Provider</mat-label>
            <mat-select
              [ngModel]="provider()"
              (ngModelChange)="onProviderChange($event)"
            >
              @for (p of llmProviders; track p.value) {
                <mat-option [value]="p.value">
                  {{ p.label }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>

          @if (selectedConnector()) {
            <div class="connector-info full-span">
              <span class="connector-badge">
                {{ selectedConnector()!.name | uppercase }}
              </span>
              <span class="connector-url" [title]="selectedConnector()!.baseUrl">
                {{ selectedConnector()!.baseUrl }}
              </span>
            </div>
          }

          <mat-form-field appearance="outline">
            <mat-label>LLM Model</mat-label>
            <input
              matInput
              [ngModel]="model()"
              (ngModelChange)="onModelChange($event)"
              placeholder="gpt-5.4-nano"
            />
          </mat-form-field>
        </div>
        <div class="helper-copy">
          Pick an LLM connector from the adapter registry. The service will
          receive it as <code>model_config.llm.connectorId</code>.
        </div>
      </div>
    }

    @if (section() === "skills") {
      <div class="section-card-body">
        <div class="flex items-center justify-between mb-16">
          <span class="text-muted text-sm">
            Delegate narrow responsibilities to focused skills.
          </span>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            (click)="addSubagent()"
          >
            <mat-icon>add</mat-icon> Add Skill
          </button>
        </div>

        <div class="subagent-stack">
          @for (subagent of subagents(); track $index) {
            <article class="subagent-card">
              <div class="subagent-header">
                <strong>{{ subagent.name || "New Skill" }}</strong>
                <button
                  class="icon-btn"
                  type="button"
                  aria-label="Remove skill"
                  (click)="removeSubagent($index)"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>

              <div class="subagent-grid">
                <mat-form-field appearance="outline">
                  <mat-label>Name</mat-label>
                  <input
                    matInput
                    [(ngModel)]="subagent.name"
                    placeholder="Lead Qualifier"
                  />
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Description</mat-label>
                  <input
                    matInput
                    [(ngModel)]="subagent.description"
                    placeholder="When this subagent should be used"
                  />
                </mat-form-field>

                <div class="full-span editor-container">
                  <label class="editor-label">System Prompt</label>
                  <ngx-monaco-editor
                    class="prompt-editor-sm"
                    [options]="editorOptions()"
                    [(ngModel)]="subagent.systemPrompt"
                  />
                </div>
              </div>
            </article>
          }
        </div>
      </div>
    }
  `,
  styles: `
    code {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      color: var(--text-primary);
      background: var(--bg3);
      border: 1px solid var(--border-subtle);
      padding: 1px 6px;
      border-radius: 999px;
    }

    .editor-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .subagent-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .full-span {
      grid-column: 1 / -1;
    }

    .helper-copy {
      margin-top: 16px;
      color: var(--text3);
      font-size: 12px;
    }

    .connector-info {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: rgba(255, 255, 255, 0.02);
      font-size: 13px;
      color: var(--text3);
      min-width: 0;
      margin-top: -4px;
      margin-bottom: 8px;
    }

    .connector-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--text3);
      flex-shrink: 0;
    }

    .connector-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--bg3);
      border: 1px solid var(--border-subtle);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--text-primary);
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }

    .connector-url {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      opacity: 0.8;
    }

    .section-divider {
      position: relative;
      display: flex;
      align-items: center;
      padding: 16px 0 8px;
    }

    .divider-text {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text3);
      padding-right: 16px;
      background: var(--bg2);
      z-index: 1;
    }

    .divider-line {
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--border-subtle);
      z-index: 0;
    }

    .subagent-stack {
      display: grid;
      gap: 14px;
    }

    .subagent-card {
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      transition: all 0.2s ease;
      display: grid;
      gap: 12px;
    }

    .subagent-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
    }

    .icon-btn:hover {
      color: var(--text-primary);
      border-color: var(--border2);
      background: rgba(255, 255, 255, 0.03);
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

    .prompt-editor-sm {
      display: block;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius2);
      overflow: hidden;
      height: 150px;
    }

    .mb-16 {
      margin-bottom: 16px;
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
export class YoizenclawAgentConfigComponent {
  readonly section = input.required<"general" | "skills">();
  readonly llmConnectors = input.required<IAdapterSummary[]>();
  readonly editorOptions = input.required<Record<string, unknown>>();

  readonly agentName = model("");
  readonly description = model("");
  readonly provider = model("");
  readonly model = model("");
  readonly connectorId = model<string | null>(null);

  readonly subagents = model<IYoizenclawSubagentDraft[]>([]);

  readonly llmProviders = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "google", label: "Google AI" },
    { value: "groq", label: "Groq" },
    { value: "mistral", label: "Mistral AI" },
    { value: "ollama", label: "Ollama" },
    { value: "lmstudio", label: "LM Studio" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "xai", label: "xAI" },
  ];

  readonly selectedConnector = computed(() => {
    const id = this.connectorId();
    if (!id) return null;
    return this.llmConnectors().find((c) => c.id === id) ?? null;
  });

  protected onAgentNameChange(value: string): void {
    this.agentName.set(value);
  }

  protected onDescriptionChange(value: string): void {
    this.description.set(value);
  }

  protected onConnectorIdChange(value: string | null): void {
    this.connectorId.set(value);
  }

  protected onProviderChange(value: string): void {
    this.provider.set(value);
  }

  protected onModelChange(value: string): void {
    this.model.set(value);
  }

  addSubagent(): void {
    this.subagents.update((items) => [
      ...items,
      {
        name: "",
        description: "",
        systemPrompt: "",
        enabled: true,
      },
    ]);
  }

  removeSubagent(index: number): void {
    this.subagents.update((items) => items.filter((_, i) => i !== index));
  }
}
