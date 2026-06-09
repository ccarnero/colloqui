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
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import type { IMcpServer } from "../../../core/models/agent.model";

export interface IMcpServerToggle {
  id: string;
  name: string;
  description: string;
  url: string;
  transport_type: string;
  enabled: boolean;
}

@Component({
  selector: "app-ai-mcp-servers-selector",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
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
            Toggle servers on or off, then save your changes.
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
        <div class="mcp-grid">
          @for (server of toggles(); track server.id) {
            <article class="mcp-card">
              <div class="mcp-card-top">
                <div class="mcp-info">
                  <div class="mcp-name-row">
                    <span class="mcp-name">{{ server.name }}</span>
                    <span class="transport-badge">{{ server.transport_type }}</span>
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
    .mcp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
    .mcp-card { padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06); background: rgba(255, 255, 255, 0.015); transition: all 0.15s ease; }
    .mcp-card:hover { border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.025); }
    .mcp-card-top { display: flex; align-items: flex-start; gap: 12px; }
    .mcp-info { flex: 1; min-width: 0; }
    .mcp-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .mcp-name { font-weight: 600; font-size: 13.5px; color: var(--text-primary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .transport-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fb923c; background: rgba(251, 146, 60, 0.12); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(251, 146, 60, 0.2); }
    .mcp-url { margin: 0 0 4px; font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .mcp-desc { margin: 0; font-size: 12px; color: var(--text3); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .toggle-label { display: flex; align-items: center; flex-shrink: 0; margin-top: 2px; }
    .loading-state { display: flex; align-items: center; gap: 12px; padding: 24px; color: var(--text3); font-size: 13px; }
    .loading-state mat-spinner { flex-shrink: 0; }
    .empty-state { padding: 40px 20px; text-align: center; color: rgba(255, 255, 255, 0.4); border: 2px dashed rgba(255, 255, 255, 0.08); border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.005); }
    .empty-state p { margin: 0; }
    .empty-state mat-icon { margin-bottom: 12px; font-size: 32px; height: 32px; width: 32px; opacity: 0.7; }
    .alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
    .alert-error { background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.2); color: #f87171; }
    .alert-error mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn-ghost { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text3); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
    .btn-ghost:hover:not(:disabled) { border-color: var(--border2); color: var(--text-secondary); background: rgba(255, 255, 255, 0.03); }
    .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { display: inline-flex; align-items: center; gap: 4px; padding: 5px 14px; border-radius: 6px; border: 1px solid var(--primary); background: var(--primary); color: white; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    .btn-primary mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn-primary:hover:not(:disabled) { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    @media (max-width: 720px) { .mcp-header { flex-direction: column; } .mcp-grid { grid-template-columns: 1fr; } }
  `,
  ],
})
export class AiMcpServersSelectorComponent {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly snackBar = inject(MatSnackBar);

  readonly agentId = input.required<string>();
  readonly enabledMcpServers = input.required<string[] | null>();

  readonly serversSaved = output<string[] | null>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal("");
  readonly toggles = signal<IMcpServerToggle[]>([]);
  private initialSnapshot: string = "";

  readonly hasChanges = computed(() => {
    const current = this.toggles()
      .filter((t) => t.enabled)
      .map((t) => t.id)
      .sort()
      .join(",");
    return current !== this.initialSnapshot;
  });

  constructor() {
    this.loadMcpServers();
  }

  private loadMcpServers(): void {
    this.loading.set(true);
    this.error.set("");

    this.agentAdminService.listMcpServers().subscribe({
      next: (servers) => {
        const enabledIds = this.enabledMcpServers();
        const toggles: IMcpServerToggle[] = servers
          .filter((s) => s.is_active)
          .map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description ?? "",
            url: s.url,
            transport_type: s.transport_type,
            enabled: enabledIds === null ? true : enabledIds.includes(s.id),
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
      .map((t) => t.id)
      .sort()
      .join(",");
  }

  onToggle(id: string, checked: boolean): void {
    this.toggles.update((toggles) =>
      toggles.map((t) => (t.id === id ? { ...t, enabled: checked } : t)),
    );
  }

  selectAll(): void {
    this.toggles.update((toggles) =>
      toggles.map((t) => ({ ...t, enabled: true })),
    );
  }

  deselectAll(): void {
    this.toggles.update((toggles) =>
      toggles.map((t) => ({ ...t, enabled: false })),
    );
  }

  save(): void {
    const agentId = this.agentId();
    const toggles = this.toggles();

    const enabledIds = toggles.filter((t) => t.enabled).map((t) => t.id);
    const allEnabled = toggles.every((t) => t.enabled);
    const payload = allEnabled ? null : enabledIds;

    this.saving.set(true);
    this.error.set("");

    this.agentAdminService.updateEnabledMcpServers(agentId, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.captureSnapshot(this.toggles());
        this.serversSaved.emit(payload);
        this.snackBar.open("MCP servers updated successfully.", undefined, {
          duration: 3000,
        });
      },
      error: () => {
        this.error.set("Failed to save MCP server configuration.");
        this.saving.set(false);
      },
    });
  }
}
