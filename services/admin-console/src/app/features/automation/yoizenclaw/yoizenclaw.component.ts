import { DatePipe } from "@angular/common";
import { Component, effect, inject, signal, type OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import { TenantService } from "../../../core/services/tenant.service";
import { ThemeService } from "../../../core/services/theme.service";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import {
  YOIZENCLAW_AGENT_STATUSES,
  type IYoizenclawAgent,
  type IYoizenclawAgentDraft,
  type IYoizenclawCredentialProfile,
  type IYoizenclawSubagentDraft,
} from "../../../core/models/yoizenclaw.model";

interface AgentTemplateOption {
  id: string;
  label: string;
  name: string;
  description: string;
  systemPrompt: string;
  rules: string;
  soul: string;
  subagents: IYoizenclawSubagentDraft[];
}

const DEFAULT_TEMPLATE_ID = "sales-assistant";

const TEMPLATE_OPTIONS: AgentTemplateOption[] = [
  {
    id: DEFAULT_TEMPLATE_ID,
    label: "Sales Assistant",
    name: "Sales Assistant Agent",
    description: "Qualifies inbound leads and prepares handoffs to sales.",
    systemPrompt: `You are a Sales Assistant for Yoizen, a platform that helps companies automate conversations with AI agents across WhatsApp, Telegram, Slack, and web chat.

Your mission is to turn inbound inquiries into qualified opportunities and booked demos.

Ask concise questions, qualify the customer need, summarize the context, and drive the conversation toward a clear next step.

If information is missing, say so clearly and ask a follow-up instead of guessing.`,
    rules: `Always qualify the customer's need before recommending a product.
Ask about use case, team size, budget range, and timeline.
Never fabricate pricing, feature availability, or delivery dates.
If the request is outside the sales scope, hand off with a short summary.`,
    soul: `Warm, knowledgeable, and consultative like a top-performing sales rep.
Mirror the customer's energy: brief when they are brief, detailed when they ask questions.
Be proactive, friendly, and respectful.`,
    subagents: [
      {
        name: "Lead Qualifier",
        description: "Extracts budget, timeline, team size, and use case.",
        systemPrompt:
          "Qualify the lead. Extract business need, budget, timeline, decision-makers, and urgency.",
        enabled: true,
      },
      {
        name: "Handoff Writer",
        description: "Builds a clean summary for the human team.",
        systemPrompt:
          "Write a crisp CRM-ready summary with risks, objections, and next best action.",
        enabled: true,
      },
    ],
  },
];

function cloneSubagents(
  items: IYoizenclawSubagentDraft[],
): IYoizenclawSubagentDraft[] {
  return items.map((item) => ({ ...item }));
}

@Component({
  selector: "app-yoizenclaw",
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    MonacoEditorModule,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">YoizenClaw Agents</div>
        <div class="ws-subtitle">
          Create the first MVP agent for {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          [disabled]="saving()"
          (click)="resetToTemplate()"
        >
          <mat-icon>refresh</mat-icon>
          Reset Template
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          [disabled]="saving() || loading() || !isValid()"
          (click)="saveAgent()"
        >
          <mat-icon>{{ saving() ? "hourglass_top" : "save" }}</mat-icon>
          {{ saving() ? "Saving..." : "Create Agent" }}
        </button>
      </div>
    </div>

    @if (errorMessage()) {
      <div class="alert alert-warn">
        <mat-icon>warning</mat-icon>
        <div>{{ errorMessage() }}</div>
      </div>
    }

    @if (successMessage()) {
      <div class="alert alert-success">
        <mat-icon>check_circle</mat-icon>
        <div>{{ successMessage() }}</div>
      </div>
    }

    <section class="hero-card">
      <div class="hero-copy">
        <span class="hero-kicker">YoizenClaw MVP</span>
        <h2>Compose a production-ready system prompt with subagents.</h2>
        <p>
          This first version stores the visual fields in
          <code>model_config</code> and sends the canonical
          <code>system_prompt</code> to
          <code>yoizenclaw-admin-service</code>.
        </p>
      </div>

      <div class="hero-actions">
        <mat-form-field appearance="outline" class="template-field">
          <mat-label>Template</mat-label>
          <mat-select
            [(ngModel)]="selectedTemplateId"
            (ngModelChange)="applyTemplateById($event)"
          >
            @for (option of templates; track option.id) {
              <mat-option [value]="option.id">
                {{ option.label }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="hero-metrics">
          <div class="metric-chip">
            <span>Agents</span>
            <strong>{{ agents().length }}</strong>
          </div>
          <div class="metric-chip">
            <span>Profiles</span>
            <strong>{{ credentialProfiles().length }}</strong>
          </div>
          <div class="metric-chip">
            <span>Subagents</span>
            <strong>{{ subagents.length }}</strong>
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
                <mat-form-field appearance="outline" class="full-span monaco-field">
                  <mat-label>System Prompt</mat-label>
                  <ngx-monaco-editor class="prompt-editor" [options]="editorOptions" [(ngModel)]="systemPrompt"></ngx-monaco-editor>
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-span monaco-field">
                  <mat-label>Rules</mat-label>
                  <ngx-monaco-editor class="prompt-editor-sm" [options]="editorOptions" [(ngModel)]="rules"></ngx-monaco-editor>
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-span monaco-field">
                  <mat-label>Soul</mat-label>
                  <ngx-monaco-editor class="prompt-editor-sm" [options]="editorOptions" [(ngModel)]="soul"></ngx-monaco-editor>
                </mat-form-field>
              </div>
            </div>
          </mat-tab>

          <!-- TAB 3: Subagents -->
          <mat-tab label="Subagents ({{ subagents.length }})">
            <div class="section-card-body">
              <div class="flex items-center justify-between mb-16">
                <span class="text-muted text-sm">Delegate narrow responsibilities to focused subagents.</span>
                <button class="btn btn-secondary btn-sm" type="button" (click)="addSubagent()">
                  <mat-icon>add</mat-icon> Add
                </button>
              </div>

              <div class="subagent-stack">
                @for (subagent of subagents; track $index) {
                  <article class="subagent-card">
                    <div class="subagent-header">
                      <strong>{{ subagent.name || "New Subagent" }}</strong>
                      <button class="icon-btn" type="button" aria-label="Remove subagent" (click)="removeSubagent($index)">
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

                      <mat-form-field appearance="outline" class="full-span monaco-field">
                        <mat-label>System Prompt</mat-label>
                        <ngx-monaco-editor class="prompt-editor-sm" [options]="editorOptions" [(ngModel)]="subagent.systemPrompt"></ngx-monaco-editor>
                      </mat-form-field>
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

            @for (agent of agents(); track agent.id) {
              <article class="agent-item">
                <div class="agent-item-top">
                  <div>
                    <strong>{{ agent.name }}</strong>
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
                    {{ agent.model_config.subagents.length }} subagents
                  </span>
                  <span>
                    {{ agent.created_at | date: "mediumDate" }}
                  </span>
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

    .hero-card {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
      gap: 20px;
      padding: 24px;
      margin-bottom: 20px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius3);
      background:
        radial-gradient(circle at top right, rgba(74, 58, 191, 0.12), transparent 45%),
        radial-gradient(circle at bottom left, rgba(253, 100, 33, 0.08), transparent 35%),
        var(--bg2);
      box-shadow: var(--shadow2);
    }

    .hero-kicker {
      display: inline-flex;
      margin-bottom: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--accent-dim);
      color: var(--text-accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }

    h2 {
      font-size: 28px;
      line-height: 1.1;
      margin-bottom: 10px;
    }

    .hero-copy p {
      max-width: 62ch;
      color: var(--text2);
      font-size: 14px;
    }

    .hero-actions {
      display: flex;
      flex-direction: column;
      gap: 16px;
      justify-content: space-between;
    }

    .template-field {
      width: 100%;
    }

    .hero-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .metric-chip {
      padding: 14px;
      border-radius: var(--radius2);
      border: 1px solid var(--border-subtle);
      background: var(--bg);
    }

    .metric-chip span {
      display: block;
      color: var(--text3);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .metric-chip strong {
      display: block;
      margin-top: 8px;
      font-size: 28px;
      color: var(--text-primary);
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
      padding: 14px;
      border-radius: var(--radius2);
      border: 1px solid var(--border-subtle);
      background: rgba(255, 255, 255, 0.02);
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

    .empty-state {
      padding: 20px;
      text-align: center;
      color: var(--text3);
      border: 1px dashed var(--border-subtle);
      border-radius: var(--radius2);
    }

    .empty-state mat-icon {
      margin-bottom: 8px;
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

    .monaco-field ::ng-deep .mat-mdc-text-field-wrapper {
      padding: 0;
    }

    .prompt-editor {
      height: 300px;
      margin-top: 10px;
      margin-bottom: 10px;
    }

    .prompt-editor-sm {
      height: 150px;
      margin-top: 10px;
      margin-bottom: 10px;
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

  readonly templates = TEMPLATE_OPTIONS;
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly agents = signal<IYoizenclawAgent[]>([]);
  readonly credentialProfiles = signal<IYoizenclawCredentialProfile[]>([]);
  readonly errorMessage = signal("");
  readonly successMessage = signal("");

  editorOptions = {theme: 'vs-dark', language: 'markdown', minimap: { enabled: false }, automaticLayout: true};

  selectedTemplateId = DEFAULT_TEMPLATE_ID;
  agentName = TEMPLATE_OPTIONS[0].name;
  description = TEMPLATE_OPTIONS[0].description;
  systemPrompt = TEMPLATE_OPTIONS[0].systemPrompt;
  rules = TEMPLATE_OPTIONS[0].rules;
  soul = TEMPLATE_OPTIONS[0].soul;
  provider = "openai";
  model = "gpt-5.4-nano";
  credentialProfileId: string | null = null;
  subagents = cloneSubagents(TEMPLATE_OPTIONS[0].subagents);

  constructor() {
    effect(() => {
      this.editorOptions = {
        ...this.editorOptions,
        theme: this.themeService.isDark() ? "vs-dark" : "vs-light",
      };
    });
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
    const template = this.templates.find((option) => option.id === templateId);
    if (!template) {
      return;
    }

    this.selectedTemplateId = template.id;
    this.agentName = template.name;
    this.description = template.description;
    this.systemPrompt = template.systemPrompt;
    this.rules = template.rules;
    this.soul = template.soul;
    this.subagents = cloneSubagents(template.subagents);
    this.successMessage.set("");
    this.errorMessage.set("");
  }

  resetToTemplate(): void {
    this.applyTemplateById(this.selectedTemplateId);
    this.provider = "openai";
    this.model = "gpt-5.4-nano";
    this.credentialProfileId = null;
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
    this.subagents = this.subagents.filter(
      (_, itemIndex) => itemIndex !== index,
    );
  }

  saveAgent(): void {
    if (!this.isValid()) {
      this.errorMessage.set(
        "Complete the required fields before creating the agent.",
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
    };

    this.errorMessage.set("");
    this.successMessage.set("");
    this.saving.set(true);

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

  formatProvider(agent: IYoizenclawAgent): string {
    const provider = agent.model_config.provider?.trim();
    return provider ? provider : "No provider";
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

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set("");

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
