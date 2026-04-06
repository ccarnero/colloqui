import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import { TenantService } from "../../../core/services/tenant.service";
import { ThemeService } from "../../../core/services/theme.service";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import {
  type IAgentToolDraft,
  type IYoizenclawAgent,
  type IYoizenclawAgentDraft,
  type IYoizenclawCredentialProfile,
  type IYoizenclawSubagentConfig,
  type IYoizenclawSubagentDraft,
  type IYoizenclawTemplate,
} from "../../../core/models/yoizenclaw.model";
import { YoizenclawAgentConfigComponent } from "./agent-config.component";
import { YoizenclawChatPanelComponent } from "./chat-panel.component";
import { YoizenclawExistingAgentsPanelComponent } from "./existing-agents-panel.component";
import { YoizenclawToolConfigComponent } from "./tool-config.component";
import { YoizenclawTopBarComponent } from "./yoizenclaw-top-bar.component";
import {
  buildToolPayloadsFromDrafts,
  extractMentionsFromPrompt,
  parseToolPayload,
} from "./yoizenclaw.helpers";
import { registerYoizenclawMonacoHoverProvider } from "./yoizenclaw-monaco-hover";
import {
  DEFAULT_TEMPLATE_ID,
  type SkillInfo,
  type ToolInfo,
  cloneSubagents,
} from "./yoizenclaw.types";

@Component({
  selector: "app-yoizenclaw",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    YoizenclawAgentConfigComponent,
    YoizenclawChatPanelComponent,
    YoizenclawExistingAgentsPanelComponent,
    YoizenclawToolConfigComponent,
    YoizenclawTopBarComponent,
  ],
  styleUrl: "./yoizenclaw.component.scss",
  template: `
    <app-yoizenclaw-top-bar
      [editingAgentId]="editingAgentId()"
      [saving]="saving()"
      [loading]="loading()"
      [canSave]="isValid()"
      [errorMessage]="errorMessage()"
      [successMessage]="successMessage()"
      (cancelEdit)="cancelEdit()"
      (reset)="resetToTemplate()"
      (save)="saveAgent()"
    />

    <section class="info-banner">
      <div class="info-content">
        <div class="info-text">
          <span class="info-badge">YoizenClaw MVP</span>
          <h2 class="info-title">
            Compose a production-ready system prompt with skills.
          </h2>
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
              <strong class="metric-value">{{
                credentialProfiles().length
              }}</strong>
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
          <mat-tab label="General">
            <app-yoizenclaw-agent-config
              section="general"
              [credentialProfiles]="credentialProfiles()"
              [editorOptions]="editorOptions"
              [(agentName)]="agentName"
              [(description)]="description"
              [(provider)]="provider"
              [(model)]="model"
              [(credentialProfileId)]="credentialProfileId"
            />
          </mat-tab>

          <mat-tab label="Instructions">
            <app-yoizenclaw-chat-panel
              [editorOptions]="editorOptions"
              [availableSkills]="availableSkills()"
              [availableTools]="availableTools()"
              [extractedMentions]="extractedMentions()"
              [(systemPrompt)]="systemPrompt"
              [(rules)]="rules"
              [(soul)]="soul"
            />
          </mat-tab>

          <mat-tab label="Skills ({{ subagents.length }})">
            <app-yoizenclaw-agent-config
              section="skills"
              [credentialProfiles]="credentialProfiles()"
              [editorOptions]="editorOptions"
              [(subagents)]="subagents"
            />
          </mat-tab>

          <mat-tab label="Tools ({{ tools.length }})">
            <app-yoizenclaw-tool-config [(tools)]="tools" />
          </mat-tab>
        </mat-tab-group>
      </section>

      <app-yoizenclaw-existing-agents
        [agents]="agents()"
        [loading]="loading()"
        [editingAgentId]="editingAgentId()"
        [publishingId]="publishingId()"
        (edit)="loadAgentForEdit($event)"
        (publish)="publishAgent($event)"
        (unpublish)="unpublishAgent($event)"
      />
    </div>
  `,
})
export class YoizenclawComponent implements OnInit {
  private readonly yoizenclawAdminService = inject(YoizenclawAdminService);
  protected readonly tenant = inject(TenantService);
  protected readonly themeService = inject(ThemeService);

  readonly templates = signal<IYoizenclawTemplate[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly publishingId = signal<string | null>(null);
  readonly editingAgentId = signal<string | null>(null);
  readonly agents = signal<IYoizenclawAgent[]>([]);
  readonly credentialProfiles = signal<IYoizenclawCredentialProfile[]>([]);
  readonly errorMessage = signal("");
  readonly successMessage = signal("");

  readonly extractedMentions = computed(() => {
    return extractMentionsFromPrompt(this.systemPrompt);
  });

  readonly availableSkills = computed<SkillInfo[]>(() => {
    return this.subagents
      .filter((s) => s.name.trim().length > 0)
      .map((s) => ({
        id: s.name.toLowerCase().replace(/\s+/g, "-"),
        name: s.name,
        description: s.description || `Skill: ${s.name}`,
      }));
  });

  readonly availableTools = computed<ToolInfo[]>(() => {
    return this.tools
      .filter((t) => t.name.trim().length > 0)
      .map((t) => ({
        id: t.name.toLowerCase().replace(/\s+/g, "-"),
        name: t.name,
        description: t.description || `Tool: ${t.name}`,
      }));
  });

  editorOptions = {
    theme: "vs-dark",
    language: "yoizenclaw-prompt",
    minimap: { enabled: false },
    automaticLayout: true,
  };

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
    registerYoizenclawMonacoHoverProvider({
      getSkills: () => this.availableSkills(),
      getTools: () => this.availableTools(),
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
    const template = this.templates().find(
      (option: IYoizenclawTemplate) => option.id === templateId,
    );
    if (!template) {
      return;
    }

    this.selectedTemplateId = template.id;
    this.agentName = template.name;
    this.description = template.description;
    this.systemPrompt = template.system_prompt;
    this.rules = template.rules;
    this.soul = template.soul;
    this.subagents = cloneSubagents(
      template.subagents.map((s) => ({
        name: s.name,
        description: s.description,
        systemPrompt: s.system_prompt,
        enabled: s.enabled,
      })),
    );
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
      tools: buildToolPayloadsFromDrafts(this.tools),
    };

    this.errorMessage.set("");
    this.successMessage.set("");
    this.saving.set(true);

    const editingId = this.editingAgentId();

    if (editingId) {
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
        this.successMessage.set(
          `Agent "${agent.name}" unpublished successfully.`,
        );
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

    this.subagents = agent.model_config.subagents.map(
      (sub: IYoizenclawSubagentConfig) => ({
        name: sub.name,
        description: sub.description || "",
        systemPrompt: sub.system_prompt,
        enabled: sub.enabled ?? true,
      }),
    );

    this.tools = (agent.tools ?? []).map((raw: unknown) => parseToolPayload(raw));

    this.successMessage.set(`Editing agent: ${agent.name}`);
    this.errorMessage.set("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelEdit(): void {
    this.editingAgentId.set(null);
    this.resetToTemplate();
    this.successMessage.set("");
    this.errorMessage.set("");
  }

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set("");

    this.yoizenclawAdminService.listTemplates().subscribe({
      next: (response) => {
        this.templates.set(response.templates);
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
          console.log('[Yoizenclaw] Credential profiles loaded:', response.credentials);
          this.credentialProfiles.set(response.credentials);
        },
        error: (err) => {
          console.error('[Yoizenclaw] Failed to load credential profiles:', err);
          this.errorMessage.set(
            "Unable to load credential profiles for this tenant.",
          );
        },
      });
  }
}
