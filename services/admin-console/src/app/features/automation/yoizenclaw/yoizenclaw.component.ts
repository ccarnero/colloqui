import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  type OnInit,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import { AgentEditorBridgeService } from "./agent-editor-bridge.service";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import { YoizenclawRuntimeService } from "../../../core/services/yoizenclaw-runtime.service";
import {
  AdaptersService,
  type IAdapterSummary,
} from "../../../core/services/adapters.service";
import {
  type IAgentToolDraft,
  type IYoizenclawAgent,
  type IYoizenclawAgentDraft,
  type IYoizenclawSubagentDraft,
  type IYoizenclawTemplate,
  getAgentLlmConfig,
} from "../../../core/models/yoizenclaw.model";
import { YoizenclawAgentConfigComponent } from "./agent-config.component";
import {
  type IAgentRuntimeHealth,
  YoizenclawExistingAgentsPanelComponent,
} from "./existing-agents-panel.component";
import { YoizenclawAgentEditorNavComponent } from "./agent-editor-nav.component";
import { YoizenclawAgentEditorSkillFormComponent } from "./agent-editor-skill-form.component";
import { YoizenclawAgentEditorToolFormComponent } from "./agent-editor-tool-form.component";
import { YoizenclawTopBarComponent } from "./yoizenclaw-top-bar.component";
import {
  buildToolPayloadsFromDrafts,
  extractMentionsFromPrompt,
  formatHttpErrorMessage,
  mapSubagentConfigToDraft,
  parseToolPayload,
} from "./yoizenclaw.helpers";
import { registerYoizenclawMonacoHoverProvider } from "./yoizenclaw-monaco-hover";
import {
  DEFAULT_TEMPLATE_ID,
  type ISkillInfo,
  type IToolInfo,
  cloneSubagents,
} from "./yoizenclaw.types";
import {
  type IAgentEditorSelection,
  SELECTION_INSTRUCTION_PROMPT,
  selectSkill,
  selectTool,
} from "./agent-editor.types";
import {
  areDraftsEqual,
  clearAgentDraft,
  loadAgentDraft,
  saveAgentDraft,
} from "./agent-draft.helpers";
import { firstValueFrom, type Observable } from "rxjs";

const AUTOSAVE_INTERVAL_MS = 800;

@Component({
  selector: "app-yoizenclaw",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MonacoEditorModule,
    YoizenclawAgentConfigComponent,
    YoizenclawExistingAgentsPanelComponent,
    YoizenclawAgentEditorNavComponent,
    YoizenclawAgentEditorSkillFormComponent,
    YoizenclawAgentEditorToolFormComponent,
    YoizenclawTopBarComponent,
  ],
  styleUrl: "./yoizenclaw.component.scss",
  template: `
    @if (viewMode() === 'list') {
      <div class="ws-header">
        <div>
          <div class="ws-title">Agents</div>
        </div>
        <div class="ws-actions">
          <button class="btn btn-secondary btn-sm" type="button" (click)="refresh()">
            <mat-icon>sync</mat-icon>
            Sync from Seed
          </button>
          <button class="btn btn-primary btn-sm" type="button" (click)="createNewAgent()">
            <mat-icon>add</mat-icon>
            New Agent
          </button>
        </div>
      </div>

      <div class="workspace-grid single-column">
        <app-yoizenclaw-existing-agents
          class="full-width-panel"
          [agents]="agents()"
          [loading]="loading()"
          [editingAgentId]="editingAgentId()"
          [publishingId]="publishingId()"
          [deletingId]="deletingId()"
          [runtimeHealth]="runtimeHealth()"
          (edit)="loadAgentForEdit($event)"
          (publish)="publishAgent($event)"
          (unpublish)="unpublishAgent($event)"
          (delete)="deleteAgent($event)"
          (checkRuntime)="checkRuntimeSync($event)"
        />
      </div>
    } @else {
      <app-yoizenclaw-top-bar
        [editingAgentId]="editingAgentId()"
        [saving]="saving()"
        [loading]="loading()"
        [canSave]="isValid()"
        [errorMessage]="errorMessage()"
        [successMessage]="successMessage()"
        [isDirty]="isDirty()"
        (save)="saveAgent()"
        (reset)="resetToTemplate()"
        (cancelEdit)="cancelEdit()"
      />

      @if (draftRestored()) {
        <div class="alert alert-info draft-banner">
          <mat-icon>history</mat-icon>
          <div>
            Restored your unsaved changes from {{ draftRestored() | date: 'short' }}.
            <button type="button" class="link-btn" (click)="discardDraft()">
              Discard and reload saved version
            </button>
          </div>
        </div>
      }

      <div class="ide-layout" [class.collapsed]="paletteCollapsed()">
        <aside class="ide-nav">
          <app-yoizenclaw-editor-nav
            [selection]="selection()"
            [skills]="subagents"
            [tools]="tools"
            [templates]="templates()"
            [selectedTemplateId]="selectedTemplateId"
            [collapsed]="paletteCollapsed()"
            (select)="setSelection($event)"
            (addSkill)="addSubagentAndFocus()"
            (addTool)="addToolAndFocus()"
            (removeSkill)="removeSubagent($event)"
            (removeTool)="removeTool($event)"
            (applyTemplate)="applyTemplateById($event)"
            (toggleCollapsed)="togglePaletteCollapsed()"
          />
        </aside>

        <main class="ide-center">
          <section class="section-card editor-card">
            @if (loading()) {
              <div class="loading-overlay">
                <mat-spinner diameter="24" />
              </div>
            }

            @switch (selection().kind) {
              @case ('general') {
                <div class="section-card-header">
                  <div>
                    <div class="section-card-title">General</div>
                    <div class="section-card-sub">
                      Name, description, and the LLM connector for this agent.
                    </div>
                  </div>
                </div>
                <app-yoizenclaw-agent-config
                  section="general"
                  [llmConnectors]="llmConnectors()"
                  [editorOptions]="editorOptions"
                  [(agentName)]="agentName"
                  [(description)]="description"
                  [(provider)]="provider"
                  [(model)]="model"
                  [(connectorId)]="connectorId"
                />
              }

              @case ('instruction-prompt') {
                <div class="section-card-header">
                  <div>
                    <div class="section-card-title">System Prompt</div>
                    <div class="section-card-sub">
                      The agent's core instructions. Use
                      <code>&#64;skill:name</code> and
                      <code>&#64;tool:name</code> to reference skills and tools.
                    </div>
                  </div>
                </div>
                <div class="focus-pad">
                  <ngx-monaco-editor
                    class="prompt-editor-tall"
                    [options]="editorOptions"
                    [(ngModel)]="systemPrompt"
                  />
                </div>
              }

              @case ('instruction-rules') {
                <div class="section-card-header">
                  <div>
                    <div class="section-card-title">Rules</div>
                    <div class="section-card-sub">
                      Hard constraints and policies the agent must follow.
                    </div>
                  </div>
                </div>
                <div class="focus-pad">
                  <ngx-monaco-editor
                    class="prompt-editor-tall"
                    [options]="editorOptions"
                    [(ngModel)]="rules"
                  />
                </div>
              }

              @case ('instruction-soul') {
                <div class="section-card-header">
                  <div>
                    <div class="section-card-title">Soul</div>
                    <div class="section-card-sub">
                      Personality, voice, and tone &mdash; how the agent feels
                      to talk to.
                    </div>
                  </div>
                </div>
                <div class="focus-pad">
                  <ngx-monaco-editor
                    class="prompt-editor-tall"
                    [options]="editorOptions"
                    [(ngModel)]="soul"
                  />
                </div>
              }

              @case ('instruction-mentions') {
                <div class="section-card-header">
                  <div>
                    <div class="section-card-title">Detected References</div>
                    <div class="section-card-sub">
                      Skills and tools your prompt references, plus quick-insert
                      chips for everything available.
                    </div>
                  </div>
                </div>
                <div class="focus-pad mentions-view">
                  @if (extractedMentions().length > 0) {
                    <div class="mentions-block">
                      <label class="mentions-label">In your prompt</label>
                      <div class="mentions-chips">
                        @for (mention of extractedMentions(); track mention) {
                          <span
                            class="mention-chip"
                            [class.skill]="mention.startsWith('@skill')"
                            [class.tool]="mention.startsWith('@tool')"
                          >
                            {{ mention }}
                          </span>
                        }
                      </div>
                    </div>
                  } @else {
                    <div class="mentions-empty">
                      Your prompt doesn't reference any skill or tool yet. Use
                      <code>&#64;skill:name</code> or
                      <code>&#64;tool:name</code> in the System Prompt to wire
                      them in.
                    </div>
                  }

                  @if (availableSkills().length > 0) {
                    <div class="mentions-block">
                      <label class="mentions-label">Available skills</label>
                      <div class="mentions-chips">
                        @for (skill of availableSkills(); track skill.id) {
                          <span class="mention-chip ghost">
                            &#64;skill:{{ skill.id }}
                          </span>
                        }
                      </div>
                    </div>
                  }

                  @if (availableTools().length > 0) {
                    <div class="mentions-block">
                      <label class="mentions-label">Available tools</label>
                      <div class="mentions-chips">
                        @for (tool of availableTools(); track tool.id) {
                          <span class="mention-chip ghost">
                            &#64;tool:{{ tool.id }}
                          </span>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              @case ('skill') {
                @if (focusedSkill(); as skill) {
                  <app-yoizenclaw-editor-skill-form
                    [skill]="skill"
                    [editorOptions]="editorOptions"
                    (skillChange)="onSkillFormChange(focusedIndex(), $event)"
                    (remove)="removeSubagent(focusedIndex())"
                  />
                } @else {
                  <div class="empty-focus">Select a skill from the left panel.</div>
                }
              }

              @case ('tool') {
                @if (focusedTool(); as tool) {
                  <app-yoizenclaw-editor-tool-form
                    [tool]="tool"
                    (toolChange)="onToolFormChange(focusedIndex(), $event)"
                    (remove)="removeTool(focusedIndex())"
                  />
                } @else {
                  <div class="empty-focus">Select a tool from the left panel.</div>
                }
              }
            }
          </section>
        </main>
      </div>
    }
  `,
})
export class YoizenclawComponent implements OnInit {
  private readonly yoizenclawAdminService = inject(YoizenclawAdminService);
  private readonly yoizenclawRuntimeService = inject(YoizenclawRuntimeService);
  private readonly adaptersService = inject(AdaptersService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly bridge = inject(AgentEditorBridgeService, { optional: true });

  readonly navigationMode = input<"inline" | "route">("inline");
  readonly defaultMode = input<"list" | "editor">("list");
  readonly forcedAgentId = input<string | null>(null);

  readonly templates = signal<IYoizenclawTemplate[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly viewMode = signal<"list" | "editor">("list");
  readonly publishingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly runtimeHealth = signal<Record<string, IAgentRuntimeHealth>>({});
  readonly editingAgentId = signal<string | null>(null);
  readonly agents = signal<IYoizenclawAgent[]>([]);
  readonly llmConnectors = signal<IAdapterSummary[]>([]);
  readonly errorMessage = signal("");
  readonly successMessage = signal("");

  // ---- Editor selection ----
  readonly selection = signal<IAgentEditorSelection>(SELECTION_INSTRUCTION_PROMPT);
  readonly paletteCollapsed = signal(false);

  // ---- Draft persistence ----
  readonly isDirty = signal(false);
  readonly draftRestored = signal<number | null>(null);
  private baseline: IYoizenclawAgentDraft | null = null;

  // ---- Reactivity helpers (bumped on structural mutations) ----
  private readonly version = signal(0);

  readonly focusedIndex = computed(() => {
    const sel = this.selection();
    if (sel.kind === "skill" || sel.kind === "tool") return sel.index;
    return -1;
  });

  readonly focusedSkill = computed(() => {
    this.version();
    const sel = this.selection();
    if (sel.kind !== "skill") return null;
    return this.subagents[sel.index] ?? null;
  });

  readonly focusedTool = computed(() => {
    this.version();
    const sel = this.selection();
    if (sel.kind !== "tool") return null;
    return this.tools[sel.index] ?? null;
  });

  readonly extractedMentions = computed(() => {
    this.version();
    return extractMentionsFromPrompt(this.systemPrompt);
  });

  readonly availableSkills = computed<ISkillInfo[]>(() => {
    this.version();
    return this.subagents
      .filter((s) => s.name.trim().length > 0)
      .map((s) => ({
        id: s.name.toLowerCase().replace(/\s+/g, "-"),
        name: s.name,
        description: s.description || `Skill: ${s.name}`,
      }));
  });

  readonly availableTools = computed<IToolInfo[]>(() => {
    this.version();
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
  connectorId: string | null = null;
  subagents: IYoizenclawSubagentDraft[] = [];
  tools: IAgentToolDraft[] = [];

  constructor() {
    registerYoizenclawMonacoHoverProvider({
      getSkills: () => this.availableSkills(),
      getTools: () => this.availableTools(),
    });

    const intervalHandle = setInterval(
      () => this.runDraftAutosave(),
      AUTOSAVE_INTERVAL_MS,
    );
    this.destroyRef.onDestroy(() => {
      clearInterval(intervalHandle);
      this.bridge?.unregisterHandlers();
      console.debug("[yoizenclaw] autosave + bridge torn down");
    });

    // Push state changes to the parent detail header via the bridge.
    if (this.bridge) {
      const bridge = this.bridge;
      effect(() => {
        bridge.editingAgentId.set(
          this.viewMode() === "editor" ? this.editingAgentId() : null,
        );
        bridge.saving.set(this.saving());
        bridge.loading.set(this.loading());
        bridge.canSave.set(this.isValid());
        bridge.isDirty.set(this.isDirty());
      });
    }
  }

  ngOnInit(): void {
    this.viewMode.set(this.defaultMode());
    this.loadData();

    // Register parent-action handlers so detail-header buttons can drive us.
    this.bridge?.registerHandlers({
      onSave: () => this.saveAgent(),
      onReset: () => this.resetToTemplate(),
      onCancel: () => this.cancelEdit(),
    });
  }

  refresh(): void {
    this.loadData();
  }

  createNewAgent(): void {
    if (this.navigationMode() === "route") {
      void this.router.navigate(["/yoizenclaw/agents/new"]);
      return;
    }
    this.createNewAgentInline();
  }

  private createNewAgentInline(): void {
    this.editingAgentId.set(null);
    this.resetToTemplate();
    this.viewMode.set("editor");
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
    if (!template) return;

    this.selectedTemplateId = template.id;
    this.agentName = template.name;
    this.description = template.description;
    this.systemPrompt = template.system_prompt;
    this.rules = template.rules;
    this.soul = template.soul;
    this.subagents = cloneSubagents(
      template.subagents.map(mapSubagentConfigToDraft),
    );
    this.successMessage.set("");
    this.errorMessage.set("");
    this.bumpVersion();
  }

  resetToTemplate(): void {
    this.applyTemplateById(this.selectedTemplateId);
    this.provider = "openai";
    this.model = "gpt-5.4-nano";
    this.connectorId = null;
    this.tools = [];
    this.discardDraft();
  }

  // -----------------------------------------------------------------
  // Editor selection + skill/tool mutations
  // -----------------------------------------------------------------

  setSelection(next: IAgentEditorSelection): void {
    this.selection.set(next);
  }

  togglePaletteCollapsed(): void {
    this.paletteCollapsed.update((v) => !v);
  }

  addSubagent(): void {
    this.subagents = [
      ...this.subagents,
      { name: "", description: "", systemPrompt: "", enabled: true },
    ];
    this.bumpVersion();
  }

  addSubagentAndFocus(): void {
    this.addSubagent();
    this.selection.set(selectSkill(this.subagents.length - 1));
  }

  removeSubagent(index: number): void {
    if (index < 0 || index >= this.subagents.length) return;
    this.subagents = this.subagents.filter((_, i) => i !== index);
    this.bumpVersion();
    this.shiftSelectionAfterRemove("skill", index, this.subagents.length);
  }

  onSkillFormChange(index: number, next: IYoizenclawSubagentDraft): void {
    if (index < 0 || index >= this.subagents.length) return;
    this.subagents = this.subagents.map((current, i) =>
      i === index ? next : current,
    );
    this.bumpVersion();
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
    this.bumpVersion();
  }

  addToolAndFocus(): void {
    this.addTool();
    this.selection.set(selectTool(this.tools.length - 1));
  }

  removeTool(index: number): void {
    if (index < 0 || index >= this.tools.length) return;
    this.tools = this.tools.filter((_, i) => i !== index);
    this.bumpVersion();
    this.shiftSelectionAfterRemove("tool", index, this.tools.length);
  }

  onToolFormChange(index: number, next: IAgentToolDraft): void {
    if (index < 0 || index >= this.tools.length) return;
    this.tools = this.tools.map((current, i) => (i === index ? next : current));
    this.bumpVersion();
  }

  private shiftSelectionAfterRemove(
    kind: "skill" | "tool",
    removedIndex: number,
    newLength: number,
  ): void {
    const sel = this.selection();
    if (sel.kind !== kind) return;

    if (newLength === 0) {
      this.selection.set(SELECTION_INSTRUCTION_PROMPT);
      return;
    }

    if (sel.index === removedIndex) {
      const nextIndex = Math.min(sel.index, newLength - 1);
      this.selection.set(
        kind === "skill" ? selectSkill(nextIndex) : selectTool(nextIndex),
      );
      return;
    }

    if (sel.index > removedIndex) {
      this.selection.set(
        kind === "skill"
          ? selectSkill(sel.index - 1)
          : selectTool(sel.index - 1),
      );
    }
  }

  private bumpVersion(): void {
    this.version.update((v) => v + 1);
  }

  // -----------------------------------------------------------------
  // Save / publish / load
  // -----------------------------------------------------------------

  saveAgent(): void {
    if (!this.isValid()) {
      this.notifyError(
        this.editingAgentId()
          ? "Complete the required fields before updating the agent."
          : "Complete the required fields before creating the agent.",
      );
      return;
    }

    const draft = this.buildCurrentDraft();

    this.errorMessage.set("");
    this.successMessage.set("");
    this.saving.set(true);

    const editingId = this.editingAgentId();

    if (editingId) {
      this.yoizenclawAdminService.updateAgent(editingId, draft).subscribe({
        next: (agent) => this.handleSaveSuccess(agent, "updated"),
        error: (error: { error?: { message?: string | string[] } }) => {
          this.notifyError(
            formatHttpErrorMessage(
              error.error?.message,
              "The agent could not be updated.",
            ),
          );
          this.saving.set(false);
        },
      });
      return;
    }

    this.yoizenclawAdminService.createAgent(draft).subscribe({
      next: (agent) => {
        this.agents.set([agent, ...this.agents()]);
        this.handleSaveSuccess(agent, "created");

        if (
          this.navigationMode() === "route" &&
          this.defaultMode() === "editor"
        ) {
          void this.router.navigate([
            "/yoizenclaw/agents",
            agent.id,
            "overview",
          ]);
        }
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(
            error.error?.message,
            "The agent could not be created.",
          ),
        );
        this.saving.set(false);
      },
    });
  }

  private handleSaveSuccess(
    agent: IYoizenclawAgent,
    verb: "created" | "updated",
  ): void {
    if (verb === "updated") {
      this.agents.update((agents) =>
        agents.map((a) => (a.id === agent.id ? agent : a)),
      );
    }

    const message = `Agent "${agent.name}" ${verb} successfully.`;
    this.successMessage.set(message);
    this.snackBar.open(message, undefined, { duration: 3000 });
    this.saving.set(false);
    this.applyAgentToForm(agent, false);
    this.bridge?.notifySavedAgent({ id: agent.id, name: agent.name });
  }

  private notifyError(message: string): void {
    this.errorMessage.set(message);
    this.snackBar.open(message, "Dismiss", { duration: 5000 });
  }

  publishAgent(agentId: string): void {
    this.runAgentPublishToggle(
      agentId,
      () => this.yoizenclawAdminService.publishAgent(agentId),
      "published",
      "Failed to publish agent.",
    );
  }

  unpublishAgent(agentId: string): void {
    this.runAgentPublishToggle(
      agentId,
      () => this.yoizenclawAdminService.unpublishAgent(agentId),
      "unpublished",
      "Failed to unpublish agent.",
    );
  }

  private runAgentPublishToggle(
    agentId: string,
    request: () => Observable<IYoizenclawAgent>,
    successVerb: "published" | "unpublished",
    failMessage: string,
  ): void {
    this.publishingId.set(agentId);
    this.errorMessage.set("");
    this.successMessage.set("");
    request().subscribe({
      next: (agent) => {
        this.agents.update((agents) =>
          agents.map((a) => (a.id === agent.id ? agent : a)),
        );
        const message = `Agent "${agent.name}" ${successVerb} successfully.`;
        this.successMessage.set(message);
        this.snackBar.open(message, undefined, { duration: 3000 });
        this.publishingId.set(null);
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(error.error?.message, failMessage),
        );
        this.publishingId.set(null);
      },
    });
  }

  loadAgentForEdit(agent: IYoizenclawAgent): void {
    if (this.navigationMode() === "route") {
      void this.router.navigate(["/yoizenclaw/agents", agent.id, "overview"]);
      return;
    }
    this.applyAgentToForm(agent);
  }

  deleteAgent(agentId: string): void {
    const target = this.agents().find((agent) => agent.id === agentId);
    const label = target?.name ?? agentId;
    const confirmed = window.confirm(
      `Delete agent "${label}"? This will remove it from active use.`,
    );
    if (!confirmed) return;

    this.deletingId.set(agentId);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.yoizenclawAdminService.deleteAgent(agentId).subscribe({
      next: () => {
        this.agents.update((agents) => agents.filter((a) => a.id !== agentId));
        this.runtimeHealth.update((health) => {
          const { [agentId]: _, ...rest } = health;
          return rest;
        });
        const message = `Agent "${label}" deleted successfully.`;
        this.successMessage.set(message);
        this.snackBar.open(message, undefined, { duration: 3000 });

        if (this.editingAgentId() === agentId) {
          this.editingAgentId.set(null);
          this.resetToTemplate();
          if (this.navigationMode() === "route") {
            void this.router.navigate(["/yoizenclaw/agents"]);
          } else {
            this.viewMode.set("list");
          }
        }

        this.bridge?.notifyDeletedAgent(agentId);
        this.deletingId.set(null);
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(
            error.error?.message,
            "The agent could not be deleted.",
          ),
        );
        this.deletingId.set(null);
      },
    });
  }

  private applyAgentToForm(agent: IYoizenclawAgent, scrollToTop = true): void {
    this.editingAgentId.set(agent.id);
    this.agentName = agent.name;
    this.description = agent.description || "";
    this.systemPrompt = agent.system_prompt;
    const llm = getAgentLlmConfig(agent.model_config);
    this.provider = llm.provider;
    this.model = llm.model;
    this.connectorId = llm.connectorId;
    this.rules = agent.model_config.rules;
    this.soul = agent.model_config.soul;
    this.subagents = agent.model_config.subagents.map(mapSubagentConfigToDraft);
    this.tools = (agent.tools ?? []).map((raw) => parseToolPayload(raw));

    // The detail header already shows the agent name; no banner needed here.
    this.successMessage.set("");
    this.errorMessage.set("");
    this.viewMode.set("editor");

    // Capture the saved-state baseline before any draft restore
    this.baseline = this.buildCurrentDraft();
    this.isDirty.set(false);
    this.draftRestored.set(null);

    // If a localStorage draft exists for this agent, restore it on top
    this.tryRestoreDraftFor(agent.id);

    if (scrollToTop) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    this.bumpVersion();
  }

  cancelEdit(): void {
    if (this.navigationMode() === "route" && this.defaultMode() === "editor") {
      const currentAgentId = this.editingAgentId();
      if (currentAgentId) {
        void this.router.navigate([
          "/yoizenclaw/agents",
          currentAgentId,
          "overview",
        ]);
      } else {
        void this.router.navigate(["/yoizenclaw/agents"]);
      }
      this.discardDraft();
      return;
    }

    this.editingAgentId.set(null);
    this.discardDraft();
    this.resetToTemplate();
    this.successMessage.set("");
    this.errorMessage.set("");
    this.viewMode.set("list");
  }

  // -----------------------------------------------------------------
  // Draft autosave
  // -----------------------------------------------------------------

  private buildCurrentDraft(): IYoizenclawAgentDraft {
    return {
      name: this.agentName,
      description: this.description,
      systemPrompt: this.systemPrompt,
      provider: this.provider,
      model: this.model,
      connectorId: this.connectorId,
      rules: this.rules,
      soul: this.soul,
      subagents: this.subagents,
      tools: buildToolPayloadsFromDrafts(this.tools),
    };
  }

  private runDraftAutosave(): void {
    if (this.viewMode() !== "editor") return;

    // Keep bridge.canSave in sync with isValid() — derived from plain fields,
    // so we sample it on the same cadence as the dirty check.
    if (this.bridge) {
      const valid = this.isValid();
      if (this.bridge.canSave() !== valid) {
        this.bridge.canSave.set(valid);
      }
    }

    if (!this.baseline) return;

    const current = this.buildCurrentDraft();
    const equal = areDraftsEqual(current, this.baseline);

    if (equal) {
      if (this.isDirty()) {
        this.isDirty.set(false);
      }
      return;
    }

    if (!this.isDirty()) {
      this.isDirty.set(true);
    }

    saveAgentDraft(this.editingAgentId(), current);
  }

  private tryRestoreDraftFor(agentId: string): void {
    const result = loadAgentDraft(agentId);
    if (!result.ok) {
      console.warn("[yoizenclaw] could not load draft", result.error);
      return;
    }

    const snapshot = result.value;
    if (!snapshot) return;

    if (this.baseline && areDraftsEqual(snapshot.draft, this.baseline)) {
      // The cached draft equals what came back from the server — nothing to do.
      console.debug("[yoizenclaw] draft matches server, ignoring");
      clearAgentDraft(agentId);
      return;
    }

    this.applyDraftToForm(snapshot.draft);
    this.draftRestored.set(snapshot.savedAt);
    this.isDirty.set(true);
    console.info("[yoizenclaw] restored draft from", new Date(snapshot.savedAt));
  }

  private applyDraftToForm(draft: IYoizenclawAgentDraft): void {
    this.agentName = draft.name;
    this.description = draft.description ?? "";
    this.systemPrompt = draft.systemPrompt;
    this.provider = draft.provider;
    this.model = draft.model;
    this.connectorId = draft.connectorId ?? null;
    this.rules = draft.rules;
    this.soul = draft.soul;
    this.subagents = (draft.subagents ?? []).map((s) => ({ ...s }));
    this.tools = (draft.tools ?? []).map((raw) => parseToolPayload(raw));
    this.bumpVersion();
  }

  discardDraft(): void {
    clearAgentDraft(this.editingAgentId());
    this.draftRestored.set(null);
    // Reset the form fields back to the saved-state baseline so the next
    // autosave tick sees current === baseline and doesn't re-create the draft.
    if (this.baseline) {
      this.applyDraftToForm(this.baseline);
    }
    this.isDirty.set(false);
    console.debug("[yoizenclaw] draft discarded; form reset to baseline");
  }

  // -----------------------------------------------------------------
  // Data load
  // -----------------------------------------------------------------

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set("");

    this.yoizenclawAdminService.listTemplates().subscribe({
      next: (response) => {
        this.templates.set(response.templates);
        if (response.templates.length > 0 && !this.editingAgentId()) {
          const template =
            response.templates.find((t) => t.id === DEFAULT_TEMPLATE_ID) ||
            response.templates[0];
          this.applyTemplateById(template.id);
        }
      },
      error: () => {
        this.notifyError("Unable to load agent templates.");
      },
    });

    this.yoizenclawAdminService
      .listAgents({ limit: 12, offset: 0 })
      .subscribe({
        next: (response) => {
          this.agents.set(response.agents);
          this.runtimeHealth.update((current) => {
            const next: Record<string, IAgentRuntimeHealth> = {};
            for (const agent of response.agents) {
              next[agent.id] = current[agent.id] ?? { state: "unknown" };
            }
            return next;
          });

          const forcedAgentId = this.forcedAgentId();
          if (forcedAgentId) {
            const existing = response.agents.find(
              (agent) => agent.id === forcedAgentId,
            );
            if (existing) {
              this.applyAgentToForm(existing, false);
              this.loading.set(false);
              return;
            }

            this.loadForcedAgent(forcedAgentId);
            return;
          }

          if (this.defaultMode() === "editor" && !this.editingAgentId()) {
            this.createNewAgentInline();
          }

          this.loading.set(false);
        },
        error: () => {
          this.notifyError("Unable to load existing YoizenClaw agents.");
          this.loading.set(false);
        },
      });

    this.adaptersService.listByTag("llm").subscribe({
      next: (connectors) => this.llmConnectors.set(connectors),
      error: () => {
        this.notifyError("Unable to load LLM connectors for this tenant.");
      },
    });
  }

  private loadForcedAgent(agentId: string): void {
    this.yoizenclawAdminService.getAgent(agentId).subscribe({
      next: (agent) => {
        this.applyAgentToForm(agent, false);
        this.loading.set(false);
      },
      error: () => {
        this.notifyError("Unable to load the selected agent.");
        this.loading.set(false);
      },
    });
  }

  async checkRuntimeSync(agentId: string): Promise<void> {
    const agent = this.agents().find((candidate) => candidate.id === agentId);
    if (!agent) return;

    this.runtimeHealth.update((current) => ({
      ...current,
      [agentId]: { state: "checking", checkedAt: Date.now() },
    }));

    try {
      const submitted = await firstValueFrom(
        this.yoizenclawRuntimeService.createExecution({
          agentId,
          message: "Runtime sync check",
          conversationId: `runtime-sync-check-${agentId}-${Date.now()}`,
          channel: "admin-console-health-check",
          customerName: "Health Check",
          context: [],
          userId: "runtime-health-check",
        }),
      );

      const timeoutAt = Date.now() + 20_000;
      while (Date.now() < timeoutAt) {
        const result = await firstValueFrom(
          this.yoizenclawRuntimeService.getExecution(submitted.executionId),
        );

        if (result.state === "completed") {
          this.runtimeHealth.update((current) => ({
            ...current,
            [agentId]: { state: "synced", checkedAt: Date.now() },
          }));
          return;
        }

        if (result.state === "failed") {
          const detail =
            result.result?.errorMessage ||
            result.result?.errorCode ||
            "Runtime execution failed.";
          this.runtimeHealth.update((current) => ({
            ...current,
            [agentId]: {
              state: "unsynced",
              detail,
              checkedAt: Date.now(),
            },
          }));
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      throw new Error("Runtime health check timed out.");
    } catch (error) {
      const detail =
        error instanceof Error && error.message
          ? error.message
          : "Runtime health check failed.";
      this.runtimeHealth.update((current) => ({
        ...current,
        [agentId]: { state: "unsynced", detail, checkedAt: Date.now() },
      }));
    }
  }
}
