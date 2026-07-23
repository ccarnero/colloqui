import {
  ChangeDetectionStrategy,
  Component,
  inject,
  viewChild,
} from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { AgentAdminService } from "../../core/services/agent-admin.service";
import { McpServerDialogComponent } from "../../shared/components/mcp-server-dialog/mcp-server-dialog.component";
import type {
  IMcpServerDialogData,
  IMcpServerDialogResult,
} from "../../shared/components/mcp-server-dialog/mcp-server-dialog.types";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { ConnectionsFleetComponent } from "./connections-fleet.component";

/**
 * `/connections/mcp` — T05 (console-redesign-polish.md, T01 finding 6,
 * SIGNED decision 5b): retires the legacy `McpServersPageComponent`'s own
 * separate chrome (own title, own transport/status filter-chip row, own
 * table, no KPI row) and instead renders the SAME unified
 * `ConnectionsFleetComponent` composition as `/connections`, pre-filtered
 * to `kind="mcp"` via the shared fleet's chip row. Same URL, same data
 * sources (`AgentAdminService`), same detail route on row click
 * (`/connections/mcp/:id`, unchanged).
 *
 * The legacy page's create affordance ("Add MCP Server") is preserved here
 * — it is the one piece of MCP-specific CRUD the unified fleet table
 * itself doesn't own (the fleet's "+ New connector" action on
 * `/connections` always points at the HTTP connector flow). Edit and
 * Delete are reachable via the existing MCP detail route's header actions
 * (`mcp-detail.component.ts`), unchanged.
 *
 * KNOWN LOSSES vs. the legacy page (review objections 2-4, deliberately NOT
 * rebuilt — the mock only shows the unified fleet's kind-chip row, design
 * wins precedent per SIGNED decision 5b). Named here for a T09 INDEX
 * follow-up to catalog:
 *  - Transport (http/sse) and Status (enabled/disabled) filter chips: these
 *    were MCP-specific filter axes on top of the legacy table; the unified
 *    fleet only exposes the kind-chip row (`ConnectionsFleetComponent`), no
 *    per-kind sub-filters.
 *  - Per-row "Synced" badge: the legacy table flagged managed/synced rows
 *    inline. Still visible in `mcp-detail.component.ts` (the "Synced" id
 *    chip + "Managed by" field), so this is a genuine row-level loss, not a
 *    full feature loss.
 *  - On-demand Tools count column: the legacy table fetched a per-row tool
 *    count lazily on expand. The tool list itself is not lost — it now
 *    lives in `mcp-detail.component.ts`'s "Tools" section — but the
 *    at-a-glance count-per-row in the list view is gone.
 */
@Component({
  selector: "app-mcp-fleet-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, ConnectionsFleetComponent],
  template: `
    <app-page-header
      title="MCP Servers"
      subtitle="Model Context Protocol server connections for your agents"
    >
      <ng-container slot="actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="openCreate()"
        >
          + Add MCP Server
        </button>
      </ng-container>
    </app-page-header>

    <app-connections-fleet #fleet initialKind="mcp" />
  `,
  styles: `
    :host {
      display: block;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-7, 8px);
      background: var(--rd-panel);
      color: var(--rd-text-1);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--rd-accent);
      color: var(--rd-bg);
      border-color: var(--rd-accent);
    }
  `,
})
export class McpFleetPageComponent {
  private readonly agentAdmin = inject(AgentAdminService);
  private readonly dialog = inject(MatDialog);
  private readonly fleet = viewChild.required(ConnectionsFleetComponent);

  /**
   * Create wiring reused verbatim from the legacy `McpServersPageComponent`
   * (T05, SIGNED decision 5b: "create/add affordance wiring identical").
   */
  openCreate(): void {
    console.debug("[McpFleetPageComponent] opening create MCP server dialog");
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
          console.debug(
            "[McpFleetPageComponent] create MCP server dialog dismissed"
          );
          return;
        }
        this.agentAdmin
          .createMcpServer({
            name: result.name,
            description: result.description,
            transport_type: result.transport_type,
            url: result.url,
            headers: result.headers,
            authType: result.authType,
            authConfig: result.authConfig,
            enabled: result.enabled,
            scope: result.scope,
          })
          .subscribe({
            next: (server) => {
              console.debug(
                "[McpFleetPageComponent] MCP server created, refreshing fleet",
                { id: server.id }
              );
              this.fleet().refreshMcpServers();
            },
            error: (err: unknown) => {
              console.error(
                "[McpFleetPageComponent] failed to create MCP server",
                { error: err }
              );
            },
          });
      });
  }
}
