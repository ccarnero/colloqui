import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { AgentAdminService } from "../../core/services/agent-admin.service";
import type { IMcpServer } from "../../core/models/agent.model";

@Component({
  selector: "app-mcp-servers-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div class="page-header-start">
          <h1>MCP Servers</h1>
          <p class="text-secondary">
            Manage Model Context Protocol server connections for your agents.
            MCP servers provide tools and data that agents can use at runtime.
          </p>
        </div>
        <button class="btn btn-primary btn-sm" type="button" (click)="openForm(null)">
          <mat-icon>add</mat-icon>
          Add MCP Server
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="24" />
          <span>Loading MCP servers...</span>
        </div>
      }

      @if (!loading() && servers().length === 0) {
        <div class="empty-state">
          <mat-icon>hub</mat-icon>
          <h3>No MCP servers yet</h3>
          <p>
            Configure your first MCP server to enable agents to access external
            tools via the Model Context Protocol.
          </p>
          <button class="btn btn-primary btn-sm" type="button" (click)="openForm(null)">
            <mat-icon>add</mat-icon>
            Add MCP Server
          </button>
        </div>
      }

      @if (servers().length > 0) {
        <div class="server-grid">
          @for (server of servers(); track server.id) {
            <article class="server-card" [class.disabled]="!server.is_active">
              <div class="server-card-header">
                <div class="server-name-row">
                  <span class="server-icon">
                    <mat-icon>hub</mat-icon>
                  </span>
                  <div class="server-info">
                    <strong>{{ server.name }}</strong>
                    <span class="server-url">{{ server.url }}</span>
                  </div>
                  <span
                    class="transport-tag"
                    [class.sse]="server.transport_type === 'sse'"
                  >
                    {{ server.transport_type }}
                  </span>
                </div>
              </div>
              @if (server.description) {
                <p class="server-desc">{{ server.description }}</p>
              }
              <div class="server-card-footer">
                <span
                  class="status-badge"
                  [class.active]="server.enabled && server.is_active"
                >
                  {{ server.enabled && server.is_active ? "Enabled" : "Disabled" }}
                </span>
                <div class="server-actions">
                  <button class="icon-btn" (click)="openForm(server)" title="Edit">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button class="icon-btn danger" (click)="deleteServer(server)" title="Delete">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
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

    <!-- Inline form dialog (modal backdrop) -->
    @if (showForm()) {
      <div class="modal-backdrop" (click)="closeForm()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h2>{{ editingServer() ? "Edit MCP Server" : "Add MCP Server" }}</h2>
            <button type="button" class="icon-btn" (click)="closeForm()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Name *</label>
              <input
                class="form-input"
                [(ngModel)]="formData.name"
                placeholder="e.g., Production MCP"
              />
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <input
                class="form-input"
                [(ngModel)]="formData.description"
                placeholder="Optional description"
              />
            </div>
            <div class="form-group">
              <label class="form-label">Transport Type *</label>
              <select class="form-input" [(ngModel)]="formData.transport_type">
                <option value="http">HTTP</option>
                <option value="sse">SSE (Server-Sent Events)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">URL *</label>
              <input
                class="form-input"
                [(ngModel)]="formData.url"
                placeholder="https://mcp-server.example.com/sse"
              />
            </div>
            <div class="form-group">
              <label class="form-label">Headers (JSON)</label>
              <textarea
                class="form-input form-textarea"
                [(ngModel)]="formData.headersStr"
                placeholder='{"Authorization": "Bearer token"}'
              ></textarea>
            </div>
            <div class="form-group">
              <label class="form-check">
                <input type="checkbox" [(ngModel)]="formData.enabled" />
                <span>Enable this server</span>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" type="button" (click)="closeForm()">
              Cancel
            </button>
            <button
              class="btn btn-primary"
              type="button"
              (click)="saveForm()"
              [disabled]="formSaving() || !formData.name || !formData.url"
            >
              @if (formSaving()) {
                <mat-spinner diameter="16" />
              } @else {
                {{ editingServer() ? "Update" : "Create" }}
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
    .page-container { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .page-header h1 { margin: 0; font-size: 22px; }
    .page-header p { margin: 4px 0 0; font-size: 13px; max-width: 500px; }
    .loading-state { display: flex; align-items: center; gap: 12px; padding: 40px; justify-content: center; color: var(--text3); }
    .empty-state { text-align: center; padding: 60px 20px; border: 2px dashed rgba(255,255,255,0.08); border-radius: 12px; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px; }
    .empty-state h3 { margin: 0 0 8px; font-size: 16px; }
    .empty-state p { margin: 0 0 16px; color: var(--text-secondary); font-size: 13px; max-width: 400px; margin-left: auto; margin-right: auto; }
    .server-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
    .server-card { background: var(--bg2); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .server-card.disabled { opacity: 0.6; }
    .server-name-row { display: flex; align-items: center; gap: 10px; }
    .server-icon { width: 32px; height: 32px; border-radius: 8px; background: rgba(251, 146, 60, 0.12); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .server-icon mat-icon { font-size: 18px; width: 18px; height: 18px; color: #fb923c; }
    .server-info { flex: 1; min-width: 0; }
    .server-info strong { font-size: 14px; display: block; }
    .server-url { font-size: 11px; color: var(--text-muted); font-family: monospace; }
    .transport-tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 4px; background: rgba(251, 146, 60, 0.12); color: #fb923c; }
    .transport-tag.sse { background: rgba(99, 102, 241, 0.12); color: #818cf8; }
    .server-desc { margin: 0; font-size: 12px; color: var(--text-secondary); }
    .server-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
    .status-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.04); color: var(--text-muted); }
    .status-badge.active { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
    .server-actions { display: flex; gap: 4px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; }
    .icon-btn:hover { border-color: var(--border-subtle); color: var(--text-primary); }
    .icon-btn.danger:hover { border-color: rgba(248,113,113,0.3); color: #f87171; }
    .icon-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .alert { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
    .alert-error { background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.2); color: #f87171; }
    .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--primary); background: var(--primary); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-primary mat-spinner { margin: 0; }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; }
    .btn-ghost { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text3); font-size: 12px; cursor: pointer; }
    .btn-ghost:hover { border-color: var(--border2); color: var(--text-secondary); }
    .modal-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; width: 480px; max-width: 90vw; max-height: 80vh; overflow: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); }
    .modal-header h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border-subtle); }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .form-input { padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg2); color: var(--text-primary); font-size: 13px; font-family: inherit; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .form-textarea { min-height: 60px; resize: vertical; font-family: monospace; }
    .form-check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
    `,
  ],
})
export class McpServersPageComponent implements OnInit {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly snackBar = inject(MatSnackBar);

  readonly servers = signal<IMcpServer[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal("");
  readonly showForm = signal(false);
  readonly editingServer = signal<IMcpServer | null>(null);
  readonly formSaving = signal(false);

  formData = {
    name: "",
    description: "",
    transport_type: "http" as "http" | "sse",
    url: "",
    headersStr: "",
    enabled: true,
  };

  ngOnInit(): void {
    this.loadServers();
  }

  private loadServers(): void {
    this.loading.set(true);
    this.agentAdminService.listMcpServers().subscribe({
      next: (servers) => {
        this.servers.set(servers);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Failed to load MCP servers.");
        this.loading.set(false);
      },
    });
  }

  openForm(server: IMcpServer | null): void {
    if (server) {
      this.editingServer.set(server);
      this.formData = {
        name: server.name,
        description: server.description ?? "",
        transport_type: server.transport_type,
        url: server.url,
        headersStr: server.headers ? JSON.stringify(server.headers, null, 2) : "",
        enabled: server.enabled,
      };
    } else {
      this.editingServer.set(null);
      this.formData = {
        name: "",
        description: "",
        transport_type: "http",
        url: "",
        headersStr: "",
        enabled: true,
      };
    }
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingServer.set(null);
  }

  saveForm(): void {
    if (!this.formData.name || !this.formData.url) return;
    this.formSaving.set(true);
    this.error.set("");

    let headers: Record<string, string> | undefined;
    if (this.formData.headersStr.trim()) {
      try {
        headers = JSON.parse(this.formData.headersStr);
      } catch {
        this.error.set("Invalid JSON in headers field.");
        this.formSaving.set(false);
        return;
      }
    }

    const data = {
      name: this.formData.name,
      description: this.formData.description || undefined,
      transport_type: this.formData.transport_type,
      url: this.formData.url,
      headers,
      enabled: this.formData.enabled,
    };

    const editId = this.editingServer()?.id;

    const request = editId
      ? this.agentAdminService.updateMcpServer(editId, data)
      : this.agentAdminService.createMcpServer(data);

    request.subscribe({
      next: () => {
        this.formSaving.set(false);
        this.closeForm();
        this.snackBar.open(
          editId ? "MCP server updated." : "MCP server created.",
          undefined,
          { duration: 2000 },
        );
        this.loadServers();
      },
      error: () => {
        this.error.set("Failed to save MCP server.");
        this.formSaving.set(false);
      },
    });
  }

  deleteServer(server: IMcpServer): void {
    if (!confirm(`Delete MCP server "${server.name}"?`)) return;
    this.error.set("");

    this.agentAdminService.deleteMcpServer(server.id).subscribe({
      next: () => {
        this.servers.update((s) => s.filter((x) => x.id !== server.id));
        this.snackBar.open("MCP server deleted.", undefined, {
          duration: 2000,
        });
      },
      error: () => {
        this.error.set("Failed to delete MCP server.");
      },
    });
  }
}
