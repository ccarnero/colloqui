import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import type {
  IMcpServer,
  IMcpServerTool,
  IMcpUsage,
  IMcpUsageRecentCall,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import { McpServerDialogComponent } from "../../../shared/components/mcp-server-dialog/mcp-server-dialog.component";
import type {
  IMcpServerDialogData,
  IMcpServerDialogResult,
} from "../../../shared/components/mcp-server-dialog/mcp-server-dialog.types";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import {
  type HealthStatus,
  StatusBadgeComponent,
} from "../../../shared/components/status-badge/status-badge.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import { buildMcpServerUpdatePayload } from "./build-mcp-server-update-payload";

/**
 * MCP server detail page (mcp-connections.md §3, §6.3) — the MCP-side
 * analog of `connector-detail.component.ts`, mirroring its section
 * structure (Overview / Configuration / [Endpoints -> here: Tools] /
 * Recent calls). Two deliberate differences from the connector page:
 *
 * - **Tools** is read-only, with no "+ Add Tool" affordance anywhere — MCP
 *   tools are discovered live from the server (`GET :id/tools`), never
 *   manually defined (mcp-connections.md §6.4's explicit clarification).
 * - **Recent calls** comes from one combined endpoint
 *   (`GET :id/usage`, mcp-connections.md §3) that returns both the
 *   aggregate summary (for the Overview cards) and the recent-call list,
 *   rather than a separate audit-events endpoint the way Connectors' recent
 *   calls does — see `mcp-servers.service.ts`'s `getUsage` for why.
 *
 * T03 restyle (console-redesign-connections.md): header health dot, KPI
 * cards for the overview row (real data only — `Calls (Nd)` from
 * `usage.summary.totalCalls`), token-styled config/tools, and an Edit
 * action reusing `McpServerDialogComponent` unchanged.
 */
@Component({
  selector: "app-mcp-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    KpiCardComponent,
    UtcDatePipe,
  ],
  template: `
    <div class="ws-breadcrumb">
      <a [routerLink]="['/connections/mcp']" class="breadcrumb-link">
        <mat-icon>arrow_back</mat-icon>
        MCP Servers
      </a>
    </div>

    @if (loading()) {
      <div class="loader"><mat-spinner diameter="36"></mat-spinner></div>
    } @else if (errorMessage()) {
      <div class="error-banner">{{ errorMessage() }}</div>
    } @else if (server(); as s) {
      @if (saveError()) {
        <div class="error-banner save-error-banner">{{ saveError() }}</div>
      }
      <app-page-header [title]="s.name" subtitle="MCP server configuration">
        <ng-container slot="actions">
          <span class="identity-chips">
            <app-status-badge
              [status]="s.enabled && s.is_active ? 'Enabled' : 'Disabled'"
              variant="dot"
              [health]="health()"
            />
            <span class="id-chip">{{ s.transport_type }}</span>
            @if (s.managed_by) {
              <span class="id-chip id-chip--synced" [title]="'Synced from ' + s.managed_by">
                <mat-icon class="id-chip-icon">sync</mat-icon>
                Synced
              </span>
            }
          </span>
          <button type="button" class="btn btn-outline btn-sm" (click)="openEdit()">
            <mat-icon>edit</mat-icon>
            Edit
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm btn-danger"
            (click)="confirmDelete()"
          >
            <mat-icon>delete</mat-icon>
            Delete
          </button>
        </ng-container>
      </app-page-header>

      <section class="section">
        <h3 class="section-title">Overview</h3>
        <div class="kpi-row">
          @for (card of summaryCards(); track card.label) {
            <app-kpi-card [label]="card.label" [value]="card.value" />
          }
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">Configuration</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">URL</span>
            <span class="info-value mono">{{ s.url }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Transport</span>
            <span class="info-value">{{ s.transport_type }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Auth type</span>
            <span class="info-value">{{ s.auth_type }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Status</span>
            <span class="info-value">
              {{ s.enabled && s.is_active ? "Enabled" : "Disabled" }}
            </span>
          </div>
          @if (s.managed_by) {
            <div class="info-item">
              <span class="info-label">Managed by</span>
              <span class="info-value">{{ s.managed_by }}</span>
            </div>
          }
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">Tools</h3>
        @if (toolsLoading()) {
          <div class="loader"><mat-spinner diameter="24"></mat-spinner></div>
        } @else if (toolsError()) {
          <p class="no-calls">Couldn't load tools from this server.</p>
        } @else if (tools().length === 0) {
          <p class="no-calls">This server exposes no tools right now.</p>
        } @else {
          <div class="endpoints-list">
            @for (t of tools(); track t.name) {
              <div class="endpoint-card">
                <span class="endpoint-path">{{ t.name }}</span>
                @if (t.description) {
                  <span class="endpoint-label">{{ t.description }}</span>
                }
                <span class="endpoint-cache">{{ schemaSummary(t) }}</span>
              </div>
            }
          </div>
        }
      </section>

      <section class="section">
        <h3 class="section-title">Recent calls</h3>
        @if (usageLoading()) {
          <div class="loader">
            <mat-spinner diameter="24"></mat-spinner
            ><span>Loading recent calls…</span>
          </div>
        } @else if (recentCalls().length === 0) {
          <p class="no-calls">No calls in the selected window.</p>
        } @else {
          <div class="call-list">
            @for (c of recentCalls(); track $index; let idx = $index) {
              <div class="call-row">
                <span class="call-ts">{{ c.createdAt | utcDate: "medium" }}</span>
                <span class="call-method">{{ c.toolName }}</span>
                <span class="call-status" [class]="c.success ? 'st-2xx' : 'st-5xx'">
                  {{ c.success ? "OK" : "Error" }}
                </span>
                <span class="call-dur">{{ c.durationMs }}ms</span>
                <span class="call-url">{{ c.error ?? "" }}</span>
              </div>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .ws-breadcrumb { margin-bottom: var(--rd-space-6, 12px); }
    .breadcrumb-link { display: inline-flex; align-items: center; gap: var(--rd-space-2, 4px); color: var(--rd-text-3); text-decoration: none; font-size: var(--rd-text-size-xs, 13px); }
    .breadcrumb-link:hover { color: var(--rd-text-1); }
    .loader { display: flex; justify-content: center; align-items: center; gap: var(--rd-space-4, 8px); padding: 2rem; }
    .error-banner { padding: var(--rd-space-6, 12px) var(--rd-space-8, 16px); border-radius: var(--rd-radius-5, 6px); background: var(--rd-red-dim); border: 1px solid var(--rd-red); color: var(--rd-red); font-size: var(--rd-text-size-xs, 13px); }
    .save-error-banner { margin-bottom: var(--rd-space-6, 12px); }
    .identity-chips { display: inline-flex; align-items: center; gap: var(--rd-space-5, 10px); }
    .id-chip { font-family: var(--rd-font-mono); font-size: var(--rd-text-size-xs, 11px); color: var(--rd-text-2); border: 1px solid var(--rd-line-3); border-radius: var(--rd-radius-5, 6px); padding: 2px var(--rd-space-5, 9px); text-transform: capitalize; }
    .id-chip--synced { display: inline-flex; align-items: center; gap: var(--rd-space-2, 4px); color: var(--rd-text-3); }
    .id-chip-icon { font-size: 12px; width: 12px; height: 12px; }
    .btn { display: inline-flex; align-items: center; gap: var(--rd-space-3, 6px); border-radius: var(--rd-radius-7, 8px); padding: 7px var(--rd-space-6, 12px); font-size: var(--rd-text-size-sm, 12.5px); font-weight: 500; cursor: pointer; font-family: inherit; border: 1px solid var(--rd-line-3); background: transparent; color: var(--rd-text-1); }
    .btn:hover { background: var(--rd-hover); }
    .btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .btn-danger { color: var(--rd-red); border-color: var(--rd-red); }
    .btn-danger:hover { background: var(--rd-red-dim); }
    .section { margin-top: var(--rd-space-11, 24px); padding: var(--rd-space-8, 16px); border: 1px solid var(--rd-line); border-radius: var(--rd-radius-7, 8px); }
    .section-title { margin: 0 0 var(--rd-space-6, 12px); font-size: var(--rd-text-size-md, 14px); font-weight: 600; color: var(--rd-text-1); }
    .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--rd-space-6, 12px); }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--rd-space-6, 12px); }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-label { font-size: var(--rd-text-size-xs, 11px); color: var(--rd-text-3); text-transform: uppercase; letter-spacing: 0.05em; }
    .info-value { font-size: var(--rd-text-size-base, 13px); color: var(--rd-text-1); }
    .mono { font-family: var(--rd-font-mono); }
    .endpoints-list { display: flex; flex-direction: column; gap: var(--rd-space-4, 8px); }
    .endpoint-card { display: flex; align-items: center; gap: var(--rd-space-6, 12px); padding: var(--rd-space-6, 12px); background: var(--rd-panel); border-radius: var(--rd-radius-5, 6px); font-size: var(--rd-text-size-base, 13px); }
    .endpoint-path { font-family: var(--rd-font-mono); font-size: var(--rd-text-size-sm, 12px); color: var(--rd-text-2); }
    .endpoint-label { flex: 1; font-size: var(--rd-text-size-sm, 12px); color: var(--rd-text-3); }
    .endpoint-cache { font-size: var(--rd-text-size-xs, 11px); color: var(--rd-text-3); white-space: nowrap; }
    .no-calls { color: var(--rd-text-3); font-size: var(--rd-text-size-base, 13px); margin: 0; }
    .call-list { display: flex; flex-direction: column; gap: var(--rd-space-2, 4px); }
    .call-row { display: grid; grid-template-columns: 160px 1fr 60px 70px 1fr; gap: var(--rd-space-4, 8px); align-items: center; padding: var(--rd-space-3, 6px) var(--rd-space-4, 8px); border-radius: var(--rd-radius-3, 4px); background: var(--rd-panel); font-size: var(--rd-text-size-sm, 12px); color: var(--rd-text-2); }
    .call-ts { color: var(--rd-text-3); font-size: var(--rd-text-size-xs, 11px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .call-method { font-family: var(--rd-font-mono); font-size: var(--rd-text-size-xs, 11px); font-weight: 600; color: var(--rd-link); }
    .call-status { font-family: var(--rd-font-mono); font-weight: 600; font-size: var(--rd-text-size-sm, 12px); }
    .st-2xx { color: var(--rd-green); }
    .st-5xx { color: var(--rd-red); }
    .call-dur { color: var(--rd-text-3); font-size: var(--rd-text-size-xs, 11px); }
    .call-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--rd-font-mono); font-size: var(--rd-text-size-xs, 11px); }
  `,
})
export class McpDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly server = signal<IMcpServer | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  readonly tools = signal<IMcpServerTool[]>([]);
  readonly toolsLoading = signal(false);
  readonly toolsError = signal(false);

  readonly usage = signal<IMcpUsage | null>(null);
  readonly usageLoading = signal(false);

  readonly recentCalls = computed<IMcpUsageRecentCall[]>(
    () => this.usage()?.recentCalls ?? []
  );

  // Health mapping (SPEC console-redesign-connections.md, decision 3,
  // orchestrator ruling 2026-07-22): MCP servers map
  // enabled && is_active -> ok, else error. No warn is derivable — no
  // call-success-rate aggregation/threshold exists (T01 §4).
  readonly health = computed<HealthStatus>(() => {
    const s = this.server();
    return s?.enabled && s.is_active ? "ok" : "error";
  });

  readonly summaryCards = computed(() => {
    const s = this.server();
    if (!s) {
      return [];
    }
    const usage = this.usage();
    return [
      {
        label: "Status",
        value: s.enabled && s.is_active ? "Enabled" : "Disabled",
      },
      {
        label: "Auth",
        value: s.auth_type,
      },
      {
        label: "Transport",
        value: s.transport_type,
      },
      {
        label: "Tools",
        value: this.toolsLoading() ? "…" : String(this.tools().length),
      },
      {
        // Calls (Nd) is real data — usage.summary.totalCalls (T01 §2, §6).
        label: `Calls (${usage?.windowDays ?? 7}d)`,
        value: this.usageLoading()
          ? "…"
          : String(usage?.summary.totalCalls ?? 0),
      },
    ];
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get("id") ?? "";
      this.load(id);
    });
  }

  protected schemaSummary(tool: IMcpServerTool): string {
    const schema = tool.inputSchema as
      | { properties?: Record<string, unknown>; required?: string[] }
      | null
      | undefined;
    const propertyNames = schema?.properties
      ? Object.keys(schema.properties)
      : [];
    if (propertyNames.length === 0) {
      return "No parameters";
    }
    const required = new Set(schema?.required ?? []);
    return propertyNames
      .map((name) => (required.has(name) ? `${name}*` : name))
      .join(", ");
  }

  private load(id: string): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    console.debug("[McpDetailComponent] loading MCP server", { id });
    this.agentAdminService.getMcpServer(id).subscribe({
      next: (server) => {
        this.server.set(server);
        this.loading.set(false);
        console.debug("[McpDetailComponent] MCP server loaded", {
          id,
          enabled: server.enabled,
          isActive: server.is_active,
        });
        this.loadTools(id);
        this.loadUsage(id);
      },
      error: (err: unknown) => {
        console.error("[McpDetailComponent] failed to load MCP server", {
          id,
          err,
        });
        this.errorMessage.set("Failed to load MCP server.");
        this.loading.set(false);
      },
    });
  }

  private loadTools(id: string): void {
    this.toolsLoading.set(true);
    this.toolsError.set(false);
    this.agentAdminService.listMcpServerTools(id).subscribe({
      next: (tools) => {
        this.tools.set(tools);
        this.toolsLoading.set(false);
        console.debug("[McpDetailComponent] tools loaded", {
          id,
          count: tools.length,
        });
      },
      error: (err: unknown) => {
        console.error("[McpDetailComponent] failed to load tools", { id, err });
        this.toolsError.set(true);
        this.toolsLoading.set(false);
      },
    });
  }

  private loadUsage(id: string): void {
    this.usageLoading.set(true);
    this.agentAdminService.getMcpServerUsage(id).subscribe({
      next: (usage) => {
        this.usage.set(usage);
        this.usageLoading.set(false);
        console.debug("[McpDetailComponent] usage loaded", {
          id,
          totalCalls: usage.summary.totalCalls,
        });
      },
      error: (err: unknown) => {
        console.error("[McpDetailComponent] failed to load usage", { id, err });
        this.usageLoading.set(false);
      },
    });
  }

  /**
   * Edit action, reusing `McpServerDialogComponent` exactly as
   * `mcp-servers-page.component.ts` does — the form is never duplicated
   * here, only the update payload glue (`build-mcp-server-update-payload.ts`
   * in this folder).
   */
  openEdit(): void {
    const server = this.server();
    if (!server) {
      console.error(
        "[McpDetailComponent] edit requested with no server loaded"
      );
      return;
    }
    const data: IMcpServerDialogData = { mode: "edit", server };
    console.debug("[McpDetailComponent] opening MCP server edit dialog", {
      id: server.id,
    });
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
          console.debug("[McpDetailComponent] edit dialog dismissed", {
            id: server.id,
          });
          return;
        }
        const payload = buildMcpServerUpdatePayload(server, result);
        console.debug("[McpDetailComponent] saving MCP server edit", {
          id: server.id,
        });
        this.saveError.set(null);
        this.agentAdminService.updateMcpServer(server.id, payload).subscribe({
          next: (updated) => {
            this.server.set(updated);
            console.debug("[McpDetailComponent] MCP server updated", {
              id: server.id,
            });
          },
          error: (err: unknown) => {
            console.error(
              "[McpDetailComponent] failed to save MCP server edit",
              {
                id: server.id,
                err,
              }
            );
            // User-visible surfacing of the save failure, mirroring
            // connector-detail.component.ts's saveError/save-error-banner
            // pattern — the dialog must not close silently on a stale page.
            this.saveError.set("Couldn't save changes. Please try again.");
          },
        });
      });
  }

  /**
   * Delete action (review objection 1 fix, per the channel-detail.component.ts
   * precedent: actions move to the detail surface). Guards managed/synced
   * servers up front — same semantics as the deleted
   * `mcp-servers-page.component.ts`'s `remove()`: never round-trip to the
   * backend's guaranteed 409 (mcp-connections.md §2.3, reason
   * MANAGED_MCP_SERVER), explain why in the existing saveError banner
   * instead. Unmanaged servers get the standard confirm dialog, then
   * `deleteMcpServer` + navigate back to the fleet list on success.
   */
  confirmDelete(): void {
    const server = this.server();
    if (!server) {
      console.error(
        "[McpDetailComponent] delete requested with no server loaded"
      );
      return;
    }

    if (server.managed_by) {
      console.debug(
        "[McpDetailComponent] delete blocked for managed MCP server",
        { id: server.id, managedBy: server.managed_by }
      );
      this.saveError.set(
        `"${server.name}" is synced from ${server.managed_by} and would be ` +
          `recreated automatically on the next sync (reason: ` +
          `MANAGED_MCP_SERVER). To remove it, delete the source service ` +
          `from the registry instead.`
      );
      return;
    }

    const data: IConfirmDialogData = {
      title: "Delete MCP server",
      message: `Delete "${server.name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      icon: "warning_amber",
    };
    console.debug("[McpDetailComponent] delete confirmation requested", {
      id: server.id,
    });
    this.dialog
      .open<ConfirmDialogComponent, IConfirmDialogData, boolean>(
        ConfirmDialogComponent,
        { data, autoFocus: false, restoreFocus: true }
      )
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) {
          this.deleteServer(server);
        } else {
          console.debug("[McpDetailComponent] delete cancelled", {
            id: server.id,
          });
        }
      });
  }

  private deleteServer(server: IMcpServer): void {
    this.saveError.set(null);
    this.agentAdminService.deleteMcpServer(server.id).subscribe({
      next: () => {
        console.debug(
          "[McpDetailComponent] MCP server deleted, navigating back to fleet",
          { id: server.id }
        );
        this.snackBar.open("MCP server deleted.", undefined, {
          duration: 2000,
        });
        this.router.navigate(["/connections/mcp"]).catch((error: unknown) => {
          console.error(
            "[McpDetailComponent] navigation back to fleet failed",
            { id: server.id, error }
          );
        });
      },
      error: (err: unknown) => {
        console.error("[McpDetailComponent] failed to delete MCP server", {
          id: server.id,
          err,
        });
        // Same saveError/save-error-banner pattern as openEdit's failure
        // path — the page must not fail silently.
        this.saveError.set("Couldn't delete MCP server. Please try again.");
      },
    });
  }
}
