import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  type OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import { firstValueFrom, type Observable } from "rxjs";
import {
  getAgentLlmConfig,
  type IAgent,
  type IAgentDraft,
  type IAgentToolDraft,
  type ISubagentDraft,
  type ITemplate,
  type VariableDeclaration,
} from "../../../core/models/agent.model";
import {
  AdaptersService,
  type IAdapterSummary,
} from "../../../core/services/adapters.service";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { AgentRuntimeService } from "../../../core/services/agent-runtime.service";
import {
  type IKnowledgeBase,
  KnowledgeBasesService,
} from "../../../core/services/knowledge-bases.service";
import {
  type ISkill,
  SkillsService,
} from "../../../core/services/skills.service";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import { AiAgentConfigComponent } from "./agent-config.component";
import {
  areDraftsEqual,
  clearAgentDraft,
  loadAgentDraft,
  saveAgentDraft,
} from "./agent-draft.helpers";
import {
  type IAgentEditorSelection,
  SELECTION_INSTRUCTION_PROMPT,
  selectSkill,
  selectTool,
} from "./agent-editor.types";
import { AgentEditorBridgeService } from "./agent-editor-bridge.service";
import { AiAgentEditorNavComponent } from "./agent-editor-nav.component";
import { AiAgentEditorSkillFormComponent } from "./agent-editor-skill-form.component";
import { AiAgentEditorToolFormComponent } from "./agent-editor-tool-form.component";
import { AgentVersionsComponent } from "./agent-versions.component";
import {
  buildToolPayloadsFromDrafts,
  extractMentionsFromPrompt,
  formatHttpErrorMessage,
  mapSubagentConfigToDraft,
  parseToolPayload,
} from "./ai.helpers";
import {
  cloneSubagents,
  DEFAULT_TEMPLATE_ID,
  type ISkillInfo,
  type IToolInfo,
} from "./ai.types";
import {
  type IMentionDecorationEditor,
  registerAiMonacoMentionDecorations,
} from "./ai-monaco-decorations";
import {
  registerAiMonacoCompletionProvider,
  registerAiMonacoHoverProvider,
} from "./ai-monaco-hover";
import { AiTopBarComponent } from "./ai-top-bar.component";
import { AiBuiltinToolsComponent } from "./builtin-tools.component";
import {
  AiExistingAgentsPanelComponent,
  type IAgentRuntimeHealth,
} from "./existing-agents-panel.component";
import { AiMcpServersSelectorComponent } from "./mcp-servers-selector.component";
import { SkillFormDialogComponent } from "./skills/skill-form-dialog.component";
import { SkillPickerDialogComponent } from "./skills/skill-picker-dialog.component";

const AUTOSAVE_INTERVAL_MS = 800;

@Component({
  selector: "app-ai",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UtcDatePipe,
    FormsModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatDialogModule,
    MonacoEditorModule,
    PageHeaderComponent,
    AiAgentConfigComponent,
    AiExistingAgentsPanelComponent,
    AiAgentEditorNavComponent,
    AiAgentEditorSkillFormComponent,
    AiAgentEditorToolFormComponent,
    SkillFormDialogComponent,
    AiTopBarComponent,
    AiBuiltinToolsComponent,
    AiMcpServersSelectorComponent,
    AgentVersionsComponent,
  ],
  styleUrl: "./ai.component.scss",
  template: `
    @if (viewMode() === 'list') {
      <app-page-header title="Agents">
        <ng-container slot="actions">
          <button class="btn btn-secondary btn-sm" type="button" (click)="refresh()">
            <mat-icon>sync</mat-icon>
            Sync from Seed
          </button>
          <button class="btn btn-primary btn-sm" type="button" (click)="createNewAgent()">
            <mat-icon>add</mat-icon>
            New Agent
          </button>
        </ng-container>
      </app-page-header>

      <div class="workspace-grid single-column">
        <app-ai-existing-agents
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
           (revert)="revertAgent($event)"
           (delete)="deleteAgent($event)"
           (checkRuntime)="checkRuntimeSync($event)"
        />
      </div>
    } @else {
      <app-ai-top-bar
        [editingAgentId]="editingAgentId()"
        [saving]="saving()"
        [loading]="loading()"
        [canSave]="isValid()"
        [errorMessage]="errorMessage()"
        [successMessage]="successMessage()"
        [isDirty]="isDirty()"
        [hideChrome]="hideOwnChrome()"
        (save)="saveAgent()"
        (reset)="resetToTemplate()"
        (cancelEdit)="cancelEdit()"
      />

      @if (draftRestored()) {
        <div class="alert alert-info draft-banner">
          <mat-icon>history</mat-icon>
          <div>
            Restored your unsaved changes from {{ draftRestored() | utcDate: 'short' }}.
            <button type="button" class="link-btn" (click)="discardDraft()">
              Discard and reload saved version
            </button>
          </div>
        </div>
      }

      <!--
        Single scrolling column (mock 07/08/09, SPEC decision 5c): the old
        fixed 3-pane workstation (icon rail + config-tree sidebar + docked
        editor pane) is replaced by a Configuration nav list that scrolls
        WITH the page, followed by every section stacked in mock order —
        General, Instructions (System Prompt / Rules / Soul / Detected
        References), Capabilities (Skills / Tools / Built-in Tools / MCP
        Servers / Knowledge Bases), Advanced (Variables / Versions). Nothing
        is @switch-gated anymore: every section renders, and the nav's
        (select) output now scrolls the matching #section-* anchor into view
        instead of swapping which section is visible (onNavSelect). Form
        bindings/Monaco instances/save path below are UNCHANGED from the old
        @switch cases (verbatim reuse, layout-only restructure).
      -->
      <div class="single-column-layout">
        <nav class="config-nav" aria-label="Agent configuration sections">
          <app-ai-editor-nav
            [selection]="selection()"
            [skills]="subagents"
            [tools]="tools"
            [templates]="templates()"
            [selectedTemplateId]="selectedTemplateId"
            [collapsed]="paletteCollapsed()"
            [editingAgentId]="editingAgentId()"
            (select)="onNavSelect($event)"
            (addSkill)="addSubagentAndFocus()"
            (addSkillFromCatalog)="addSubagentFromCatalog()"
            (addTool)="addToolAndFocus()"
            (removeSkill)="removeSubagent($event)"
            (removeTool)="removeTool($event)"
            (applyTemplate)="applyTemplateById($event)"
            (toggleCollapsed)="togglePaletteCollapsed()"
          />
        </nav>

        <main class="editor-column">
          @if (loading()) {
            <div class="loading-overlay">
              <mat-spinner diameter="24" />
            </div>
          }

          <section class="section-card" id="section-general">
            <div class="section-card-header">
              <div>
                <div class="section-card-title">General</div>
                <div class="section-card-sub">
                  Name, description, and the LLM connector for this agent.
                </div>
              </div>
            </div>
            <app-ai-agent-config
              section="general"
              [llmConnectors]="llmConnectors()"
              [editorOptions]="editorOptions"
              [(agentName)]="agentName"
              [(description)]="description"
              [(provider)]="provider"
              [(model)]="model"
              [(connectorId)]="connectorId"
              [(temperature)]="temperature"
              [(maxTokens)]="maxTokens"
            />
          </section>

          <section class="section-card" id="section-instruction-prompt">
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
                (onInit)="onPromptEditorInit($event)"
              />
            </div>
          </section>

          <section class="section-card" id="section-instruction-rules">
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
                (onInit)="onPromptEditorInit($event)"
              />
            </div>
          </section>

          <section class="section-card" id="section-instruction-soul">
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
                (onInit)="onPromptEditorInit($event)"
              />
            </div>
          </section>

          <section class="section-card" id="section-instruction-mentions">
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
          </section>

          <section class="section-card" id="section-skills">
            <div class="section-card-header">
              <div>
                <div class="section-card-title">Skills</div>
                <div class="section-card-sub">
                  Focused sub-agents this agent can delegate to.
                </div>
              </div>
            </div>
            @for (skill of subagents; track $index) {
              <div class="stacked-item" id="section-skill-{{ $index }}">
                <app-ai-editor-skill-form
                  [skill]="skill"
                  [editorOptions]="editorOptions"
                  (skillChange)="onSkillFormChange($index, $event)"
                  (remove)="removeSubagent($index)"
                  (saveToCatalog)="saveToCatalog(skill)"
                  (syncFromCatalog)="syncFromCatalog(skill)"
                />
              </div>
            } @empty {
              <div class="empty-focus">No skills yet.</div>
            }
          </section>

          <section class="section-card" id="section-tools">
            <div class="section-card-header">
              <div>
                <div class="section-card-title">Tools</div>
                <div class="section-card-sub">
                  HTTP and adapter-backed tools this agent can call.
                </div>
              </div>
            </div>
            @for (tool of tools; track $index) {
              <div class="stacked-item" id="section-tool-{{ $index }}">
                <app-ai-editor-tool-form
                  [tool]="tool"
                  (toolChange)="onToolFormChange($index, $event)"
                  (remove)="removeTool($index)"
                />
              </div>
            } @empty {
              <div class="empty-focus">No tools yet.</div>
            }
          </section>

          <section class="section-card" id="section-builtin-tools">
            @if (editingAgentId()) {
              <div class="section-card-header">
                <div>
                  <div class="section-card-title">Built-in Tools</div>
                  <div class="section-card-sub">
                    Platform-provided tools that the agent can use. Toggle
                    tools on or off to control which built-in capabilities
                    are available.
                  </div>
                </div>
              </div>
              <app-ai-builtin-tools
                [agentId]="editingAgentId()!"
                [enabledTools]="currentEnabledTools()"
                [toolDescriptionOverrides]="currentToolDescriptionOverrides()"
                (toolsSaved)="onBuiltinToolsSaved($event)"
                (toolDescriptionsSaved)="onToolDescriptionsSaved($event)"
              />
            } @else {
              <div class="section-card-header">
                <div>
                  <div class="section-card-title">Built-in Tools</div>
                </div>
              </div>
              <div class="empty-focus">
                Save the agent first to configure built-in tools.
              </div>
            }
          </section>

          <section class="section-card" id="section-mcp-servers">
            @if (editingAgentId()) {
              <div class="section-card-header">
                <div>
                  <div class="section-card-title">MCP Servers</div>
                  <div class="section-card-sub">
                    Model Context Protocol servers that the agent can use to
                    access external tools and data sources.
                  </div>
                </div>
              </div>
              <app-ai-mcp-servers-selector
                [agentId]="editingAgentId()!"
                [enabledMcpServers]="currentMcpServers()"
                [enabledMcpTools]="currentEnabledMcpTools()"
                [toolDescriptionOverrides]="
                  currentToolDescriptionOverrides()
                "
                (serversSaved)="onMcpServersSaved($event)"
                (mcpToolsSaved)="onEnabledMcpToolsSaved($event)"
                (toolDescriptionsSaved)="onToolDescriptionsSaved($event)"
              />
            } @else {
              <div class="section-card-header">
                <div>
                  <div class="section-card-title">MCP Servers</div>
                </div>
              </div>
              <div class="empty-focus">
                Save the agent first to configure MCP servers.
              </div>
            }
          </section>

          <section class="section-card" id="section-knowledge-bases">
            <div class="section-card-header">
              <div>
                <div class="section-card-title">Knowledge Bases</div>
                <div class="section-card-sub">
                  Select knowledge bases for this agent to search at runtime.
                </div>
              </div>
            </div>
            <app-ai-agent-config
              section="knowledgeBases"
              [llmConnectors]="llmConnectors()"
              [editorOptions]="editorOptions"
              [knowledgeBaseList]="knowledgeBaseList"
              [(selectedKbIds)]="selectedKbIds"
            />
          </section>

          <section class="section-card" id="section-variables">
            <div class="section-card-header">
              <div>
                <div class="section-card-title">Variables</div>
                <div class="section-card-sub">
                  Define the input variables the agent expects and the output
                  variables it produces.
                </div>
              </div>
            </div>
            <app-ai-agent-config
              section="variables"
              [llmConnectors]="llmConnectors()"
              [editorOptions]="editorOptions"
              [(inputVariables)]="inputVariables"
              [(outputVariables)]="outputVariables"
            />
          </section>

          <section class="section-card" id="section-versions">
            @if (editingAgentId()) {
              <div class="section-card-header">
                <div>
                  <div class="section-card-title">Version History</div>
                  <div class="section-card-sub">
                    View past versions, rollback to any version, or delete old versions.
                  </div>
                </div>
              </div>
              <div class="focus-pad">
                <app-agent-versions
                  [agentId]="editingAgentId()!"
                  (rollback)="rollbackToVersion($event)"
                  (versionDeleted)="onVersionDeleted($event)"
                />
              </div>
            } @else {
              <div class="section-card-header">
                <div>
                  <div class="section-card-title">Version History</div>
                </div>
              </div>
              <div class="empty-focus">Save the agent first to see version history.</div>
            }
          </section>
        </main>
      </div>
    }
  `,
})
export class AiComponent implements OnInit {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly agentRuntimeService = inject(AgentRuntimeService);
  private readonly adaptersService = inject(AdaptersService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly bridge = inject(AgentEditorBridgeService, {
    optional: true,
  });
  private readonly skillsService = inject(SkillsService);
  private readonly knowledgeBasesService = inject(KnowledgeBasesService);

  readonly navigationMode = input<"inline" | "route">("inline");
  readonly defaultMode = input<"list" | "editor">("list");
  readonly forcedAgentId = input<string | null>(null);
  /**
   * Task B (agent chrome parity): true when nested under
   * AiAgentDetailComponent's /configure route, whose floating chrome now
   * owns Save/Reset/Cancel/dirty-state via AgentEditorBridgeService (the
   * same signals this component already pushes into the bridge below —
   * see the `bridge.saving.set(...)` effect). Forwarded to AiTopBarComponent
   * to suppress its page-header block only; the standalone /ai/agents/new
   * route (no wrapper, no bridge) keeps its own top bar unchanged.
   */
  readonly hideOwnChrome = input<boolean>(false);

  readonly templates = signal<ITemplate[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly viewMode = signal<"list" | "editor">("list");
  readonly publishingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly runtimeHealth = signal<Record<string, IAgentRuntimeHealth>>({});
  readonly editingAgentId = signal<string | null>(null);
  readonly agents = signal<IAgent[]>([]);
  readonly llmConnectors = signal<IAdapterSummary[]>([]);
  readonly errorMessage = signal("");
  readonly successMessage = signal("");

  // ---- Editor selection ----
  readonly selection = signal<IAgentEditorSelection>(
    SELECTION_INSTRUCTION_PROMPT
  );
  readonly paletteCollapsed = signal(false);

  // ---- Draft persistence ----
  readonly isDirty = signal(false);
  readonly draftRestored = signal<number | null>(null);
  private baseline: IAgentDraft | null = null;

  // ---- Built-in tools ----
  readonly currentEnabledTools = signal<string[] | null>(null);
  readonly currentToolDescriptionOverrides = signal<Record<
    string,
    string
  > | null>(null);

  // ---- MCP servers ----
  readonly currentMcpServers = signal<string[] | null>(null);
  readonly currentEnabledMcpTools = signal<Record<
    string,
    string[] | null
  > | null>(null);

  // ---- Reactivity helpers (bumped on structural mutations) ----
  private readonly version = signal(0);

  readonly extractedMentions = computed(() => {
    this.version();
    const mentions = extractMentionsFromPrompt(this.systemPrompt);
    // Normalize skill mentions: replace spaces with hyphens to match availableSkills IDs
    return mentions.map((m) => {
      if (m.startsWith("@skill:")) {
        const name = m.slice(7);
        return `@skill:${name.toLowerCase().replace(/\s+/g, "-")}`;
      }
      return m;
    });
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
    language: "ai-prompt",
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
  temperature: number | null = null;
  maxTokens: number | null = null;
  subagents: ISubagentDraft[] = [];
  tools: IAgentToolDraft[] = [];
  inputVariables: VariableDeclaration[] = [];
  outputVariables: VariableDeclaration[] = [];
  knowledgeBaseList: IKnowledgeBase[] = [];
  selectedKbIds: string[] = [];

  /**
   * Mention-decoration cleanup callbacks, one per Monaco instance that has
   * called `onPromptEditorInit` (System Prompt / Rules / Soul). Disposed on
   * component destroy — display-layer only, never touches the save path.
   */
  private readonly mentionDecorationDisposers: Array<{ dispose(): void }> = [];

  constructor() {
    registerAiMonacoHoverProvider({
      getSkills: () => this.availableSkills(),
      getTools: () => this.availableTools(),
    });
    registerAiMonacoCompletionProvider({
      getSkills: () => this.availableSkills(),
      getTools: () => this.availableTools(),
    });

    const intervalHandle = setInterval(
      () => this.runDraftAutosave(),
      AUTOSAVE_INTERVAL_MS
    );
    this.destroyRef.onDestroy(() => {
      clearInterval(intervalHandle);
      this.bridge?.unregisterHandlers();
      for (const disposer of this.mentionDecorationDisposers) {
        disposer.dispose();
      }
      this.mentionDecorationDisposers.length = 0;
      console.debug("[ai] autosave + bridge + mention decorations torn down");
    });

    // Push state changes to the parent detail header via the bridge.
    if (this.bridge) {
      const bridge = this.bridge;
      effect(() => {
        bridge.editingAgentId.set(
          this.viewMode() === "editor" ? this.editingAgentId() : null
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

  /**
   * Wires mention decorations for a Monaco editor instance once it fires
   * `onInit` (System Prompt / Rules / Soul all share this handler — smallest
   * change that covers all three). Display-layer only: decorations are
   * ephemeral view state computed from the model text, the model/save path
   * is never touched.
   */
  onPromptEditorInit(editor: IMentionDecorationEditor): void {
    console.debug("[ai] Monaco editor initialized, wiring mention decorations");
    const disposer = registerAiMonacoMentionDecorations(editor);
    this.mentionDecorationDisposers.push(disposer);
  }

  refresh(): void {
    this.loadData();
  }

  createNewAgent(): void {
    if (this.navigationMode() === "route") {
      void this.router.navigate(["/ai/agents/new"]);
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
          subagent.systemPrompt.trim().length > 0
      )
    );
  }

  applyTemplateById(templateId: string): void {
    const template = this.templates().find(
      (option: ITemplate) => option.id === templateId
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
      template.subagents.map(mapSubagentConfigToDraft)
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
    this.temperature = null;
    this.maxTokens = null;
    this.tools = [];
    this.inputVariables = [];
    this.outputVariables = [];
    this.selectedKbIds = [];
    this.discardDraft();
  }

  // -----------------------------------------------------------------
  // Editor selection + skill/tool mutations
  // -----------------------------------------------------------------

  setSelection(next: IAgentEditorSelection): void {
    this.selection.set(next);
  }

  /**
   * Config-nav click handler for the single-scrolling-column layout (mock
   * 07/08, SPEC decision 5c). Every section already renders in the DOM, so
   * "selecting" a nav entry no longer swaps which section is visible — it
   * just updates the active-highlight state (`setSelection`) and smooth-
   * scrolls the matching `#section-*` anchor into view.
   */
  onNavSelect(next: IAgentEditorSelection): void {
    this.setSelection(next);
    const anchorId = this.anchorIdForSelection(next);
    console.debug("[ai] config nav selection, scrolling to section", {
      selection: next,
      anchorId,
    });
    const target = document.getElementById(anchorId);
    if (!target || typeof target.scrollIntoView !== "function") {
      console.warn(
        "[ai] no scrollable anchor found for selection, scroll skipped",
        { anchorId }
      );
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private anchorIdForSelection(selection: IAgentEditorSelection): string {
    switch (selection.kind) {
      case "skill":
        return `section-skill-${selection.index}`;
      case "tool":
        return `section-tool-${selection.index}`;
      case "knowledgeBases":
        // "knowledgeBases" is camelCase but the rendered anchor id is
        // kebab-case ("section-knowledge-bases") — map it explicitly so
        // getElementById doesn't miss.
        return "section-knowledge-bases";
      default:
        return `section-${selection.kind}`;
    }
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

  addSubagentFromCatalog(): void {
    const existingNames = new Set(
      this.subagents.map((s) => s.name.toLowerCase().trim())
    );

    const dialogRef = this.dialog.open(SkillPickerDialogComponent, {
      width: "500px",
    });

    dialogRef
      .afterClosed()
      .subscribe(
        (selectedSkills: { id: string; name: string }[] | undefined) => {
          if (!selectedSkills || selectedSkills.length === 0) {
            return;
          }

          // Filter out already-added skills
          const newSkills = selectedSkills.filter(
            (s) => !existingNames.has(s.name.toLowerCase().trim())
          );

          if (newSkills.length === 0) {
            this.snackBar.open("Selected skills are already added.", "OK", {
              duration: 2000,
            });
            return;
          }

          // Fetch full skill data for selected skills
          this.skillsService.list().subscribe({
            next: (response) => {
              const catalog = response.skills || [];
              for (const { id, name } of newSkills) {
                const skill = catalog.find((s) => s.id === id);
                this.subagents = [
                  ...this.subagents,
                  {
                    name: skill?.name ?? name,
                    description: skill?.description ?? "",
                    systemPrompt: skill?.system_prompt ?? "",
                    enabled: true,
                    source: "catalog",
                    catalogSkillId: id,
                  },
                ];
              }
              this.bumpVersion();
              this.snackBar.open(`Added ${newSkills.length} skill(s)`, "OK", {
                duration: 2000,
              });
            },
            error: () => {
              this.snackBar.open("Failed to load skill details", "OK", {
                duration: 3000,
              });
            },
          });
        }
      );
  }

  removeSubagent(index: number): void {
    if (index < 0 || index >= this.subagents.length) {
      return;
    }
    this.subagents = this.subagents.filter((_, i) => i !== index);
    this.bumpVersion();
    this.shiftSelectionAfterRemove("skill", index, this.subagents.length);
  }

  onSkillFormChange(index: number, next: ISubagentDraft): void {
    if (index < 0 || index >= this.subagents.length) {
      return;
    }
    this.subagents = this.subagents.map((current, i) =>
      i === index ? next : current
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
        parameters: [],
      },
    ];
    this.bumpVersion();
  }

  addToolAndFocus(): void {
    this.addTool();
    this.selection.set(selectTool(this.tools.length - 1));
  }

  removeTool(index: number): void {
    if (index < 0 || index >= this.tools.length) {
      return;
    }
    this.tools = this.tools.filter((_, i) => i !== index);
    this.bumpVersion();
    this.shiftSelectionAfterRemove("tool", index, this.tools.length);
  }

  onToolFormChange(index: number, next: IAgentToolDraft): void {
    if (index < 0 || index >= this.tools.length) {
      return;
    }
    this.tools = this.tools.map((current, i) => (i === index ? next : current));
    this.bumpVersion();
  }

  onBuiltinToolsSaved(enabledTools: string[] | null): void {
    this.currentEnabledTools.set(enabledTools);
  }

  onToolDescriptionsSaved(overrides: Record<string, string> | null): void {
    this.currentToolDescriptionOverrides.set(overrides);
  }

  onMcpServersSaved(enabledMcpServers: string[] | null): void {
    this.currentMcpServers.set(enabledMcpServers);
  }

  onEnabledMcpToolsSaved(
    enabledMcpTools: Record<string, string[] | null> | null
  ): void {
    this.currentEnabledMcpTools.set(enabledMcpTools);
  }

  rollbackToVersion(versionId: string): void {
    const agentId = this.editingAgentId();
    if (!agentId) {
      return;
    }
    const confirmed = window.confirm(
      "Rollback to this version? Your current draft will be replaced."
    );
    if (!confirmed) {
      return;
    }

    this.agentAdminService.rollbackToVersion(agentId, versionId).subscribe({
      next: (agent) => {
        this.agents.update((agents) =>
          agents.map((a) => (a.id === agent.id ? agent : a))
        );
        this.applyAgentToForm(agent, false);
        this.snackBar.open("Rolled back to selected version.", undefined, {
          duration: 3000,
        });
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(
            error.error?.message,
            "Could not rollback to version."
          )
        );
      },
    });
  }

  onVersionDeleted(_versionId: string): void {
    // Versions list refreshes itself inside AgentVersionsComponent
  }

  // -----------------------------------------------------------------
  // Catalog sync — Save to Catalog / Sync from Catalog
  // -----------------------------------------------------------------

  async saveToCatalog(skill: ISubagentDraft): Promise<void> {
    if (skill.catalogSkillId) {
      return;
    }

    const dialogRef = this.dialog.open(SkillFormDialogComponent, {
      width: "600px",
      data: {
        name: skill.name,
        description: skill.description,
        system_prompt: skill.systemPrompt,
      } as ISkill,
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) {
      return;
    }

    this.skillsService.create(result).subscribe({
      next: (created) => {
        const index = this.subagents.indexOf(skill);
        if (index >= 0) {
          this.subagents = this.subagents.map((current, i) =>
            i === index ? { ...current, catalogSkillId: created.id } : current
          );
          this.bumpVersion();
        }
        this.snackBar.open(`Saved "${skill.name}" to Catalog`, "OK", {
          duration: 2000,
        });
      },
      error: () =>
        this.snackBar.open("Failed to save to Catalog", "OK", {
          duration: 3000,
        }),
    });
  }

  syncFromCatalog(skill: ISubagentDraft): void {
    if (!skill.catalogSkillId) {
      return;
    }

    this.skillsService.get(skill.catalogSkillId).subscribe({
      next: (catalogSkill) => {
        const index = this.subagents.indexOf(skill);
        if (index >= 0) {
          this.subagents = this.subagents.map((current, i) =>
            i === index
              ? {
                  ...current,
                  name: catalogSkill.name,
                  description: catalogSkill.description,
                  systemPrompt: catalogSkill.system_prompt,
                }
              : current
          );
          this.bumpVersion();
        }
        this.snackBar.open(`Synced "${skill.name}" from Catalog`, "OK", {
          duration: 2000,
        });
      },
      error: () =>
        this.snackBar.open("Failed to sync from Catalog", "OK", {
          duration: 3000,
        }),
    });
  }

  private shiftSelectionAfterRemove(
    kind: "skill" | "tool",
    removedIndex: number,
    newLength: number
  ): void {
    const sel = this.selection();
    if (sel.kind !== kind) {
      return;
    }

    if (newLength === 0) {
      this.selection.set(SELECTION_INSTRUCTION_PROMPT);
      return;
    }

    if (sel.index === removedIndex) {
      const nextIndex = Math.min(sel.index, newLength - 1);
      this.selection.set(
        kind === "skill" ? selectSkill(nextIndex) : selectTool(nextIndex)
      );
      return;
    }

    if (sel.index > removedIndex) {
      this.selection.set(
        kind === "skill"
          ? selectSkill(sel.index - 1)
          : selectTool(sel.index - 1)
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
          : "Complete the required fields before creating the agent."
      );
      return;
    }

    const draft = this.buildCurrentDraft();

    this.errorMessage.set("");
    this.successMessage.set("");
    this.saving.set(true);

    const editingId = this.editingAgentId();

    if (editingId) {
      this.agentAdminService.updateAgent(editingId, draft).subscribe({
        next: (agent) => this.handleSaveSuccess(agent, "updated"),
        error: (error: { error?: { message?: string | string[] } }) => {
          this.notifyError(
            formatHttpErrorMessage(
              error.error?.message,
              "The agent could not be updated."
            )
          );
          this.saving.set(false);
        },
      });
      return;
    }

    this.agentAdminService.createAgent(draft).subscribe({
      next: (agent) => {
        this.agents.set([agent, ...this.agents()]);
        this.handleSaveSuccess(agent, "created");

        if (
          this.navigationMode() === "route" &&
          this.defaultMode() === "editor"
        ) {
          void this.router.navigate(["/ai/agents", agent.id, "overview"]);
        }
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(
            error.error?.message,
            "The agent could not be created."
          )
        );
        this.saving.set(false);
      },
    });
  }

  private handleSaveSuccess(agent: IAgent, verb: "created" | "updated"): void {
    if (verb === "updated") {
      this.agents.update((agents) =>
        agents.map((a) => (a.id === agent.id ? agent : a))
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
      () => this.agentAdminService.publishAgent(agentId),
      "published",
      "Failed to publish agent."
    );
  }

  unpublishAgent(agentId: string): void {
    this.runAgentPublishToggle(
      agentId,
      () => this.agentAdminService.unpublishAgent(agentId),
      "unpublished",
      "Failed to unpublish agent."
    );
  }

  revertAgent(agentId: string): void {
    const target = this.agents().find((a) => a.id === agentId);
    const label = target?.name ?? agentId;
    const confirmed = window.confirm(
      `Revert "${label}" to its last published state? Unsaved draft changes will be lost.`
    );
    if (!confirmed) {
      return;
    }

    this.agentAdminService.revertToPublished(agentId).subscribe({
      next: (agent) => {
        this.agents.update((agents) =>
          agents.map((a) => (a.id === agent.id ? agent : a))
        );
        this.snackBar.open(
          `Agent "${agent.name}" reverted to published state.`,
          undefined,
          { duration: 3000 }
        );
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(
            error.error?.message,
            "Could not revert agent."
          )
        );
      },
    });
  }

  private runAgentPublishToggle(
    agentId: string,
    request: () => Observable<IAgent>,
    successVerb: "published" | "unpublished",
    failMessage: string
  ): void {
    this.publishingId.set(agentId);
    this.errorMessage.set("");
    this.successMessage.set("");
    request().subscribe({
      next: (agent) => {
        this.agents.update((agents) =>
          agents.map((a) => (a.id === agent.id ? agent : a))
        );
        const message = `Agent "${agent.name}" ${successVerb} successfully.`;
        this.successMessage.set(message);
        this.snackBar.open(message, undefined, { duration: 3000 });
        this.publishingId.set(null);
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.notifyError(
          formatHttpErrorMessage(error.error?.message, failMessage)
        );
        this.publishingId.set(null);
      },
    });
  }

  loadAgentForEdit(agent: IAgent): void {
    if (this.navigationMode() === "route") {
      void this.router.navigate(["/ai/agents", agent.id, "overview"]);
      return;
    }
    this.applyAgentToForm(agent);
  }

  deleteAgent(agentId: string): void {
    const target = this.agents().find((agent) => agent.id === agentId);
    const label = target?.name ?? agentId;
    const confirmed = window.confirm(
      `Delete agent "${label}"? This will remove it from active use.`
    );
    if (!confirmed) {
      return;
    }

    this.deletingId.set(agentId);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.agentAdminService.deleteAgent(agentId).subscribe({
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
            void this.router.navigate(["/ai/agents"]);
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
            "The agent could not be deleted."
          )
        );
        this.deletingId.set(null);
      },
    });
  }

  private applyAgentToForm(agent: IAgent, scrollToTop = true): void {
    this.editingAgentId.set(agent.id);
    this.agentName = agent.name;
    this.description = agent.description || "";
    this.systemPrompt = agent.system_prompt;
    const llm = getAgentLlmConfig(agent.model_config);
    this.provider = llm.provider;
    this.model = llm.model;
    this.connectorId = llm.connectorId;
    this.temperature = llm.temperature ?? null;
    this.maxTokens = llm.maxTokens ?? null;
    this.rules = agent.model_config.rules;
    this.soul = agent.model_config.soul;
    this.subagents = agent.model_config.subagents.map(mapSubagentConfigToDraft);
    this.tools = (agent.tools ?? []).map((raw) => parseToolPayload(raw));
    this.currentEnabledTools.set(agent.enabled_tools ?? null);
    this.currentToolDescriptionOverrides.set(
      agent.tool_description_overrides ?? null
    );
    this.currentMcpServers.set(agent.enabled_mcp_servers ?? null);
    this.currentEnabledMcpTools.set(agent.enabled_mcp_tools ?? null);
    this.inputVariables = agent.input_variables ?? [];
    this.outputVariables = agent.output_variables ?? [];
    this.selectedKbIds = agent.knowledge_base_ids ?? [];

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
        void this.router.navigate(["/ai/agents", currentAgentId, "overview"]);
      } else {
        void this.router.navigate(["/ai/agents"]);
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

  private buildCurrentDraft(): IAgentDraft {
    return {
      name: this.agentName,
      description: this.description,
      systemPrompt: this.systemPrompt,
      provider: this.provider,
      model: this.model,
      connectorId: this.connectorId,
      temperature: this.temperature ?? undefined,
      maxTokens: this.maxTokens ?? undefined,
      rules: this.rules,
      soul: this.soul,
      subagents: this.subagents,
      tools: buildToolPayloadsFromDrafts(this.tools),
      inputVariables: this.inputVariables,
      outputVariables: this.outputVariables,
      knowledgeBaseIds: this.selectedKbIds,
    };
  }

  private runDraftAutosave(): void {
    if (this.viewMode() !== "editor") {
      return;
    }

    // Keep bridge.canSave in sync with isValid() — derived from plain fields,
    // so we sample it on the same cadence as the dirty check.
    if (this.bridge) {
      const valid = this.isValid();
      if (this.bridge.canSave() !== valid) {
        this.bridge.canSave.set(valid);
      }
    }

    if (!this.baseline) {
      return;
    }

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
      console.warn("[ai] could not load draft", result.error);
      return;
    }

    const snapshot = result.value;
    if (!snapshot) {
      return;
    }

    if (this.baseline && areDraftsEqual(snapshot.draft, this.baseline)) {
      // The cached draft equals what came back from the server — nothing to do.
      console.debug("[ai] draft matches server, ignoring");
      clearAgentDraft(agentId);
      return;
    }

    this.applyDraftToForm(snapshot.draft);
    this.draftRestored.set(snapshot.savedAt);
    this.isDirty.set(true);
    console.info("[ai] restored draft from", new Date(snapshot.savedAt));
  }

  private applyDraftToForm(draft: IAgentDraft): void {
    this.agentName = draft.name;
    this.description = draft.description ?? "";
    this.systemPrompt = draft.systemPrompt;
    this.provider = draft.provider;
    this.model = draft.model;
    this.connectorId = draft.connectorId ?? null;
    this.temperature = draft.temperature ?? null;
    this.maxTokens = draft.maxTokens ?? null;
    this.rules = draft.rules;
    this.soul = draft.soul;
    this.subagents = (draft.subagents ?? []).map((s) => ({ ...s }));
    this.tools = (draft.tools ?? []).map((raw) => parseToolPayload(raw));
    this.inputVariables = (draft.inputVariables ?? []).map((v) => ({ ...v }));
    this.outputVariables = (draft.outputVariables ?? []).map((v) => ({ ...v }));
    this.selectedKbIds = draft.knowledgeBaseIds ?? [];
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
    console.debug("[ai] draft discarded; form reset to baseline");
  }

  // -----------------------------------------------------------------
  // Data load
  // -----------------------------------------------------------------

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set("");

    this.agentAdminService.listTemplates().subscribe({
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

    this.agentAdminService.listAgents({ limit: 12, offset: 0 }).subscribe({
      next: (response) => {
        this.agents.set(response.agents);
        this.runtimeHealth.update((current) => {
          const next: Record<string, IAgentRuntimeHealth> = {};
          for (const agent of response.agents) {
            next[agent.id] = current[agent.id] ?? { state: "unknown" };
          }
          return next;
        });

        this.checkRuntimeSync();

        const forcedAgentId = this.forcedAgentId();
        if (forcedAgentId) {
          const existing = response.agents.find(
            (agent: IAgent) => agent.id === forcedAgentId
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
        this.notifyError("Unable to load existing AI agents.");
        this.loading.set(false);
      },
    });

    this.adaptersService.listByTag("llm").subscribe({
      next: (connectors) => this.llmConnectors.set(connectors),
      error: () => {
        this.notifyError("Unable to load LLM connectors for this tenant.");
      },
    });

    this.knowledgeBasesService.findAll().subscribe({
      next: (response) => {
        this.knowledgeBaseList = response.knowledge_bases ?? [];
      },
      error: () => {
        console.warn("[ai] could not load knowledge bases");
      },
    });
  }

  private loadForcedAgent(agentId: string): void {
    this.agentAdminService.getAgent(agentId).subscribe({
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

  async checkRuntimeSync(agentId?: string): Promise<void> {
    // If called from the button with a specific agentId, only check that agent.
    // If called from loadData() without an agentId, check all agents.
    const targetAgents = agentId
      ? this.agents().filter((a) => a.id === agentId)
      : [...this.agents()];

    if (targetAgents.length === 0) {
      return;
    }

    // Set all targets to "checking"
    for (const agent of targetAgents) {
      this.runtimeHealth.update((current) => ({
        ...current,
        [agent.id]: { state: "checking", checkedAt: Date.now() },
      }));
    }

    // Step 1: Check gateway infrastructure (one call for all agents)
    let gatewayHealthy = false;
    let gatewayDetail = "";
    try {
      const result = await firstValueFrom(
        this.agentRuntimeService.checkRuntimeHealth(),
        { defaultValue: undefined }
      );
      gatewayHealthy = result?.status === "ok";
      if (!gatewayHealthy && result) {
        gatewayDetail = `NATS: ${result.nats}, Redis: ${result.redis}`;
      }
    } catch (error) {
      gatewayDetail =
        error instanceof Error ? error.message : "Gateway unreachable";
    }

    // Step 2: Per-agent validation
    for (const agent of targetAgents) {
      const llm = getAgentLlmConfig(agent.model_config);
      const isPublished = agent.status === "published";
      const hasProvider = !!llm.provider?.trim();
      const hasModel = !!llm.model?.trim();

      if (!gatewayHealthy) {
        this.runtimeHealth.update((current) => ({
          ...current,
          [agent.id]: {
            state: "unsynced",
            detail: gatewayDetail || "Runtime gateway unavailable",
            checkedAt: Date.now(),
          },
        }));
      } else if (!isPublished) {
        this.runtimeHealth.update((current) => ({
          ...current,
          [agent.id]: {
            state: "draft",
            detail: "Agent not published",
            checkedAt: Date.now(),
          },
        }));
      } else if (!hasProvider || !hasModel) {
        const missing = [
          !hasProvider ? "provider" : "",
          !hasModel ? "model" : "",
        ]
          .filter(Boolean)
          .join(", ");
        this.runtimeHealth.update((current) => ({
          ...current,
          [agent.id]: {
            state: "misconfigured",
            detail: `Missing LLM config: ${missing}`,
            checkedAt: Date.now(),
          },
        }));
      } else {
        this.runtimeHealth.update((current) => ({
          ...current,
          [agent.id]: { state: "synced", checkedAt: Date.now() },
        }));
      }
    }
  }
}
