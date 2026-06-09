import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import type {
  ISubagentDraft,
  VariableDeclaration,
  VariableType,
} from "../../../core/models/agent.model";
import type { IAdapterSummary } from "../../../core/services/adapters.service";
import type { IKnowledgeBase } from "../../../core/services/knowledge-bases.service";

@Component({
  selector: "app-ai-agent-config",
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
    MatSlideToggleModule,
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

          <div class="dual-field-row full-span">
            <mat-form-field appearance="outline">
              <mat-label>Temperature</mat-label>
              <input
                matInput
                type="number"
                [ngModel]="temperature()"
                (ngModelChange)="onTemperatureChange($event)"
                min="0"
                max="2"
                step="0.1"
                placeholder="0.7"
              />
              <mat-hint>LLM randomness (0-2). Leave empty for default.</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Max Tokens</mat-label>
              <input
                matInput
                type="number"
                [ngModel]="maxTokens()"
                (ngModelChange)="onMaxTokensChange($event)"
                min="1"
                max="1000000"
                step="1"
                placeholder="4096"
              />
              <mat-hint>Max output tokens. Leave empty for default.</mat-hint>
            </mat-form-field>
          </div>
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

    @if (section() === "variables") {
      <div class="section-card-body">
        <!-- Input Variables -->
        <div class="var-group">
          <div class="var-group-header">
            <span class="var-group-title">Input Variables</span>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              (click)="addInputVariable()"
            >
              <mat-icon>add</mat-icon> Add Input Variable
            </button>
          </div>

          @if (inputVariables().length === 0) {
            <div class="var-empty">No input variables defined.</div>
          }

          <div class="var-stack">
            @for (v of inputVariables(); track $index) {
              @if (editingInputIndex() === $index) {
                <div class="var-card var-card-editing">
                  <div class="var-form-grid">
                    <mat-form-field appearance="outline">
                      <mat-label>Name</mat-label>
                      <input matInput [(ngModel)]="editBuffer().name" placeholder="customerId" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Type</mat-label>
                      <mat-select [(ngModel)]="editBuffer().type">
                        @for (vt of variableTypes; track vt.value) {
                          <mat-option [value]="vt.value">{{ vt.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Label</mat-label>
                      <input matInput [(ngModel)]="editBuffer().label" placeholder="Customer ID" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Default Value</mat-label>
                      <input matInput [(ngModel)]="editBuffer().defaultValue" placeholder="(optional)" />
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="full-span">
                      <mat-label>Description</mat-label>
                      <input matInput [(ngModel)]="editBuffer().description" placeholder="What this variable represents" />
                    </mat-form-field>

                    <div class="var-form-actions full-span">
                      <mat-slide-toggle [(ngModel)]="editBuffer().required">
                        Required
                      </mat-slide-toggle>
                      <div class="var-form-btns">
                        <button class="btn btn-ghost btn-sm" type="button" (click)="cancelEditInput()">Cancel</button>
                        <button class="btn btn-primary btn-sm" type="button" (click)="saveEditInput($index)">Save</button>
                      </div>
                    </div>
                  </div>
                </div>
              } @else {
                <div class="var-card">
                  <div class="var-card-row">
                    <div class="var-card-info">
                      <strong class="var-name">{{ v.name || "Unnamed" }}</strong>
                      <span class="type-badge" [class]="'type-' + v.type">{{ v.type }}</span>
                      @if (v.required) {
                        <span class="required-badge">required</span>
                      }
                    </div>
                    <div class="var-card-actions">
                      <button class="icon-btn" type="button" aria-label="Edit variable" (click)="startEditInput($index)">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button class="icon-btn" type="button" aria-label="Delete variable" (click)="removeInputVariable($index)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </div>
                  @if (v.description) {
                    <div class="var-card-desc">{{ v.description }}</div>
                  }
                </div>
              }
            }
          </div>
        </div>

        <!-- Output Variables -->
        <div class="var-group">
          <div class="var-group-header">
            <span class="var-group-title">Output Variables</span>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              (click)="addOutputVariable()"
            >
              <mat-icon>add</mat-icon> Add Output Variable
            </button>
          </div>

          @if (outputVariables().length === 0) {
            <div class="var-empty">No output variables defined.</div>
          }

          <div class="var-stack">
            @for (v of outputVariables(); track $index) {
              @if (editingOutputIndex() === $index) {
                <div class="var-card var-card-editing">
                  <div class="var-form-grid">
                    <mat-form-field appearance="outline">
                      <mat-label>Name</mat-label>
                      <input matInput [(ngModel)]="editBuffer().name" placeholder="result" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Type</mat-label>
                      <mat-select [(ngModel)]="editBuffer().type">
                        @for (vt of variableTypes; track vt.value) {
                          <mat-option [value]="vt.value">{{ vt.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Label</mat-label>
                      <input matInput [(ngModel)]="editBuffer().label" placeholder="Result" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Default Value</mat-label>
                      <input matInput [(ngModel)]="editBuffer().defaultValue" placeholder="(optional)" />
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="full-span">
                      <mat-label>Description</mat-label>
                      <input matInput [(ngModel)]="editBuffer().description" placeholder="What this variable represents" />
                    </mat-form-field>

                    <div class="var-form-actions full-span">
                      <div></div>
                      <div class="var-form-btns">
                        <button class="btn btn-ghost btn-sm" type="button" (click)="cancelEditOutput()">Cancel</button>
                        <button class="btn btn-primary btn-sm" type="button" (click)="saveEditOutput($index)">Save</button>
                      </div>
                    </div>
                  </div>
                </div>
              } @else {
                <div class="var-card">
                  <div class="var-card-row">
                    <div class="var-card-info">
                      <strong class="var-name">{{ v.name || "Unnamed" }}</strong>
                      <span class="type-badge" [class]="'type-' + v.type">{{ v.type }}</span>
                    </div>
                    <div class="var-card-actions">
                      <button class="icon-btn" type="button" aria-label="Edit variable" (click)="startEditOutput($index)">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button class="icon-btn" type="button" aria-label="Delete variable" (click)="removeOutputVariable($index)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </div>
                  @if (v.description) {
                    <div class="var-card-desc">{{ v.description }}</div>
                  }
                </div>
              }
            }
          </div>
        </div>

        <div class="helper-copy">
          Define the input variables the agent expects and the output variables it produces.
          Input variables are passed by the caller; output variables are returned after execution.
        </div>
      </div>
    }

    @if (section() === "knowledgeBases") {
      <div class="section-card-body">
        <div class="flex items-center justify-between mb-16">
          <span class="text-muted text-sm">
            Select knowledge bases for this agent to search at runtime.
          </span>
        </div>

        @if (knowledgeBaseList().length === 0) {
          <div class="empty-state-sm">
            <p>No knowledge bases available. Create one first.</p>
          </div>
        } @else {
          <div class="kb-select-list">
            @for (kb of knowledgeBaseList(); track kb.id) {
              <label class="kb-checkbox-item">
                <input type="checkbox" [checked]="isKbSelected(kb.id)" (change)="toggleKb(kb.id)" />
                <div class="kb-info">
                  <strong>{{ kb.name }}</strong>
                  @if (kb.description) {
                    <span class="text-muted">{{ kb.description }}</span>
                  }
                </div>
              </label>
            }
          </div>
        }
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

    .dual-field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    /* Variable section styles */
    .var-group {
      margin-bottom: 24px;
    }

    .var-group:last-of-type {
      margin-bottom: 0;
    }

    .var-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .var-group-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .var-empty {
      padding: 12px 16px;
      font-size: 12.5px;
      color: var(--text3);
      font-style: italic;
      border: 1px dashed var(--border-subtle);
      border-radius: 8px;
      text-align: center;
    }

    .var-stack {
      display: grid;
      gap: 10px;
    }

    .var-card {
      padding: 12px 16px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .var-card-editing {
      border-color: var(--primary, #6366f1);
      background: rgba(99, 102, 241, 0.04);
    }

    .var-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .var-card-info {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .var-card-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .var-card-desc {
      font-size: 12px;
      color: var(--text3);
      padding-left: 2px;
    }

    .var-name {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .type-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 2px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .type-badge.type-string  { color: #60a5fa; background: rgba(96, 165, 250, 0.12); }
    .type-badge.type-number  { color: #4ade80; background: rgba(74, 222, 128, 0.12); }
    .type-badge.type-boolean { color: #c084fc; background: rgba(192, 132, 252, 0.12); }
    .type-badge.type-json    { color: #fb923c; background: rgba(251, 146, 60, 0.12); }
    .type-badge.type-array   { color: #2dd4bf; background: rgba(45, 212, 191, 0.12); }
    .type-badge.type-secret  { color: #f87171; background: rgba(248, 113, 113, 0.12); }

    .required-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.12);
      padding: 2px 7px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .var-form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .var-form-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .var-form-btns {
      display: flex;
      align-items: center;
      gap: 8px;
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

    /* Knowledge base section styles */
    .empty-state-sm {
      padding: 16px 20px;
      text-align: center;
      font-size: 13px;
      color: var(--text3);
      font-style: italic;
      border: 1px dashed var(--border-subtle);
      border-radius: 8px;
    }

    .kb-select-list {
      display: grid;
      gap: 8px;
    }

    .kb-checkbox-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
    }

    .kb-checkbox-item:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: var(--border-subtle);
    }

    .kb-checkbox-item input[type="checkbox"] {
      margin-top: 3px;
      accent-color: var(--primary, #6366f1);
    }

    .kb-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .kb-info strong {
      font-size: 13px;
      color: var(--text-primary);
    }

    .text-muted {
      font-size: 12px;
      color: var(--text3);
    }
  `,
})
export class AiAgentConfigComponent {
  readonly section = input.required<"general" | "skills" | "variables" | "knowledgeBases">();
  readonly llmConnectors = input.required<IAdapterSummary[]>();
  readonly editorOptions = input.required<Record<string, unknown>>();

  readonly agentName = model("");
  readonly description = model("");
  readonly provider = model("");
  readonly model = model("");
  readonly connectorId = model<string | null>(null);
  readonly temperature = model<number | null>(null);
  readonly maxTokens = model<number | null>(null);

  readonly subagents = model<ISubagentDraft[]>([]);

  readonly inputVariables = model<VariableDeclaration[]>([]);
  readonly outputVariables = model<VariableDeclaration[]>([]);

  readonly knowledgeBaseList = input<IKnowledgeBase[]>([]);
  readonly selectedKbIds = model<string[]>([]);

  readonly variableTypes: { value: VariableType; label: string }[] = [
    { value: "string", label: "String" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Boolean" },
    { value: "json", label: "JSON" },
    { value: "array", label: "Array" },
    { value: "secret", label: "Secret" },
  ];

  readonly editingInputIndex = signal<number | null>(null);
  readonly editingOutputIndex = signal<number | null>(null);
  readonly editBuffer = signal<VariableDeclaration>({
    name: "",
    type: "string",
    label: "",
    description: "",
    required: false,
    defaultValue: undefined,
  });

  readonly llmProviders = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "deepseek", label: "DeepSeek" },
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

  protected onTemperatureChange(value: number | null | string): void {
    if (value === "" || value === null || value === undefined) {
      this.temperature.set(null);
    } else {
      const num = Number(value);
      this.temperature.set(isNaN(num) ? null : num);
    }
  }

  protected onMaxTokensChange(value: number | null | string): void {
    if (value === "" || value === null || value === undefined) {
      this.maxTokens.set(null);
    } else {
      const num = Number(value);
      this.maxTokens.set(isNaN(num) ? null : num);
    }
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

  // ---------------------------------------------------------------------------
  // Input variable CRUD
  // ---------------------------------------------------------------------------

  addInputVariable(): void {
    const newVar: VariableDeclaration = {
      name: "",
      type: "string",
      label: "",
      description: "",
      required: true,
      defaultValue: undefined,
    };
    this.inputVariables.update((items) => [...items, newVar]);
    this.startEditInput(this.inputVariables().length - 1);
  }

  removeInputVariable(index: number): void {
    this.inputVariables.update((items) => items.filter((_, i) => i !== index));
    if (this.editingInputIndex() === index) {
      this.editingInputIndex.set(null);
    }
  }

  startEditInput(index: number): void {
    const v = this.inputVariables()[index];
    this.editBuffer.set({
      name: v.name,
      type: v.type,
      label: v.label ?? "",
      description: v.description ?? "",
      required: v.required ?? false,
      defaultValue: v.defaultValue,
    });
    this.editingInputIndex.set(index);
    this.editingOutputIndex.set(null);
  }

  cancelEditInput(): void {
    this.editingInputIndex.set(null);
  }

  saveEditInput(index: number): void {
    const buf = this.editBuffer();
    this.inputVariables.update((items) =>
      items.map((v, i) =>
        i === index
          ? {
              ...v,
              name: buf.name,
              type: buf.type,
              label: buf.label || undefined,
              description: buf.description || undefined,
              required: buf.required,
              defaultValue: buf.defaultValue,
            }
          : v,
      ),
    );
    this.editingInputIndex.set(null);
  }

  // ---------------------------------------------------------------------------
  // Output variable CRUD
  // ---------------------------------------------------------------------------

  addOutputVariable(): void {
    const newVar: VariableDeclaration = {
      name: "",
      type: "string",
      label: "",
      description: "",
      required: false,
      defaultValue: undefined,
    };
    this.outputVariables.update((items) => [...items, newVar]);
    this.startEditOutput(this.outputVariables().length - 1);
  }

  removeOutputVariable(index: number): void {
    this.outputVariables.update((items) => items.filter((_, i) => i !== index));
    if (this.editingOutputIndex() === index) {
      this.editingOutputIndex.set(null);
    }
  }

  startEditOutput(index: number): void {
    const v = this.outputVariables()[index];
    this.editBuffer.set({
      name: v.name,
      type: v.type,
      label: v.label ?? "",
      description: v.description ?? "",
      required: false,
      defaultValue: v.defaultValue,
    });
    this.editingOutputIndex.set(index);
    this.editingInputIndex.set(null);
  }

  cancelEditOutput(): void {
    this.editingOutputIndex.set(null);
  }

  saveEditOutput(index: number): void {
    const buf = this.editBuffer();
    this.outputVariables.update((items) =>
      items.map((v, i) =>
        i === index
          ? {
              ...v,
              name: buf.name,
              type: buf.type,
              label: buf.label || undefined,
              description: buf.description || undefined,
              required: undefined,
              defaultValue: buf.defaultValue,
            }
          : v,
      ),
    );
    this.editingOutputIndex.set(null);
  }

  // ---------------------------------------------------------------------------
  // Knowledge base selection
  // ---------------------------------------------------------------------------

  protected isKbSelected(id: string): boolean {
    return this.selectedKbIds().includes(id);
  }

  protected toggleKb(id: string): void {
    const current = this.selectedKbIds();
    if (current.includes(id)) {
      this.selectedKbIds.update(list => list.filter(k => k !== id));
    } else {
      this.selectedKbIds.update(list => [...list, id]);
    }
  }
}
