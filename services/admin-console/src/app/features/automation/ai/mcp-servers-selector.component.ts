import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import type { IMcpServerTool } from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { EditDescriptionDialogComponent } from "./edit-description-dialog.component";

export interface IMcpServerToggle {
  id: string;
  name: string;
  description: string;
  url: string;
  transport_type: string;
  enabled: boolean;
}

/**
 * Per-agent MCP configuration (mcp-connections.md §4/§5).
 *
 * - The server-level checkbox maps to `enabled_mcp_servers` — a list of MCP
 *   server NAMES (`null` = all servers enabled), saved via the "Save"
 *   button. This must be name-keyed (not id-keyed) because
 *   `tool-bridge.service.ts`'s `mergeMcpTools()` filters
 *   `MCPClient.getConnectedServers()`, which is itself keyed by server name
 *   (connections are established by `McpClientService.connect()` under the
 *   server's `name`, not its id) — matching `enabled_mcp_tools` below.
 * - Expanding a server reveals a per-tool checkbox list (tools fetched live
 *   from `GET admin/mcp-servers/:id/tools`) mapping to `enabled_mcp_tools`,
 *   a map keyed by MCP server NAME whose value is either `null` (all tools
 *   from that server enabled — the default) or an explicit allowlist of tool
 *   names. This is also persisted by the "Save" button.
 * - Each tool has an inline description-override editor reusing
 *   `EditDescriptionDialogComponent` (same component the built-in tools panel
 *   uses), keyed by `"<serverName>:<toolName>"` in `tool_description_overrides`.
 *   Overrides are saved immediately on dialog close.
 */
@Component({
  selector: "app-ai-mcp-servers-selector",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="section-card-body">
      <div class="mcp-header">
        <div class="mcp-header-text">
          <span class="text-muted text-sm">
            MCP (Model Context Protocol) servers available to this agent.
            Toggle servers on or off, expand a server to enable individual
            tools, then save your changes.
          </span>
        </div>
        <div class="mcp-header-actions">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            (click)="selectAll()"
            [disabled]="saving() || toggles().length === 0"
          >
            Select All
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            (click)="deselectAll()"
            [disabled]="saving() || toggles().length === 0"
          >
            Deselect All
          </button>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            (click)="save()"
            [disabled]="saving() || !hasChanges()"
          >
            @if (saving()) {
              <mat-spinner diameter="16" />
            } @else {
              <mat-icon>save</mat-icon>
            }
            Save
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="24" />
          <span>Loading MCP servers...</span>
        </div>
      }

      @if (!loading() && toggles().length === 0) {
        <div class="empty-state">
          <mat-icon>hub</mat-icon>
          <p>No MCP servers available.</p>
          <p class="text-muted text-sm">
            Configure MCP servers in the Connections section first, then enable
            them per agent here.
          </p>
        </div>
      }

      @if (toggles().length > 0) {
        <div class="mcp-list">
          @for (server of toggles(); track server.id) {
            <article class="mcp-card">
              <div class="mcp-card-top">
                <button
                  type="button"
                  class="expand-btn"
                  (click)="toggleExpanded(server.id)"
                  [attr.aria-label]="
                    isExpanded(server.id) ? 'Collapse tools' : 'Expand tools'
                  "
                >
                  <mat-icon>{{
                    isExpanded(server.id) ? "expand_more" : "chevron_right"
                  }}</mat-icon>
                </button>
                <div class="mcp-info">
                  <div class="mcp-name-row">
                    <span class="mcp-name">{{ server.name }}</span>
                    <span class="transport-badge">{{
                      server.transport_type
                    }}</span>
                  </div>
                  <p class="mcp-url">{{ server.url }}</p>
                  <p class="mcp-desc">
                    {{ server.description || "No description" }}
                  </p>
                </div>
                <label class="toggle-label">
                  <mat-checkbox
                    [checked]="server.enabled"
                    (change)="onToggle(server.id, $event.checked)"
                    color="primary"
                  />
                </label>
              </div>

              @if (isExpanded(server.id)) {
                <div class="tools-panel">
                  @if (isLoadingTools(server.id)) {
                    <div class="loading-state small">
                      <mat-spinner diameter="18" />
                      <span>Loading tools...</span>
                    </div>
                  } @else if (toolError(server.id)) {
                    <div class="alert alert-error compact">
                      <mat-icon>error</mat-icon>
                      <span>{{ toolError(server.id) }}</span>
                    </div>
                  } @else if (toolsFor(server.id).length === 0) {
                    <p class="tools-empty text-muted text-sm">
                      This server exposes no tools.
                    </p>
                  } @else {
                    <p class="tools-hint text-muted text-sm">
                      When all tools are enabled, the whole server is available
                      (default). Uncheck tools to restrict this agent to an
                      explicit allowlist.
                    </p>
                    @for (t of toolsFor(server.id); track t.name) {
                      <div class="tool-row">
                        <mat-checkbox
                          [checked]="isToolEnabled(server.name, t.name)"
                          (change)="
                            onToolToggle(
                              server.id,
                              server.name,
                              t.name,
                              $event.checked
                            )
                          "
                          color="primary"
                        />
                        <div class="tool-meta">
                          <div class="tool-name-row">
                            <span class="tool-name">{{ t.name }}</span>
                            @if (hasOverride(server.name, t.name)) {
                              <span class="override-badge">overridden</span>
                            }
                            <button
                              type="button"
                              class="edit-desc-btn"
                              (click)="
                                openEditDescriptionDialog(server.name, t)
                              "
                              title="Edit description"
                            >
                              <mat-icon>edit</mat-icon>
                            </button>
                          </div>
                          <p class="tool-desc">
                            {{ effectiveDescription(server.name, t) }}
                          </p>
                        </div>
                      </div>
                    }
                  }
                </div>
              }
            </article>
          }
        </div>
      }

      @if (error()) {
        <div class="alert alert-error">
          <mat-icon>error</mat-icon>
          <span>{{ error() }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
    :host { display: block; }
    .mcp-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .mcp-header-text { flex: 1; min-width: 200px; }
    .mcp-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .mcp-list { display: flex; flex-direction: column; gap: 12px; }
    .mcp-card { padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06); background: rgba(255, 255, 255, 0.015); transition: all 0.15s ease; }
    .mcp-card:hover { border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.025); }
    .mcp-card-top { display: flex; align-items: flex-start; gap: 10px; }
    .expand-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; background: transparent; color: var(--text3); cursor: pointer; border-radius: 4px; padding: 0; flex-shrink: 0; margin-top: 1px; transition: all 0.15s ease; }
    .expand-btn:hover { color: var(--text-primary); background: rgba(255, 255, 255, 0.06); }
    .expand-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .mcp-info { flex: 1; min-width: 0; }
    .mcp-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .mcp-name { font-weight: 600; font-size: 13.5px; color: var(--text-primary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .transport-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fb923c; background: rgba(251, 146, 60, 0.12); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(251, 146, 60, 0.2); }
    .mcp-url { margin: 0 0 4px; font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .mcp-desc { margin: 0; font-size: 12px; color: var(--text3); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .toggle-label { display: flex; align-items: center; flex-shrink: 0; margin-top: 2px; }
    .tools-panel { margin-top: 12px; padding-top: 12px; padding-left: 34px; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 8px; }
    .tools-hint, .tools-empty { margin: 0 0 4px; }
    .tool-row { display: flex; align-items: flex-start; gap: 10px; }
    .tool-meta { flex: 1; min-width: 0; }
    .tool-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tool-name { font-weight: 600; font-size: 12.5px; color: var(--text-primary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .override-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #ca8a04; background: rgba(250, 204, 21, 0.1); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(250, 204, 21, 0.3); }
    .edit-desc-btn { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; background: transparent; color: var(--text3); cursor: pointer; border-radius: 4px; transition: all 0.15s ease; padding: 0; }
    .edit-desc-btn:hover { color: var(--text-primary); background: rgba(255, 255, 255, 0.06); }
    .edit-desc-btn mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .tool-desc { margin: 2px 0 0; font-size: 11.5px; color: var(--text3); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .loading-state { display: flex; align-items: center; gap: 12px; padding: 24px; color: var(--text3); font-size: 13px; }
    .loading-state.small { padding: 8px 0; gap: 8px; font-size: 12px; }
    .loading-state mat-spinner { flex-shrink: 0; }
    .empty-state { padding: 40px 20px; text-align: center; color: rgba(255, 255, 255, 0.4); border: 2px dashed rgba(255, 255, 255, 0.08); border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.005); }
    .empty-state p { margin: 0; }
    .empty-state mat-icon { margin-bottom: 12px; font-size: 32px; height: 32px; width: 32px; opacity: 0.7; }
    .alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
    .alert.compact { margin-top: 0; padding: 6px 10px; font-size: 12px; }
    .alert-error { background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.2); color: #f87171; }
    .alert-error mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn-ghost { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text3); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
    .btn-ghost:hover:not(:disabled) { border-color: var(--border2); color: var(--text-secondary); background: rgba(255, 255, 255, 0.03); }
    .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { display: inline-flex; align-items: center; gap: 4px; padding: 5px 14px; border-radius: 6px; border: 1px solid var(--primary); background: var(--primary); color: white; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    .btn-primary mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn-primary:hover:not(:disabled) { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    @media (max-width: 720px) { .mcp-header { flex-direction: column; } }
  `,
  ],
})
export class AiMcpServersSelectorComponent {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly agentId = input.required<string>();
  readonly enabledMcpServers = input.required<string[] | null>();
  readonly enabledMcpTools = input<Record<string, string[] | null> | null>(
    null
  );
  readonly toolDescriptionOverrides = input<Record<string, string> | null>(
    null
  );

  readonly serversSaved = output<string[] | null>();
  readonly mcpToolsSaved = output<Record<string, string[] | null> | null>();
  readonly toolDescriptionsSaved = output<Record<string, string> | null>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal("");
  readonly toggles = signal<IMcpServerToggle[]>([]);
  private initialSnapshot = "";

  // ---- Per-tool state ----
  /** Expanded server IDs. */
  private readonly expanded = signal<Set<string>>(new Set());
  /** Tools fetched per server ID (lazy, on first expand). */
  private readonly toolsByServer = signal<Record<string, IMcpServerTool[]>>({});
  private readonly toolsLoading = signal<Set<string>>(new Set());
  private readonly toolErrors = signal<Record<string, string>>({});
  /**
   * Working per-tool allowlist, keyed by server NAME. `null` (or a missing
   * key) = all tools enabled for that server (the default). An array is an
   * explicit allowlist of enabled tool names.
   */
  private readonly mcpToolsMap = signal<Record<string, string[] | null>>({});
  private initialToolsSnapshot = "";

  // ---- Description overrides ----
  /** Full working overrides map (all keys, including non-MCP), keyed as saved. */
  private readonly overrides = signal<Record<string, string>>({});

  readonly hasServerChanges = computed(() => {
    const current = this.toggles()
      .filter((t) => t.enabled)
      .map((t) => t.name)
      .sort()
      .join(",");
    return current !== this.initialSnapshot;
  });

  readonly hasToolChanges = computed(
    () =>
      this.serializeToolsMap(this.mcpToolsMap()) !== this.initialToolsSnapshot
  );

  readonly hasChanges = computed(
    () => this.hasServerChanges() || this.hasToolChanges()
  );

  constructor() {
    this.overrides.set({ ...(this.toolDescriptionOverrides() ?? {}) });
    this.mcpToolsMap.set({ ...(this.enabledMcpTools() ?? {}) });
    this.initialToolsSnapshot = this.serializeToolsMap(this.mcpToolsMap());
    this.loadMcpServers();
  }

  private loadMcpServers(): void {
    this.loading.set(true);
    this.error.set("");

    this.agentAdminService.listMcpServers().subscribe({
      next: (servers) => {
        const enabledNames = this.enabledMcpServers();
        const toggles: IMcpServerToggle[] = servers
          .filter((s) => s.is_active)
          .map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description ?? "",
            url: s.url,
            transport_type: s.transport_type,
            enabled:
              enabledNames === null ? true : enabledNames.includes(s.name),
          }));
        this.toggles.set(toggles);
        this.captureSnapshot(toggles);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Failed to load MCP servers.");
        this.loading.set(false);
      },
    });
  }

  private captureSnapshot(toggles: IMcpServerToggle[]): void {
    this.initialSnapshot = toggles
      .filter((t) => t.enabled)
      .map((t) => t.name)
      .sort()
      .join(",");
  }

  private serializeToolsMap(map: Record<string, string[] | null>): string {
    const entries = Object.entries(map)
      .filter(([, v]) => Array.isArray(v)) // null = default, ignore
      .map(([k, v]) => [k, [...(v as string[])].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(entries);
  }

  // ---- Server-level ----

  onToggle(id: string, checked: boolean): void {
    this.toggles.update((toggles) =>
      toggles.map((t) => (t.id === id ? { ...t, enabled: checked } : t))
    );
  }

  selectAll(): void {
    this.toggles.update((toggles) =>
      toggles.map((t) => ({ ...t, enabled: true }))
    );
  }

  deselectAll(): void {
    this.toggles.update((toggles) =>
      toggles.map((t) => ({ ...t, enabled: false }))
    );
  }

  // ---- Expand / tool loading ----

  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  toggleExpanded(id: string): void {
    const next = new Set(this.expanded());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (this.toolsByServer()[id] === undefined) {
        this.loadTools(id);
      }
    }
    this.expanded.set(next);
  }

  private loadTools(id: string): void {
    const loadingSet = new Set(this.toolsLoading());
    loadingSet.add(id);
    this.toolsLoading.set(loadingSet);
    this.toolErrors.update((e) => {
      const { [id]: _removed, ...rest } = e;
      return rest;
    });

    this.agentAdminService.listMcpServerTools(id).subscribe({
      next: (tools) => {
        this.toolsByServer.update((m) => ({ ...m, [id]: tools }));
        this.clearToolLoading(id);
      },
      error: () => {
        this.toolErrors.update((e) => ({
          ...e,
          [id]: "Failed to load tools from this server.",
        }));
        this.toolsByServer.update((m) => ({ ...m, [id]: [] }));
        this.clearToolLoading(id);
      },
    });
  }

  private clearToolLoading(id: string): void {
    const loadingSet = new Set(this.toolsLoading());
    loadingSet.delete(id);
    this.toolsLoading.set(loadingSet);
  }

  isLoadingTools(id: string): boolean {
    return this.toolsLoading().has(id);
  }

  toolError(id: string): string | undefined {
    return this.toolErrors()[id];
  }

  toolsFor(id: string): IMcpServerTool[] {
    return this.toolsByServer()[id] ?? [];
  }

  // ---- Per-tool selection ----

  isToolEnabled(serverName: string, toolName: string): boolean {
    const allow = this.mcpToolsMap()[serverName];
    if (allow === undefined || allow === null) {
      return true; // all tools enabled (default)
    }
    return allow.includes(toolName);
  }

  onToolToggle(
    serverId: string,
    serverName: string,
    toolName: string,
    checked: boolean
  ): void {
    const allToolNames = this.toolsFor(serverId).map((t) => t.name);
    const map = { ...this.mcpToolsMap() };
    const existing = map[serverName];

    // Materialize the current allowlist. `null`/missing means "all enabled".
    const enabledSet = new Set(
      existing === undefined || existing === null ? allToolNames : existing
    );

    if (checked) {
      enabledSet.add(toolName);
    } else {
      enabledSet.delete(toolName);
    }

    // Keep only known tool names, preserving server order.
    const next = allToolNames.filter((n) => enabledSet.has(n));

    // Normalize: when every tool is enabled, fall back to the default (null).
    if (next.length === allToolNames.length) {
      map[serverName] = null;
    } else {
      map[serverName] = next;
    }
    this.mcpToolsMap.set(map);
  }

  // ---- Description overrides ----

  hasOverride(serverName: string, toolName: string): boolean {
    const key = `${serverName}:${toolName}`;
    return typeof this.overrides()[key] === "string";
  }

  effectiveDescription(serverName: string, tool: IMcpServerTool): string {
    const key = `${serverName}:${tool.name}`;
    return this.overrides()[key] ?? tool.description ?? "No description";
  }

  openEditDescriptionDialog(serverName: string, tool: IMcpServerTool): void {
    const key = `${serverName}:${tool.name}`;
    const defaultDesc = tool.description ?? "";
    const currentOverride = this.overrides()[key] ?? "";

    const dialogRef = this.dialog.open(EditDescriptionDialogComponent, {
      width: "520px",
      data: {
        toolName: `${serverName}:${tool.name}`,
        defaultDescription: defaultDesc,
        currentOverride,
      },
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (result === undefined) {
        return; // cancelled
      }

      const newOverrides = { ...this.overrides() };
      if (result === "") {
        delete newOverrides[key];
      } else {
        newOverrides[key] = result.trim();
      }

      const payload =
        Object.keys(newOverrides).length > 0 ? newOverrides : null;

      this.saving.set(true);
      this.error.set("");

      this.agentAdminService
        .updateToolDescriptionOverrides(this.agentId(), payload)
        .subscribe({
          next: () => {
            this.overrides.set(newOverrides);
            this.toolDescriptionsSaved.emit(payload);
            this.saving.set(false);
            this.snackBar.open(
              result
                ? "Description updated successfully."
                : "Description reset to default.",
              undefined,
              { duration: 2000 }
            );
          },
          error: () => {
            this.error.set("Failed to save description override.");
            this.saving.set(false);
          },
        });
    });
  }

  // ---- Save ----

  private buildMcpToolsPayload(): Record<string, string[] | null> | null {
    const map = this.mcpToolsMap();
    const out: Record<string, string[]> = {};
    for (const [serverName, allow] of Object.entries(map)) {
      if (Array.isArray(allow)) {
        out[serverName] = allow; // explicit allowlist
      }
      // null / undefined = all tools enabled → omit (server default)
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  save(): void {
    const agentId = this.agentId();
    const toggles = this.toggles();

    const enabledNames = toggles.filter((t) => t.enabled).map((t) => t.name);
    const allEnabled = toggles.every((t) => t.enabled);
    const serverPayload = allEnabled ? null : enabledNames;
    const toolsPayload = this.buildMcpToolsPayload();

    const serversChanged = this.hasServerChanges();
    const toolsChanged = this.hasToolChanges();

    this.saving.set(true);
    this.error.set("");

    const finalize = () => {
      this.saving.set(false);
      this.captureSnapshot(this.toggles());
      this.initialToolsSnapshot = this.serializeToolsMap(this.mcpToolsMap());
      this.snackBar.open("MCP configuration updated successfully.", undefined, {
        duration: 3000,
      });
    };

    const saveTools = () => {
      if (!toolsChanged) {
        finalize();
        return;
      }
      this.agentAdminService
        .updateEnabledMcpTools(agentId, toolsPayload)
        .subscribe({
          next: () => {
            this.mcpToolsSaved.emit(toolsPayload);
            finalize();
          },
          error: () => {
            this.error.set("Failed to save per-tool MCP configuration.");
            this.saving.set(false);
          },
        });
    };

    if (serversChanged) {
      this.agentAdminService
        .updateEnabledMcpServers(agentId, serverPayload)
        .subscribe({
          next: () => {
            this.serversSaved.emit(serverPayload);
            saveTools();
          },
          error: () => {
            this.error.set("Failed to save MCP server configuration.");
            this.saving.set(false);
          },
        });
    } else {
      saveTools();
    }
  }
}
