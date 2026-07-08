import { HttpErrorResponse } from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatTableModule } from "@angular/material/table";
import { MatTooltipModule } from "@angular/material/tooltip";
import { Router } from "@angular/router";
import type {
  IManagedMcpServerConflict,
  IMcpServer,
} from "../../core/models/agent.model";
import { AgentAdminService } from "../../core/services/agent-admin.service";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../shared/components/confirm-dialog/confirm-dialog.component";
import { McpServerDialogComponent } from "../../shared/components/mcp-server-dialog/mcp-server-dialog.component";
import type {
  IMcpServerDialogData,
  IMcpServerDialogResult,
} from "../../shared/components/mcp-server-dialog/mcp-server-dialog.types";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { StatusBadgeComponent } from "../../shared/components/status-badge/status-badge.component";

/** Per-row, on-demand tool-count probe state — never fetched for every row on load (mcp-connections.md §6.2). */
interface IToolsProbeState {
  loading: boolean;
  count?: number;
  error?: boolean;
}

type TransportFilter = "" | "http" | "sse";
type StatusFilter = "" | "enabled" | "disabled";

/**
 * MCP Servers list — Material table replacing the old card grid
 * (mcp-connections.md §6.2), mirroring `connectors.component.ts`'s
 * structure: filter chips, "Synced" badge for managed rows, row actions
 * View/Edit/Delete, structured-409 explanation for managed-row deletes.
 */
@Component({
  selector: "app-mcp-servers-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    PageHeaderComponent,
    StatusBadgeComponent,
  ],
  template: `
    <app-page-header
      title="MCP Servers"
      subtitle="Model Context Protocol server connections for your agents"
    >
      <ng-container slot="actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          Add MCP Server
        </button>
      </ng-container>
    </app-page-header>

    @if (actionError(); as err) {
      <div class="mcp-alert" role="alert">
        <mat-icon class="mcp-alert-icon">lock</mat-icon>
        <div class="mcp-alert-body">
          <div class="mcp-alert-title">{{ err.title }}</div>
          <div class="mcp-alert-msg">{{ err.message }}</div>
          @if (err.editableFields?.length) {
            <div class="mcp-alert-fields">
              Editable here: {{ err.editableFields!.join(", ") }}
            </div>
          }
        </div>
        <button
          type="button"
          mat-icon-button
          aria-label="Dismiss"
          (click)="dismissError()"
        >
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }

    <div class="filter-bar">
      <mat-chip-listbox
        [value]="transportFilter()"
        (change)="onTransportFilter($event.value)"
        class="chip-filter"
        aria-label="Filter by transport type"
      >
        <mat-chip-option value="">All transports</mat-chip-option>
        <mat-chip-option value="http">HTTP</mat-chip-option>
        <mat-chip-option value="sse">SSE</mat-chip-option>
      </mat-chip-listbox>
      <mat-chip-listbox
        [value]="statusFilter()"
        (change)="onStatusFilter($event.value)"
        class="chip-filter"
        aria-label="Filter by status"
      >
        <mat-chip-option value="">All statuses</mat-chip-option>
        <mat-chip-option value="enabled">Enabled</mat-chip-option>
        <mat-chip-option value="disabled">Disabled</mat-chip-option>
      </mat-chip-listbox>
    </div>

    @if (loading()) {
      <div style="display:flex;justify-content:center;padding:2rem">
        <mat-spinner diameter="36" />
      </div>
    } @else if (filteredServers().length === 0) {
      <div class="empty-state">
        <mat-icon>hub</mat-icon>
        <h3>No MCP servers yet</h3>
        <p>
          Configure your first MCP server to enable agents to access external
          tools via the Model Context Protocol.
        </p>
        <button class="btn btn-primary btn-sm" type="button" (click)="openCreate()">
          <mat-icon>add</mat-icon>
          Add MCP Server
        </button>
      </div>
    } @else {
      <div class="table-wrap">
        <table mat-table [dataSource]="filteredServers()">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Name</th>
            <td mat-cell *matCellDef="let r">
              <div class="name-cell">
                <mat-icon class="name-icon">hub</mat-icon>
                <span>{{ r.name }}</span>
                @if (r.managed_by) {
                  <span
                    class="badge badge-synced"
                    [matTooltip]="
                      'Synced from ' +
                      r.managed_by +
                      ' — name, URL and transport type are managed automatically'
                    "
                  >
                    <mat-icon class="synced-icon">sync</mat-icon>
                    Synced
                  </span>
                }
              </div>
            </td>
          </ng-container>
          <ng-container matColumnDef="transport">
            <th mat-header-cell *matHeaderCellDef>Transport</th>
            <td mat-cell *matCellDef="let r">
              <span class="badge badge-orange">{{ r.transport_type }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="url">
            <th mat-header-cell *matHeaderCellDef>URL</th>
            <td mat-cell *matCellDef="let r" class="url-cell">
              {{ r.url }}
            </td>
          </ng-container>
          <ng-container matColumnDef="auth">
            <th mat-header-cell *matHeaderCellDef>Auth</th>
            <td mat-cell *matCellDef="let r">
              <span class="badge badge-blue">{{ r.auth_type }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let r">
              <app-status-badge
                [status]="r.enabled && r.is_active ? 'active' : 'inactive'"
              />
            </td>
          </ng-container>
          <ng-container matColumnDef="tools">
            <th mat-header-cell *matHeaderCellDef>Tools</th>
            <td mat-cell *matCellDef="let r">
              @if (toolsState()[r.id]?.loading) {
                <mat-spinner diameter="14" />
              } @else if (toolsState()[r.id]?.error) {
                <button
                  type="button"
                  class="btn-link"
                  (click)="loadToolCount(r); $event.stopPropagation()"
                >
                  Retry
                </button>
              } @else if (toolsState()[r.id]?.count !== undefined) {
                <span class="badge badge-purple">
                  {{ toolsState()[r.id]?.count }}
                </span>
              } @else {
                <button
                  type="button"
                  class="btn-link"
                  (click)="loadToolCount(r); $event.stopPropagation()"
                >
                  Load
                </button>
              }
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Actions</th>
            <td mat-cell *matCellDef="let r">
              <button
                type="button"
                mat-icon-button
                aria-label="View"
                (click)="view(r.id); $event.stopPropagation()"
              >
                <mat-icon>visibility</mat-icon>
              </button>
              <button
                type="button"
                mat-icon-button
                aria-label="Edit"
                (click)="openEdit(r); $event.stopPropagation()"
              >
                <mat-icon>edit</mat-icon>
              </button>
              <button
                type="button"
                mat-icon-button
                [attr.aria-label]="r.managed_by ? 'Delete (managed)' : 'Delete'"
                [class.is-managed]="r.managed_by"
                [matTooltip]="
                  r.managed_by
                    ? 'Synced server — managed by ' +
                      r.managed_by +
                      '. Cannot be deleted here.'
                    : 'Delete server'
                "
                (click)="remove(r); $event.stopPropagation()"
              >
                <mat-icon>{{ r.managed_by ? "lock" : "delete" }}</mat-icon>
              </button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="cols"></tr>
          <tr
            mat-row
            *matRowDef="let row; columns: cols"
            (click)="view(row.id)"
            role="button"
            tabindex="0"
            (keydown.enter)="view(row.id)"
            (keydown.space)="view(row.id)"
            [attr.aria-label]="'View ' + row.name"
            class="clickable-row"
          ></tr>
        </table>
      </div>
    }
  `,
  styles: [
    `
    :host { display: block; padding: 24px; }
    .filter-bar { display: flex; gap: 16px; flex-wrap: wrap; padding: 0 0 12px; }
    .chip-filter { font-size: 12px; }
    .empty-state { text-align: center; padding: 60px 20px; border: 2px dashed rgba(255,255,255,0.08); border-radius: 12px; }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px; }
    .empty-state h3 { margin: 0 0 8px; font-size: 16px; }
    .empty-state p { margin: 0 0 16px; color: var(--text-secondary); font-size: 13px; max-width: 400px; margin-left: auto; margin-right: auto; }
    .name-cell { display: flex; align-items: center; gap: 8px; }
    .name-icon { font-size: 18px; width: 18px; height: 18px; color: var(--text3); }
    .url-cell { font-family: monospace; color: var(--cyan); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
    .badge-orange { background: rgba(251, 146, 60, 0.12); color: #fb923c; }
    .badge-blue { background: color-mix(in srgb, var(--accent, #4f7ef8) 18%, transparent); color: var(--accent, #4f7ef8); }
    .badge-purple { background: color-mix(in srgb, var(--purple, #a855f7) 18%, transparent); color: var(--purple, #a855f7); }
    .badge-synced { display: inline-flex; align-items: center; gap: 4px; background: rgba(14, 165, 233, 0.12); color: #0ea5e9; }
    .synced-icon { font-size: 13px; width: 13px; height: 13px; }
    .is-managed { color: var(--text3); }
    .clickable-row { cursor: pointer; transition: background-color 0.12s; }
    .clickable-row:hover { background-color: rgba(255,255,255,0.07); }
    tbody td { padding: 12px 8px; }
    tbody tr { border-bottom: 1px solid rgba(255,255,255,0.05); }
    .btn-link { background: none; border: none; color: var(--accent, #4f7ef8); font-size: 12px; cursor: pointer; padding: 0; }
    .btn-link:hover { text-decoration: underline; }
    .mcp-alert { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 12px; padding: 12px 14px; border: 1px solid rgba(239, 68, 68, 0.4); border-left: 3px solid #ef4444; border-radius: var(--radius, 6px); background: rgba(239, 68, 68, 0.08); }
    .mcp-alert-icon { color: #ef4444; font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; margin-top: 1px; }
    .mcp-alert-body { flex: 1; min-width: 0; }
    .mcp-alert-title { font-weight: 600; color: var(--text, #e5e7eb); margin-bottom: 2px; }
    .mcp-alert-msg { font-size: 12px; color: var(--text2, #cbd5e1); line-height: 1.5; }
    .mcp-alert-fields { font-size: 11px; color: var(--text3, #94a3b8); margin-top: 6px; }
    .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--primary); background: var(--primary); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; }
    `,
  ],
})
export class McpServersPageComponent implements OnInit {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  readonly cols = [
    "name",
    "transport",
    "url",
    "auth",
    "status",
    "tools",
    "actions",
  ] as const;

  readonly servers = signal<IMcpServer[]>([]);
  readonly loading = signal(true);
  readonly transportFilter = signal<TransportFilter>("");
  readonly statusFilter = signal<StatusFilter>("");
  readonly toolsState = signal<Record<string, IToolsProbeState>>({});
  readonly actionError = signal<{
    title: string;
    message: string;
    editableFields?: string[];
  } | null>(null);

  readonly filteredServers = computed(() => {
    const transport = this.transportFilter();
    const status = this.statusFilter();
    return this.servers().filter((s) => {
      if (transport && s.transport_type !== transport) {
        return false;
      }
      const isEnabled = s.enabled && s.is_active;
      if (status === "enabled" && !isEnabled) {
        return false;
      }
      if (status === "disabled" && isEnabled) {
        return false;
      }
      return true;
    });
  });

  ngOnInit(): void {
    this.loadServers();
  }

  onTransportFilter(value: TransportFilter): void {
    this.transportFilter.set(value ?? "");
  }

  onStatusFilter(value: StatusFilter): void {
    this.statusFilter.set(value ?? "");
  }

  view(id: string): void {
    void this.router.navigate(["/connections/mcp", id]);
  }

  /**
   * Fetches the tool count on demand for one row — never all rows on page
   * load (mcp-connections.md §6.2 explicitly flags bulk fetch as a stampede
   * risk against the live MCP servers).
   */
  loadToolCount(server: IMcpServer): void {
    this.toolsState.update((state) => ({
      ...state,
      [server.id]: { loading: true },
    }));
    this.agentAdminService.listMcpServerTools(server.id).subscribe({
      next: (tools) => {
        this.toolsState.update((state) => ({
          ...state,
          [server.id]: { loading: false, count: tools.length },
        }));
      },
      error: () => {
        this.toolsState.update((state) => ({
          ...state,
          [server.id]: { loading: false, error: true },
        }));
      },
    });
  }

  openCreate(): void {
    const data: IMcpServerDialogData = { mode: "create" };
    this.dialog
      .open(McpServerDialogComponent, {
        data,
        width: "720px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result?: IMcpServerDialogResult) => {
        if (!result) {
          return;
        }
        this.dismissError();
        this.agentAdminService
          .createMcpServer({
            name: result.name,
            description: result.description,
            transport_type: result.transport_type,
            url: result.url,
            headers: result.headers,
            authType: result.authType,
            authConfig: result.authConfig,
            enabled: result.enabled,
          })
          .subscribe({
            next: (server) => {
              this.servers.update((rows) => [...rows, server]);
              this.snackBar.open("MCP server created.", undefined, {
                duration: 2000,
              });
            },
            error: (err: unknown) =>
              this.reportError(err, "Couldn't create MCP server"),
          });
      });
  }

  openEdit(server: IMcpServer): void {
    const data: IMcpServerDialogData = { mode: "edit", server };
    this.dialog
      .open(McpServerDialogComponent, {
        data,
        width: "720px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result?: IMcpServerDialogResult) => {
        if (!result) {
          return;
        }
        this.dismissError();

        // Managed servers: never send registry-owned fields — the backend
        // rejects them with a 409 anyway (mcp-connections.md §2.3).
        const editable: Parameters<
          typeof this.agentAdminService.updateMcpServer
        >[1] = {
          description: result.description ?? null,
          headers: result.headers ?? null,
          authType: result.authType,
          authConfig: result.authConfig ?? null,
          enabled: result.enabled,
        };
        const payload = server.managed_by
          ? editable
          : {
              ...editable,
              name: result.name,
              transport_type: result.transport_type,
              url: result.url,
            };

        this.agentAdminService.updateMcpServer(server.id, payload).subscribe({
          next: (updated) => {
            this.servers.update((rows) =>
              rows.map((r) => (r.id === server.id ? updated : r))
            );
            this.snackBar.open("MCP server updated.", undefined, {
              duration: 2000,
            });
          },
          error: (err: unknown) =>
            this.reportError(err, "Couldn't save changes"),
        });
      });
  }

  remove(server: IMcpServer): void {
    // Managed servers can't be deleted — explain why up front instead of
    // round-tripping to a guaranteed 409, mirroring connectors.component.ts.
    if (server.managed_by) {
      this.actionError.set({
        title: "This MCP server can't be deleted here",
        message:
          `"${server.name}" is synced from ${server.managed_by} and would be ` +
          `recreated automatically on the next sync. To remove it, delete the ` +
          `source service from the registry instead.`,
      });
      return;
    }

    const data: IConfirmDialogData = {
      title: "Delete MCP server",
      message: `Delete "${server.name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      icon: "warning_amber",
    };
    this.dialog
      .open<ConfirmDialogComponent, IConfirmDialogData, boolean>(
        ConfirmDialogComponent,
        { data, autoFocus: false, restoreFocus: true }
      )
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) {
          this.deleteServer(server);
        }
      });
  }

  private deleteServer(server: IMcpServer): void {
    this.dismissError();
    this.agentAdminService.deleteMcpServer(server.id).subscribe({
      next: () => {
        this.servers.update((s) => s.filter((x) => x.id !== server.id));
        this.snackBar.open("MCP server deleted.", undefined, {
          duration: 2000,
        });
      },
      error: (err: unknown) =>
        this.reportError(err, "Couldn't delete MCP server"),
    });
  }

  dismissError(): void {
    this.actionError.set(null);
  }

  /**
   * Surfaces a backend error as a clear, dismissible banner. For the
   * structured managed-server 409 the backend message is already
   * user-facing, so we show it verbatim alongside the editable-field hint —
   * same pattern as `connectors.component.ts`'s `reportError`.
   */
  private reportError(err: unknown, fallbackTitle: string): void {
    const body =
      err instanceof HttpErrorResponse
        ? (err.error as IManagedMcpServerConflict | string | undefined)
        : undefined;

    if (
      body &&
      typeof body === "object" &&
      body.reason === "MANAGED_MCP_SERVER"
    ) {
      this.actionError.set({
        title: "This MCP server is synced and partly read-only",
        message: body.message ?? fallbackTitle,
        editableFields: body.editableFields,
      });
      return;
    }

    const message =
      body && typeof body === "object" && typeof body.message === "string"
        ? body.message
        : typeof body === "string" && body.length > 0
          ? body
          : "Please try again, or contact support if the problem persists.";

    this.actionError.set({ title: fallbackTitle, message });
  }

  private loadServers(): void {
    this.loading.set(true);
    this.agentAdminService.listMcpServers().subscribe({
      next: (servers) => {
        this.servers.set(servers);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
