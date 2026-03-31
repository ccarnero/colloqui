import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import { TenantService } from "../../../core/services/tenant.service";
import { ThemeService } from "../../../core/services/theme.service";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import {
  YOIZENCLAW_AGENT_STATUSES,
  type IAgentToolDraft,
  type IAgentToolPayload,
  type IYoizenclawAgent,
  type IYoizenclawAgentDraft,
  type IYoizenclawCredentialProfile,
  type IYoizenclawSubagentConfig,
  type IYoizenclawSubagentDraft,
  type IYoizenclawTemplate,
  type ToolSourceType,
} from "../../../core/models/yoizenclaw.model";
import { ToolAdapterFormComponent } from "./tool-adapter-form.component";

// Skill and Tool interfaces with descriptions for tooltips
interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

const DEFAULT_TEMPLATE_ID = "sales-assistant";


function cloneSubagents(
  items: IYoizenclawSubagentDraft[],
): IYoizenclawSubagentDraft[] {
  return items.map((item) => ({ ...item }));
}

@Component({
  selector: "app-yoizenclaw",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule,
    MonacoEditorModule,
    ToolAdapterFormComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">YoizenClaw Agents</div>

      </div>
      <div class="ws-actions">
        @if (editingAgentId()) {
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            [disabled]="saving()"
            (click)="cancelEdit()"
          >
            <mat-icon>close</mat-icon>
            Cancel
          </button>
        }
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          [disabled]="saving()"
          (click)="editingAgentId() ? resetToTemplate() : resetToTemplate()"
        >
          <mat-icon>refresh</mat-icon>
          {{ editingAgentId() ? "Reset" : "Reset Template" }}
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          [disabled]="saving() || loading() || !isValid()"
          (click)="saveAgent()"
        >
          <mat-icon>{{ saving() ? "hourglass_top" : (editingAgentId() ? "update" : "save") }}</mat-icon>
          {{ saving() ? "Saving..." : (editingAgentId() ? "Update Agent" : "Create Agent") }}
        </button>
      </div>
    </div>

    @if (errorMessage()) {
      <div class="alert alert-error">
        <mat-icon>error_outline</mat-icon>
        <div>{{ errorMessage() }}</div>
      </div>
    }

    @if (successMessage()) {
      <div class="alert alert-success">
        <mat-icon>check_circle</mat-icon>
        <div>{{ successMessage() }}</div>
      </div>
    }

    <section class="info-banner">
      <div class="info-content">
        <div class="info-text">
          <span class="info-badge">YoizenClaw MVP</span>
          <h2 class="info-title">Compose a production-ready system prompt with skills.</h2>
        </div>
        
        <div class="info-actions">
          <mat-form-field appearance="outline" class="template-select-mini">
            <mat-label>Template</mat-label>
            <mat-select
              [(ngModel)]="selectedTemplateId"
              (ngModelChange)="applyTemplateById($event)"
            >
              @for (option of templates(); track option.id) {
                <mat-option [value]="option.id">
                  {{ option.label }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>

          <div class="info-metrics">
            <div class="metric-item">
              <span class="metric-label">Agents</span>
              <strong class="metric-value">{{ agents().length }}</strong>
            </div>
            <div class="metric-item">
              <span class="metric-label">Profiles</span>
              <strong class="metric-value">{{ credentialProfiles().length }}</strong>
            </div>
            <div class="metric-item">
              <span class="metric-label">Skills</span>
              <strong class="metric-value">{{ subagents.length }}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-grid">
      <section class="section-card editor-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">Agent Configuration</div>
            <div class="section-card-sub">
              Compose your AI agent settings, instructions, and sub-delegations.
            </div>
          </div>
          @if (loading()) {
            <mat-spinner diameter="24" />
          }
        </div>

        <mat-tab-group class="app-tabs">
          <!-- TAB 1: General Info -->
          <mat-tab label="General">
            <div class="section-card-body">
              <div class="editor-grid">
                <mat-form-field appearance="outline" class="full-span">
                  <mat-label>Agent Name</mat-label>
                  <input matInput [(ngModel)]="agentName" maxlength="255" placeholder="Sales Assistant Agent"/>
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-span">
                  <mat-label>Description</mat-label>
                  <input matInput [(ngModel)]="description" maxlength="255" placeholder="Short internal description for the team"/>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>LLM Provider</mat-label>
                  <mat-select [(ngModel)]="provider">
                    <mat-option value="openai">OpenAI</mat-option>
                    <mat-option value="azure-openai">Azure OpenAI</mat-option>
                    <mat-option value="anthropic">Anthropic</mat-option>
                  </mat-select>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>LLM Model</mat-label>
                  <input matInput [(ngModel)]="model" placeholder="gpt-5.4-nano"/>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Credential Profile</mat-label>
                  <mat-select [(ngModel)]="credentialProfileId">
                    <mat-option [value]="null">No credential profile</mat-option>
                    @for (profile of credentialProfiles(); track profile.id) {
                      <mat-option [value]="profile.id">{{ profile.name }} · {{ profile.type }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
              <div class="helper-copy">
                Pick a saved credential profile from settings. The service will receive it as <code>model_config.credential_profile_id</code>.
              </div>
            </div>
          </mat-tab>

          <!-- TAB 2: Instructions -->
          <mat-tab label="Instructions">
            <div class="section-card-body">
              <div class="editor-grid">
                <div class="full-span editor-container">
                  <label class="editor-label">System Prompt</label>
                  <div class="prompt-hint">
                    Use <code>@skill:name</code> to invoke skills and <code>@tool:name</code> to invoke tools from the prompt.
                  </div>
                  
                  <!-- Quick Insert Chips -->
                  <div class="quick-insert-section">
                    <span class="quick-insert-label">Quick insert:</span>
                    <div class="quick-insert-chips">
                      @for (skill of availableSkills(); track skill.id) {
                        <button 
                          mat-chip-option 
                          [matTooltip]="skill.description"
                          matTooltipPosition="above"
                          (click)="insertMention('@skill:' + skill.id)">
                          @skill:{{ skill.id }}
                        </button>
                      }
                      @for (tool of availableTools(); track tool.id) {
                        <button 
                          mat-chip-option 
                          [matTooltip]="tool.description"
                          matTooltipPosition="above"
                          (click)="insertMention('@tool:' + tool.id)">
                          @tool:{{ tool.id }}
                        </button>
                      }
                    </div>
                  </div>

                  <ngx-monaco-editor class="prompt-editor" [options]="editorOptions" [(ngModel)]="systemPrompt"></ngx-monaco-editor>
                  
                  @if (extractedMentions().length > 0) {
                    <div class="mentions-section">
                      <label class="mentions-label">Detected References:</label>
                      <div class="mentions-chips">
                        @for (mention of extractedMentions(); track mention) {
                          <mat-chip [color]="mention.startsWith('@skill') ? 'accent' : 'primary'" selected>
                            {{ mention }}
                          </mat-chip>
                        }
                      </div>
                    </div>
                  }
                </div>

                <div class="full-span editor-container">
                  <label class="editor-label">Rules</label>
                  <ngx-monaco-editor class="prompt-editor-sm" [options]="editorOptions" [(ngModel)]="rules"></ngx-monaco-editor>
                </div>

                <div class="full-span editor-container">
                  <label class="editor-label">Soul</label>
                  <ngx-monaco-editor class="prompt-editor-sm" [options]="editorOptions" [(ngModel)]="soul"></ngx-monaco-editor>
                </div>
              </div>
            </div>
          </mat-tab>

          <!-- TAB 3: Skills -->
          <mat-tab label="Skills ({{ subagents.length }})">
            <div class="section-card-body">
              <div class="flex items-center justify-between mb-16">
                <span class="text-muted text-sm">Delegate narrow responsibilities to focused skills.</span>
                <button class="btn btn-secondary btn-sm" type="button" (click)="addSubagent()">
                  <mat-icon>add</mat-icon> Add Skill
                </button>
              </div>

              <div class="subagent-stack">
                @for (subagent of subagents; track $index) {
                  <article class="subagent-card">
                    <div class="subagent-header">
                      <strong>{{ subagent.name || "New Skill" }}</strong>
                      <button class="icon-btn" type="button" aria-label="Remove skill" (click)="removeSubagent($index)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>

                    <div class="subagent-grid">
                      <mat-form-field appearance="outline">
                        <mat-label>Name</mat-label>
                        <input matInput [(ngModel)]="subagent.name" placeholder="Lead Qualifier"/>
                      </mat-form-field>

                      <mat-form-field appearance="outline">
                        <mat-label>Description</mat-label>
                        <input matInput [(ngModel)]="subagent.description" placeholder="When this subagent should be used"/>
                      </mat-form-field>

                      <div class="full-span editor-container">
                        <label class="editor-label">System Prompt</label>
                        <ngx-monaco-editor class="prompt-editor-sm" [options]="editorOptions" [(ngModel)]="subagent.systemPrompt"></ngx-monaco-editor>
                      </div>
                    </div>
                  </article>
                }
              </div>
            </div>
          </mat-tab>

          <!-- TAB 4: Tools -->
          <mat-tab label="Tools ({{ tools.length }})">
            <div class="section-card-body">
              <div class="flex items-center justify-between mb-16">
                <span class="text-muted text-sm">Connect external APIs and services to your agent.</span>
                <button class="btn btn-secondary btn-sm" type="button" (click)="addTool()">
                  <mat-icon>add</mat-icon> Add Tool
                </button>
              </div>

              @if (tools.length === 0) {
                <div class="empty-state">
                  <mat-icon>build</mat-icon>
                  <p>No tools configured yet.</p>
                  <p class="text-muted text-sm">Add an HTTP endpoint or connect a registered adapter.</p>
                </div>
              }

              <div class="subagent-stack">
                @for (tool of tools; track $index) {
                  <article class="subagent-card">
                    <div class="subagent-header">
                      <strong>{{ tool.name || "New Tool" }}</strong>
                      <button class="icon-btn" type="button" aria-label="Remove tool" (click)="removeTool($index)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>

                    <div class="subagent-grid">
                      <mat-form-field appearance="outline">
                        <mat-label>Tool Name</mat-label>
                        <input matInput [(ngModel)]="tool.name" placeholder="get-weather"/>
                      </mat-form-field>

                      <mat-form-field appearance="outline">
                        <mat-label>Description</mat-label>
                        <input matInput [(ngModel)]="tool.description" placeholder="What this tool does"/>
                      </mat-form-field>

                      <div class="full-span">
                        <div class="source-toggle">
                          <button
                            type="button"
                            class="toggle-btn"
                            [class.active]="tool.sourceType === 'http'"
                            (click)="tool.sourceType = 'http'"
                          >
                            <mat-icon>language</mat-icon> HTTP Endpoint
                          </button>
                          <button
                            type="button"
                            class="toggle-btn"
                            [class.active]="tool.sourceType === 'adapter'"
                            (click)="tool.sourceType = 'adapter'"
                          >
                            <mat-icon>power</mat-icon> Adapter
                          </button>
                        </div>
                      </div>

                      @if (tool.sourceType === "http") {
                        <mat-form-field appearance="outline">
                          <mat-label>Endpoint URL</mat-label>
                          <input matInput [(ngModel)]="tool.endpointUrl" placeholder="https://api.example.com/v1/resource"/>
                        </mat-form-field>

                        <mat-form-field appearance="outline">
                          <mat-label>Method</mat-label>
                          <mat-select [(ngModel)]="tool.endpointMethod">
                            <mat-option value="GET">GET</mat-option>
                            <mat-option value="POST">POST</mat-option>
                            <mat-option value="PUT">PUT</mat-option>
                            <mat-option value="PATCH">PATCH</mat-option>
                            <mat-option value="DELETE">DELETE</mat-option>
                          </mat-select>
                        </mat-form-field>
                      }

                      @if (tool.sourceType === "adapter") {
                        <div class="full-span">
                          <app-tool-adapter-form
                            [initialAdapterRef]="tool.adapterRef"
                            [initialAdapterName]="tool.name"
                            (adapterRefChange)="onToolAdapterRefChange($index, $event)"
                          />
                        </div>
                      }
                    </div>
                  </article>
                }
              </div>
            </div>
          </mat-tab>
        </mat-tab-group>
      </section>

      <aside class="stack-column">
        <section class="section-card">
          <div class="section-card-header">
            <div>
              <div class="section-card-title">Existing Agents</div>
              <div class="section-card-sub">
                Drafts already stored in the tenant.
              </div>
            </div>
          </div>

          <div class="section-card-body list-body">
            @if (!agents().length && !loading()) {
              <div class="empty-state">
                <mat-icon>smart_toy</mat-icon>
                <p>No agents yet. Create the first YoizenClaw agent now.</p>
              </div>
            }

            @for (agent of agents(); track agent.id || $index) {
              <article class="agent-item" [class.editing]="editingAgentId() === agent.id">
                <div class="agent-item-top">
                  <div class="agent-info" (click)="loadAgentForEdit(agent)">
                    <strong class="agent-name">{{ agent.name }}</strong>
                    <div class="agent-meta">
                      {{ formatProvider(agent) }} ·
                      {{ agent.model_config.model || "No model" }}
                    </div>
                  </div>
                  <span [class]="statusClass(agent.status)">
                    {{ agent.status }}
                  </span>
                </div>

                <p class="agent-description">
                  {{ agent.description || "No description provided." }}
                </p>

                <div class="agent-footer">
                  <span>
                    {{ agent.model_config.subagents.length }} skills
                  </span>
                  <span>
                    {{ agent.created_at | date: "mediumDate" }}
                  </span>
                </div>

                <div class="agent-actions">
                  @if (agent.status === "draft") {
                    <button
                      mat-button
                      class="action-btn publish-btn"
                      (click)="publishAgent(agent.id)"
                      [disabled]="publishingId() === agent.id"
                    >
                      @if (publishingId() === agent.id) {
                        <mat-spinner diameter="14"></mat-spinner>
                      } @else {
                        <mat-icon>rocket_launch</mat-icon>
                      }
                      Publish
                    </button>
                  }
                  
                  @if (agent.status === "published") {
                    <button
                      mat-button
                      class="action-btn unpublish-btn"
                      (click)="unpublishAgent(agent.id)"
                      [disabled]="publishingId() === agent.id"
                    >
                      @if (publishingId() === agent.id) {
                        <mat-spinner diameter="14"></mat-spinner>
                      } @else {
                        <mat-icon>pause_circle</mat-icon>
                      }
                      Unpublish
                    </button>
                  }
                  
                  <button
                    mat-button
                    class="action-btn edit-btn"
                    (click)="loadAgentForEdit(agent)"
                  >
                    <mat-icon>edit_note</mat-icon>
                    Edit
                  </button>
                </div>
              </article>
            }
          </div>
        </section>
      </aside>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    code {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      color: var(--text-primary);
      background: var(--bg3);
      border: 1px solid var(--border-subtle);
      padding: 1px 6px;
      border-radius: 999px;
    }

    .info-banner {
      padding: 16px 24px;
      margin-bottom: 24px;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      background: var(--bg2);
      position: relative;
      overflow: hidden;
    }

    .info-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 24px;
    }

    .info-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-badge {
      display: inline-flex;
      font-size: 10px;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .info-actions {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .template-select-mini {
      width: 200px;
    }

    ::ng-deep .template-select-mini .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .info-metrics {
      display: flex;
      gap: 16px;
      padding-left: 20px;
      border-left: 1px solid var(--border-subtle);
    }

    .metric-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .metric-label {
      font-size: 10px;
      color: var(--text3);
      text-transform: uppercase;
      font-weight: 600;
    }

    .metric-value {
      font-size: 20px;
      color: var(--text-primary);
      line-height: 1;
      margin-top: 2px;
    }

    .workspace-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.8fr);
      gap: 20px;
      align-items: start;
    }

    .editor-card,
    .stack-column {
      min-width: 0;
    }

    .stack-column {
      display: grid;
      gap: 20px;
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

    .subagent-stack,
    .list-body {
      display: grid;
      gap: 14px;
    }

    .subagent-card,
    .agent-item {
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      transition: all 0.2s ease;
    }

    .agent-item:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .agent-item.editing {
      border-color: var(--primary);
      background: var(--accent-dim);
      box-shadow: 0 0 0 2px var(--primary);
    }

    .agent-info {
      cursor: pointer;
      flex: 1;
    }

    .agent-name {
      cursor: pointer;
      transition: color 0.2s ease;
    }

    .agent-name:hover {
      color: var(--primary);
    }

    .subagent-header,
    .agent-item-top,
    .agent-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .subagent-card {
      display: grid;
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

    .badge {
      text-transform: capitalize;
    }

    .agent-meta,
    .agent-description,
    .agent-footer {
      color: var(--text3);
      font-size: 12px;
    }

    .agent-description {
      margin: 10px 0 12px;
      line-height: 1.5;
    }

    .agent-actions {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      gap: 8px;
      justify-content: flex-start;
    }

    .action-btn {
      height: 32px;
      padding: 0 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      border: none;
      cursor: pointer;
    }

    .action-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .action-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .publish-btn {
      background: rgba(0, 188, 212, 0.15);
      color: #00bcd4;
    }

    .publish-btn:hover:not(:disabled) {
      background: rgba(0, 188, 212, 0.25);
    }

    .unpublish-btn {
      background: rgba(244, 67, 54, 0.15);
      color: #f44336;
    }

    .unpublish-btn:hover:not(:disabled) {
      background: rgba(244, 67, 54, 0.25);
    }

    .edit-btn {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text2);
    }

    .edit-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      color: var(--text);
    }

    .agent-actions mat-spinner {
      display: inline-block;
    }

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: rgba(255, 255, 255, 0.4);
      border: 2px dashed rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.005);
      transition: all 0.2s ease;
    }
    .empty-state:hover {
      border-style: dotted;
      border-color: rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.015);
    }

    .empty-state p {
      margin: 0;
    }

    .empty-state mat-icon {
      margin-bottom: 12px;
      font-size: 32px;
      height: 32px;
      width: 32px;
      opacity: 0.7;
    }

    .source-toggle {
      display: flex;
      gap: 6px;
      margin-bottom: 4px;
    }

    .toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--text3);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .toggle-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .toggle-btn:hover {
      border-color: var(--border2);
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.03);
    }

    .toggle-btn.active {
      border-color: var(--primary);
      color: var(--primary);
      background: var(--accent-dim);
    }

    .badge-draft {
      background: var(--accent-dim);
      color: var(--text-accent);
    }

    .badge-published {
      background: var(--green-dim);
      color: var(--green);
    }

    .badge-archived {
      background: var(--bg4);
      color: var(--text3);
    }

    .app-tabs {
      flex: 1;
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

    /* Style the mat-tab header explicitly to match admin-console dark theme if needed */
    ::ng-deep .mat-mdc-tab-header {
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg2);
    }
    ::ng-deep .mat-mdc-tab-labels {
      display: flex;
    }
    ::ng-deep .mdc-tab__text-label {
      color: var(--text-secondary);
      font-weight: 600;
    }
    ::ng-deep .mdc-tab--active .mdc-tab__text-label {
      color: var(--text-primary);
    }

    @media (max-width: 1180px) {
      .workspace-grid,
      .hero-card {
        grid-template-columns: 1fr;
      }

      .editor-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 720px) {
      .editor-grid,
      .hero-metrics {
        grid-template-columns: 1fr;
      }

      .ws-actions {
        width: 100%;
        justify-content: stretch;
      }

      .ws-actions .btn {
        flex: 1 1 0%;
        justify-content: center;
      }
    }
  `,
})
export class YoizenclawComponent implements OnInit {
  private readonly yoizenclawAdminService = inject(YoizenclawAdminService);
  protected readonly tenant = inject(TenantService);
  protected readonly themeService = inject(ThemeService);

  // Templates loaded from backend
  readonly templates = signal<IYoizenclawTemplate[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly publishingId = signal<string | null>(null);
  readonly editingAgentId = signal<string | null>(null);
  readonly agents = signal<IYoizenclawAgent[]>([]);
  readonly credentialProfiles = signal<IYoizenclawCredentialProfile[]>([]);
  readonly errorMessage = signal("");
  readonly successMessage = signal("");

  // Extract @skill: and @tool: mentions from system prompt
  readonly extractedMentions = computed(() => {
    return this.extractMentions(this.systemPrompt);
  });

  // Available skills from current agent configuration with descriptions
  readonly availableSkills = computed<SkillInfo[]>(() => {
    return this.subagents
      .filter(s => s.name.trim().length > 0)
      .map(s => ({
        id: s.name.toLowerCase().replace(/\s+/g, '-'),
        name: s.name,
        description: s.description || `Skill: ${s.name}`,
      }));
  });

  // Available tools - currently none implemented
  readonly availableTools = computed<ToolInfo[]>(() => {
    return this.tools
      .filter(t => t.name.trim().length > 0)
      .map(t => ({
        id: t.name.toLowerCase().replace(/\s+/g, '-'),
        name: t.name,
        description: t.description || `Tool: ${t.name}`,
      }));
  });

  editorOptions = {theme: 'vs-dark', language: 'yoizenclaw-prompt', minimap: { enabled: false }, automaticLayout: true};

  selectedTemplateId = DEFAULT_TEMPLATE_ID;
  agentName = "New Agent";
  description = "";
  systemPrompt = "You are a helpful AI assistant.";
  rules = "Be helpful and professional.";
  soul = "Friendly and knowledgeable.";
  provider = "openai";
  model = "gpt-5.4-nano";
  credentialProfileId: string | null = null;
  subagents: IYoizenclawSubagentDraft[] = [];
  tools: IAgentToolDraft[] = [];

  constructor() {
    // Register hover provider for @skill: and @tool: mentions once Monaco is loaded
    this.registerMonacoHoverProvider();
  }
  
  private registerMonacoHoverProvider(): void {
    const checkMonaco = () => {
      const w = window as unknown as { monaco?: typeof import('monaco-editor') };
      if (w.monaco) {
        // Register hover provider for yoizenclaw-prompt language
        w.monaco.languages.registerHoverProvider('yoizenclaw-prompt', {
          provideHover: (model, position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const wordAtPos = model.getWordAtPosition(position);
            
            if (!wordAtPos) return null;
            
            // Check the word and preceding character for @mentions
            const startColumn = wordAtPos.startColumn;
            const word = wordAtPos.word;
            
            // Get the character before the word
            const charBefore = startColumn > 1 ? lineContent[startColumn - 2] : '';
            
            // Check for @skill:name or @tool:name patterns
            if (charBefore === '@') {
              if (word.startsWith('skill:')) {
                const id = word.substring(6);
                const skill = this.availableSkills().find(s => s.id === id);
                return {
                  contents: [
                    { value: `**@skill:${id}**` },
                    { value: skill?.description || `Skill: ${id}` },
                  ],
                };
              } else if (word.startsWith('tool:')) {
                const id = word.substring(5);
                const tool = this.availableTools().find(t => t.id === id);
                return {
                  contents: [
                    { value: `**@tool:${id}**` },
                    { value: tool?.description || `Tool: ${id}` },
                  ],
                };
              }
            }
            
            return null;
          },
        });
      } else {
        setTimeout(checkMonaco, 100);
      }
    };
    
    setTimeout(checkMonaco, 500);
  }

  ngOnInit(): void {
    this.loadData();
  }

  isValid(): boolean {
    return (
      this.agentName.trim().length > 0 &&
      this.systemPrompt.trim().length > 0 &&
      this.rules.trim().length > 0 &&
      this.soul.trim().length > 0 &&
      this.provider.trim().length > 0 &&
      this.model.trim().length > 0 &&
      this.subagents.every(
        (subagent) =>
          subagent.name.trim().length > 0 &&
          subagent.systemPrompt.trim().length > 0,
      )
    );
  }

  applyTemplateById(templateId: string): void {
    const template = this.templates().find((option: IYoizenclawTemplate) => option.id === templateId);
    if (!template) {
      return;
    }

    this.selectedTemplateId = template.id;
    this.agentName = template.name;
    this.description = template.description;
    this.systemPrompt = template.system_prompt;
    this.rules = template.rules;
    this.soul = template.soul;
    this.subagents = cloneSubagents(template.subagents.map(s => ({
      name: s.name,
      description: s.description,
      systemPrompt: s.system_prompt,
      enabled: s.enabled,
    })));
    this.successMessage.set("");
    this.errorMessage.set("");
  }

  resetToTemplate(): void {
    this.applyTemplateById(this.selectedTemplateId);
    this.provider = "openai";
    this.model = "gpt-5.4-nano";
    this.credentialProfileId = null;
    this.tools = [];
  }

  addSubagent(): void {
    this.subagents = [
      ...this.subagents,
      {
        name: "",
        description: "",
        systemPrompt: "",
        enabled: true,
      },
    ];
  }

  removeSubagent(index: number): void {
    this.subagents = this.subagents.filter((_, i) => i !== index);
  }

  addTool(): void {
    this.tools = [
      ...this.tools,
      {
        name: "",
        description: "",
        sourceType: "http",
        endpointUrl: "",
        endpointMethod: "GET",
        adapterRef: null,
      },
    ];
  }

  removeTool(index: number): void {
    this.tools = this.tools.filter((_, i) => i !== index);
  }

  onToolAdapterRefChange(index: number, ref: { adapterId: string; endpointId: string } | null): void {
    this.tools = this.tools.map((t, i) =>
      i === index ? { ...t, adapterRef: ref } : t,
    );
  }

  insertMention(mention: string): void {
    // Insert at cursor position or append to end
    if (this.systemPrompt.length > 0 && !this.systemPrompt.endsWith(' ')) {
      this.systemPrompt += ' ';
    }
    this.systemPrompt += mention + ' ';
  }

  saveAgent(): void {
    if (!this.isValid()) {
      this.errorMessage.set(
        this.editingAgentId() 
          ? "Complete the required fields before updating the agent."
          : "Complete the required fields before creating the agent.",
      );
      return;
    }

    const draft: IYoizenclawAgentDraft = {
      name: this.agentName,
      description: this.description,
      systemPrompt: this.systemPrompt,
      provider: this.provider,
      model: this.model,
      credentialProfileId: this.credentialProfileId,
      rules: this.rules,
      soul: this.soul,
      subagents: this.subagents,
      tools: this.buildToolPayloads(),
    };

    this.errorMessage.set("");
    this.successMessage.set("");
    this.saving.set(true);

    const editingId = this.editingAgentId();
    
    if (editingId) {
      // Update existing agent
      this.yoizenclawAdminService.updateAgent(editingId, draft).subscribe({
        next: (agent) => {
          this.agents.update((agents) =>
            agents.map((a) => (a.id === agent.id ? agent : a)),
          );
          this.successMessage.set(`Agent "${agent.name}" updated successfully.`);
          this.saving.set(false);
          this.editingAgentId.set(null);
        },
        error: (error: { error?: { message?: string | string[] } }) => {
          const message = error.error?.message;
          this.errorMessage.set(
            Array.isArray(message)
              ? message.join(", ")
              : message ?? "The agent could not be updated.",
          );
          this.saving.set(false);
        },
      });
    } else {
      // Create new agent
      this.yoizenclawAdminService.createAgent(draft).subscribe({
        next: (agent) => {
          this.agents.set([agent, ...this.agents()]);
          this.successMessage.set(`Agent "${agent.name}" created successfully.`);
          this.saving.set(false);
        },
        error: (error: { error?: { message?: string | string[] } }) => {
          const message = error.error?.message;
          this.errorMessage.set(
            Array.isArray(message)
              ? message.join(", ")
              : message ?? "The agent could not be created.",
          );
          this.saving.set(false);
        },
      });
    }
  }

  publishAgent(agentId: string): void {
    this.publishingId.set(agentId);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.yoizenclawAdminService.publishAgent(agentId).subscribe({
      next: (agent) => {
        // Update the agent in the list
        this.agents.update((agents) =>
          agents.map((a) => (a.id === agent.id ? agent : a)),
        );
        this.successMessage.set(`Agent "${agent.name}" published successfully.`);
        this.publishingId.set(null);
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        const message = error.error?.message;
        this.errorMessage.set(
          Array.isArray(message)
            ? message.join(", ")
            : message ?? "Failed to publish agent.",
        );
        this.publishingId.set(null);
      },
    });
  }

  unpublishAgent(agentId: string): void {
    this.publishingId.set(agentId);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.yoizenclawAdminService.unpublishAgent(agentId).subscribe({
      next: (agent) => {
        this.agents.update((agents) =>
          agents.map((a) => (a.id === agent.id ? agent : a)),
        );
        this.successMessage.set(`Agent "${agent.name}" unpublished successfully.`);
        this.publishingId.set(null);
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        const message = error.error?.message;
        this.errorMessage.set(
          Array.isArray(message)
            ? message.join(", ")
            : message ?? "Failed to unpublish agent.",
        );
        this.publishingId.set(null);
      },
    });
  }

  loadAgentForEdit(agent: IYoizenclawAgent): void {
    this.editingAgentId.set(agent.id);
    this.agentName = agent.name;
    this.description = agent.description || "";
    this.systemPrompt = agent.system_prompt;
    this.provider = agent.model_config.provider;
    this.model = agent.model_config.model;
    this.credentialProfileId = agent.model_config.credential_profile_id;
    this.rules = agent.model_config.rules;
    this.soul = agent.model_config.soul;
    
    // Convert subagents from backend format to frontend format
    this.subagents = agent.model_config.subagents.map((sub: IYoizenclawSubagentConfig) => ({
      name: sub.name,
      description: sub.description || "",
      systemPrompt: sub.system_prompt,
      enabled: sub.enabled ?? true,
    }));

    // Restore tools from backend
    this.tools = (agent.tools ?? []).map((raw: unknown) => this.parseToolPayload(raw));

    this.successMessage.set(`Editing agent: ${agent.name}`);
    this.errorMessage.set("");
    
    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelEdit(): void {
    this.editingAgentId.set(null);
    this.resetToTemplate();
    this.successMessage.set("");
    this.errorMessage.set("");
  }

  formatProvider(agent: IYoizenclawAgent): string {
    const provider = agent.model_config.provider?.trim();
    return provider ? provider : "No provider";
  }

  extractMentions(text: string): string[] {
    const mentionRegex = /@(skill|tool):([a-zA-Z0-9_-]+)/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(`@${match[1]}:${match[2]}`);
    }
    
    return [...new Set(mentions)]; // Remove duplicates
  }

  statusClass(status: IYoizenclawAgent["status"]): string {
    switch (status) {
      case YOIZENCLAW_AGENT_STATUSES.PUBLISHED:
        return "badge badge-published";
      case YOIZENCLAW_AGENT_STATUSES.ARCHIVED:
        return "badge badge-archived";
      default:
        return "badge badge-draft";
    }
  }

  buildToolPayloads(): IAgentToolPayload[] {
    return this.tools
      .filter((t) => t.name.trim().length > 0)
      .map((t) => {
        const payload: IAgentToolPayload = {
          name: t.name.trim(),
          source_type: t.sourceType,
          ...(t.description ? { description: t.description.trim() } : {}),
        };

        if (t.sourceType === "http" && t.endpointUrl.trim()) {
          payload.endpoint = {
            url: t.endpointUrl.trim(),
            method: t.endpointMethod,
          };
        }

        if (t.sourceType === "adapter" && t.adapterRef) {
          payload.adapter_ref = {
            adapter_id: t.adapterRef.adapterId,
            endpoint_id: t.adapterRef.endpointId,
          };
        }

        return payload;
      });
  }

  private parseToolPayload(raw: unknown): IAgentToolDraft {
    const t = raw as Record<string, unknown>;
    const sourceType = (t["source_type"] as ToolSourceType) ?? "http";
    const adapterRef = t["adapter_ref"] as { adapter_id: string; endpoint_id: string } | undefined;
    const endpoint = t["endpoint"] as { url: string; method: string } | undefined;

    return {
      name: (t["name"] as string) ?? "",
      description: t["description"] as string | undefined,
      sourceType,
      endpointUrl: endpoint?.url ?? "",
      endpointMethod: endpoint?.method ?? "GET",
      adapterRef: adapterRef
        ? { adapterId: adapterRef.adapter_id, endpointId: adapterRef.endpoint_id }
        : null,
    };
  }

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set("");

    // Load templates first
    this.yoizenclawAdminService.listTemplates().subscribe({
      next: (response) => {
        this.templates.set(response.templates);
        // Apply first template by default if available and not editing
        if (response.templates.length > 0 && !this.editingAgentId()) {
          this.applyTemplateById(response.templates[0].id);
        }
      },
      error: () => {
        this.errorMessage.set("Unable to load agent templates.");
      },
    });

    this.yoizenclawAdminService.listAgents({ limit: 12, offset: 0 }).subscribe({
      next: (response) => {
        this.agents.set(response.agents);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set("Unable to load existing YoizenClaw agents.");
        this.loading.set(false);
      },
    });

    this.yoizenclawAdminService
      .listCredentialProfiles({ is_active: true, limit: 50, offset: 0 })
      .subscribe({
        next: (response) => {
          this.credentialProfiles.set(response.credentials);
        },
        error: () => {
          this.errorMessage.set(
            "Unable to load credential profiles for this tenant.",
          );
        },
      });
  }
}
